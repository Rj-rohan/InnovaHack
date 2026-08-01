// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentWallet — a policy-enforcing wallet for autonomous AI agents.
///
/// @notice The agent never holds the wallet's funds and never holds the owner key. It holds a
/// revocable *session key* whose only power is to PROPOSE a payment. Every limit is enforced here,
/// in contract storage, at execution time. A compromised, buggy, or adversarial agent cannot move
/// funds outside policy, because nothing in this contract asks the agent whether it should be
/// allowed to — the checks do not depend on the caller cooperating.
///
/// @dev Two execution paths, deliberately different in how they fail:
///
///   - `pay()` REVERTS with a typed custom error. This is the hard guarantee: a violating
///     transaction has no effect on chain, full stop.
///   - `payBatch()` re-checks every rule before EACH leg and, on violation, emits
///     `PaymentBlocked` and stops instead of reverting. Legs that already executed stay
///     executed. This is what makes in-flight revocation observable: the receipt for a single
///     transaction reads "leg 0 paid, leg 1 blocked: Paused". A revert would emit nothing at all
///     and the block would be invisible to anyone reading logs.
///
/// Both paths run the exact same `_check()`, so the two can never drift apart.
contract AgentWallet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice Why a payment was refused. `None` means the payment is permitted.
    enum BlockReason {
        None,
        Paused,
        SessionInvalid,
        CounterpartyNotAllowed,
        PerTxCapExceeded,
        RollingCapExceeded,
        InsufficientBalance
    }

    struct Session {
        bool active;
        uint48 expiresAt;
    }

    struct Payment {
        address to;
        uint256 amount;
    }

    /// @dev One historical spend. Packed into a single slot (48 + 208 = 256 bits).
    struct Spend {
        uint48 ts;
        uint208 amount;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant WINDOW = 24 hours;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @dev Size of the rolling-window ring buffer. Bounds the gas of `rolling24h()`.
    uint256 private constant SPEND_SLOTS = 32;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice The single ERC-20 this wallet transacts in. Caps are denominated in its units.
    /// @dev Immutable and single-token on purpose. A wallet that accepts arbitrary calldata needs
    /// to parse that calldata to enforce anything, and calldata parsing is where policy wallets
    /// get exploited. Restricting the call surface to "transfer this one token" makes the policy
    /// total: there is no encoding an agent can reach for that this contract does not understand.
    IERC20 public immutable policyToken;

    address public owner;
    bool public paused;

    /// @notice Throttle multiplier in basis points, applied to both caps. 10000 = full limits.
    /// @dev The middle setting between full access and a full freeze: drop the agent to 1% of its
    /// allowance without stopping it, while an incident is triaged.
    uint16 public throttleBps = BPS_DENOMINATOR;

    uint256 public perTxCap;
    uint256 public rollingCap;

    mapping(address => Session) public sessions;

    /// @notice Category tag for a counterparty. `bytes32(0)` means "not on the allowlist at all".
    mapping(address => bytes32) public counterpartyTag;

    /// @notice Whether an entire category is currently payable. Lets the owner disable a whole
    /// group ("exchange", "vendor") in one transaction instead of address by address.
    mapping(bytes32 => bool) public tagEnabled;

    Spend[SPEND_SLOTS] private _spends;
    uint8 private _spendIdx;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PaymentExecuted(address indexed by, address indexed to, uint256 amount, bytes32 tag);
    event PaymentBlocked(
        uint256 indexed index, address indexed by, address indexed to, uint256 amount, BlockReason reason
    );
    event AgentPaused(address indexed by);
    event AgentUnpaused(address indexed by);
    event SessionGranted(address indexed key, uint48 expiresAt);
    event SessionRevoked(address indexed key);
    event CounterpartyUpdated(address indexed account, bytes32 tag);
    event TagUpdated(bytes32 indexed tag, bool enabled);
    event LimitsUpdated(uint256 perTxCap, uint256 rollingCap);
    event ThrottleUpdated(uint16 bps);
    event OwnerWithdrawal(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotOwner();
    error WalletPaused();
    error SessionInvalid(address key);
    error CounterpartyNotAllowed(address to);
    error SpendLimitExceeded(uint256 attempted, uint256 cap);
    error RollingLimitExceeded(uint256 attempted, uint256 remaining);
    error InsufficientBalance(uint256 attempted, uint256 available);
    error SpendHistoryFull();
    error InvalidThrottle();
    error ZeroAddress();
    error EmptyBatch();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(IERC20 token, address initialOwner, uint256 initialPerTxCap, uint256 initialRollingCap) {
        if (address(token) == address(0) || initialOwner == address(0)) revert ZeroAddress();
        policyToken = token;
        owner = initialOwner;
        perTxCap = initialPerTxCap;
        rollingCap = initialRollingCap;

        emit OwnershipTransferred(address(0), initialOwner);
        emit LimitsUpdated(initialPerTxCap, initialRollingCap);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ---------------------------------------------------------------------
    // Owner controls — the kill switch
    // ---------------------------------------------------------------------

    /// @notice Halt every agent payment immediately.
    /// @dev Intentionally NOT `nonReentrant`. It must remain callable from inside an in-flight
    /// `payBatch()` (via a token hook or any other re-entrant path), because "stops a run that is
    /// already underway" is the whole point of a kill switch.
    function pause() external onlyOwner {
        paused = true;
        emit AgentPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit AgentUnpaused(msg.sender);
    }

    /// @notice Scale both caps without losing their configured values. 10000 = full, 0 = frozen.
    function setThrottle(uint16 bps) external onlyOwner {
        if (bps > BPS_DENOMINATOR) revert InvalidThrottle();
        throttleBps = bps;
        emit ThrottleUpdated(bps);
    }

    function setLimits(uint256 newPerTxCap, uint256 newRollingCap) external onlyOwner {
        perTxCap = newPerTxCap;
        rollingCap = newRollingCap;
        emit LimitsUpdated(newPerTxCap, newRollingCap);
    }

    function grantSession(address key, uint48 expiresAt) external onlyOwner {
        if (key == address(0)) revert ZeroAddress();
        sessions[key] = Session({active: true, expiresAt: expiresAt});
        emit SessionGranted(key, expiresAt);
    }

    /// @notice Pull the agent's permission to act. Takes effect on the very next check, which
    /// `payBatch()` performs before every leg — so a multi-step run in progress stops here.
    function revokeSession(address key) external onlyOwner {
        delete sessions[key];
        emit SessionRevoked(key);
    }

    /// @notice Add or remove a counterparty. Pass `bytes32(0)` as the tag to remove it entirely.
    function setCounterparty(address account, bytes32 tag) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        counterpartyTag[account] = tag;
        emit CounterpartyUpdated(account, tag);
    }

    function setTagEnabled(bytes32 tag, bool enabled) external onlyOwner {
        tagEnabled[tag] = enabled;
        emit TagUpdated(tag, enabled);
    }

    /// @notice Owner escape hatch. Deliberately bypasses every policy check, including `paused`.
    /// @dev The policy constrains the AGENT, not the owner — it is the owner's money, and a freeze
    /// that also locked the owner out of their own funds would be a bug, not a safety feature.
    function ownerWithdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        policyToken.safeTransfer(to, amount);
        emit OwnerWithdrawal(to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    // ---------------------------------------------------------------------
    // Agent execution
    // ---------------------------------------------------------------------

    /// @notice Execute a single payment. Reverts if it violates any policy rule.
    function pay(address to, uint256 amount) external nonReentrant {
        (BlockReason reason, uint256 context) = _check(msg.sender, to, amount);
        if (reason != BlockReason.None) _revertFor(reason, msg.sender, to, amount, context);

        _record(amount);
        policyToken.safeTransfer(to, amount);
        emit PaymentExecuted(msg.sender, to, amount, counterpartyTag[to]);
    }

    /// @notice Execute payments in sequence, re-validating policy before EVERY leg.
    /// @dev On the first violation this emits `PaymentBlocked` and returns rather than reverting,
    /// so that already-completed legs persist and the block is visible in the logs. See the
    /// contract-level note for why both failure styles exist.
    function payBatch(Payment[] calldata payments) external nonReentrant {
        if (payments.length == 0) revert EmptyBatch();

        for (uint256 i = 0; i < payments.length; i++) {
            address to = payments[i].to;
            uint256 amount = payments[i].amount;

            // Re-checked on every iteration, not hoisted out of the loop. If the owner freezes the
            // wallet (or revokes the session, or drops a counterparty) part-way through, the very
            // next leg sees it.
            (BlockReason reason,) = _check(msg.sender, to, amount);
            if (reason != BlockReason.None) {
                emit PaymentBlocked(i, msg.sender, to, amount, reason);
                return;
            }

            _record(amount);
            policyToken.safeTransfer(to, amount);
            emit PaymentExecuted(msg.sender, to, amount, counterpartyTag[to]);
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function effectivePerTxCap() public view returns (uint256) {
        return (perTxCap * throttleBps) / BPS_DENOMINATOR;
    }

    function effectiveRollingCap() public view returns (uint256) {
        return (rollingCap * throttleBps) / BPS_DENOMINATOR;
    }

    /// @notice Total spent in the trailing 24 hours. A true rolling window, not a calendar day
    /// that resets at midnight and lets an agent spend two full allowances an hour apart.
    function rolling24h() public view returns (uint256 total) {
        uint256 cutoff = block.timestamp > WINDOW ? block.timestamp - WINDOW : 0;
        for (uint256 i = 0; i < SPEND_SLOTS; i++) {
            Spend storage s = _spends[i];
            if (s.ts != 0 && uint256(s.ts) >= cutoff) total += s.amount;
        }
    }

    function remainingToday() external view returns (uint256) {
        uint256 cap = effectiveRollingCap();
        uint256 spent = rolling24h();
        return cap > spent ? cap - spent : 0;
    }

    function isAllowed(address to) public view returns (bool) {
        bytes32 tag = counterpartyTag[to];
        return tag != bytes32(0) && tagEnabled[tag];
    }

    /// @notice Dry-run a payment without sending it. Returns `BlockReason.None` if it would go
    /// through right now.
    /// @dev Exists so the agent can OBSERVE policy — never so it can enforce it. Whatever this
    /// returns, `pay()` re-derives the answer from storage at execution time; an agent that skips
    /// this call, or lies about its result, gains nothing.
    function simulate(address by, address to, uint256 amount) external view returns (BlockReason) {
        (BlockReason reason,) = _check(by, to, amount);
        return reason;
    }

    /// @notice Whole policy state in one call, so the agent and dashboard need one RPC round trip
    /// per tick instead of eight.
    function policySnapshot()
        external
        view
        returns (
            bool isPaused,
            uint16 throttle,
            uint256 txCap,
            uint256 dayCap,
            uint256 spentInWindow,
            uint256 remaining,
            uint256 balance
        )
    {
        isPaused = paused;
        throttle = throttleBps;
        txCap = effectivePerTxCap();
        dayCap = effectiveRollingCap();
        spentInWindow = rolling24h();
        remaining = dayCap > spentInWindow ? dayCap - spentInWindow : 0;
        balance = policyToken.balanceOf(address(this));
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev The single source of truth for "may this payment happen". Both `pay()` and
    /// `payBatch()` call it, so the reverting and the event-emitting paths can never disagree.
    /// Ordered cheapest-and-most-severe first, which also makes the reported reason the most
    /// useful one when several rules would fail at once.
    function _check(address by, address to, uint256 amount)
        internal
        view
        returns (BlockReason reason, uint256 context)
    {
        if (paused) return (BlockReason.Paused, 0);

        Session storage s = sessions[by];
        if (!s.active || uint256(s.expiresAt) <= block.timestamp) {
            return (BlockReason.SessionInvalid, 0);
        }

        if (!isAllowed(to)) return (BlockReason.CounterpartyNotAllowed, 0);

        uint256 txCap = effectivePerTxCap();
        if (amount > txCap) return (BlockReason.PerTxCapExceeded, txCap);

        uint256 dayCap = effectiveRollingCap();
        uint256 spent = rolling24h();
        if (spent + amount > dayCap) {
            return (BlockReason.RollingCapExceeded, dayCap > spent ? dayCap - spent : 0);
        }

        uint256 balance = policyToken.balanceOf(address(this));
        if (balance < amount) return (BlockReason.InsufficientBalance, balance);

        return (BlockReason.None, 0);
    }

    function _revertFor(BlockReason reason, address by, address to, uint256 amount, uint256 context)
        internal
        pure
    {
        if (reason == BlockReason.Paused) revert WalletPaused();
        if (reason == BlockReason.SessionInvalid) revert SessionInvalid(by);
        if (reason == BlockReason.CounterpartyNotAllowed) revert CounterpartyNotAllowed(to);
        if (reason == BlockReason.PerTxCapExceeded) revert SpendLimitExceeded(amount, context);
        if (reason == BlockReason.RollingCapExceeded) revert RollingLimitExceeded(amount, context);
        revert InsufficientBalance(amount, context);
    }

    /// @dev Append a spend to the ring buffer. Called BEFORE the external transfer
    /// (checks-effects-interactions), so a hostile token cannot re-enter and spend against a
    /// window that has not yet been debited.
    function _record(uint256 amount) internal {
        uint256 cutoff = block.timestamp > WINDOW ? block.timestamp - WINDOW : 0;
        uint8 idx = _spendIdx;
        Spend storage slot = _spends[idx];

        // `idx` always points at the oldest entry. If even that one is still inside the window,
        // all 32 slots are live and overwriting one would silently under-count the window and let
        // spending drift past the cap. Fail closed instead.
        if (slot.ts != 0 && uint256(slot.ts) >= cutoff) revert SpendHistoryFull();

        slot.ts = uint48(block.timestamp);
        slot.amount = uint208(amount);
        _spendIdx = uint8((uint256(idx) + 1) % SPEND_SLOTS);
    }
}
