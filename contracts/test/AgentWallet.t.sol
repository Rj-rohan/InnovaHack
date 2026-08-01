// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentWallet} from "../src/AgentWallet.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @dev A token that freezes the wallet from inside a transfer.
///
/// This exists to prove the claim that `payBatch` re-checks policy before EVERY leg rather than
/// once up front. Within a single transaction nothing external can call `pause()` between legs, so
/// without a re-entrant hook like this the per-leg check is untestable — you would be trusting the
/// loop body by inspection. Here leg 0's transfer pauses the wallet, and leg 1 has to notice.
contract PausingToken is ERC20 {
    AgentWallet public wallet;
    address public watched;
    bool private _armed;

    constructor() ERC20("Pausing Token", "PAUSE") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @param w The wallet to freeze. It must have transferred ownership to this token.
    function arm(AgentWallet w) external {
        wallet = w;
        watched = address(w);
        _armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        // Only react to the wallet paying someone out — not to mints or unrelated transfers.
        if (_armed && from == watched) {
            _armed = false; // fire exactly once, on the first outbound leg
            wallet.pause();
        }
    }
}

contract AgentWalletTest is Test {
    MockUSDC internal token;
    AgentWallet internal wallet;

    address internal owner = address(0xA0);
    address internal agent = address(0xA6);
    address internal stranger = address(0xBAD);
    address internal vendor = address(0x1111);
    address internal vendor2 = address(0x2222);
    address internal exchange = address(0x3333);
    address internal unknownPayee = address(0x9999);

    bytes32 internal constant TAG_VENDOR = bytes32("vendor");
    bytes32 internal constant TAG_EXCHANGE = bytes32("exchange");

    uint256 internal constant PER_TX_CAP = 40e6; // 40 mUSDC
    uint256 internal constant ROLLING_CAP = 100e6; // 100 mUSDC in any trailing 24h

    function setUp() public {
        // Start at a realistic timestamp so the 24h window arithmetic is exercised properly
        // rather than clamping against a near-zero block time.
        vm.warp(1_700_000_000);

        token = new MockUSDC();
        wallet = new AgentWallet(IERC20(address(token)), owner, PER_TX_CAP, ROLLING_CAP);
        token.mint(address(wallet), 1_000_000e6);

        vm.startPrank(owner);
        wallet.grantSession(agent, uint48(block.timestamp + 30 days));
        wallet.setCounterparty(vendor, TAG_VENDOR);
        wallet.setCounterparty(vendor2, TAG_VENDOR);
        wallet.setCounterparty(exchange, TAG_EXCHANGE);
        wallet.setTagEnabled(TAG_VENDOR, true);
        wallet.setTagEnabled(TAG_EXCHANGE, true);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------
    // Baseline
    // -----------------------------------------------------------------

    function test_AllowedPaymentSucceeds() public {
        vm.prank(agent);
        wallet.pay(vendor, 25e6);

        assertEq(token.balanceOf(vendor), 25e6);
        assertEq(wallet.rolling24h(), 25e6);
    }

    // -----------------------------------------------------------------
    // Core requirement 3 — the kill switch
    // -----------------------------------------------------------------

    function test_RevertWhen_Paused() public {
        vm.prank(owner);
        wallet.pause();

        vm.prank(agent);
        vm.expectRevert(AgentWallet.WalletPaused.selector);
        wallet.pay(vendor, 1e6);
    }

    function test_UnpauseRestoresOperation() public {
        vm.startPrank(owner);
        wallet.pause();
        wallet.unpause();
        vm.stopPrank();

        vm.prank(agent);
        wallet.pay(vendor, 1e6);
        assertEq(token.balanceOf(vendor), 1e6);
    }

    function test_RevertWhen_NonOwnerPauses() public {
        vm.prank(agent);
        vm.expectRevert(AgentWallet.NotOwner.selector);
        wallet.pause();

        vm.prank(stranger);
        vm.expectRevert(AgentWallet.NotOwner.selector);
        wallet.pause();
    }

    /// @dev A freeze must not lock the owner out of their own funds.
    function test_OwnerCanWithdrawWhilePaused() public {
        vm.startPrank(owner);
        wallet.pause();
        wallet.ownerWithdraw(owner, 500e6);
        vm.stopPrank();

        assertEq(token.balanceOf(owner), 500e6);
    }

    // -----------------------------------------------------------------
    // Core requirement 2 — allowlisted counterparties
    // -----------------------------------------------------------------

    function test_RevertWhen_CounterpartyNotAllowed() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AgentWallet.CounterpartyNotAllowed.selector, unknownPayee)
        );
        wallet.pay(unknownPayee, 1e6);
    }

    function test_DisablingTagBlocksWholeCategory() public {
        vm.prank(agent);
        wallet.pay(exchange, 1e6); // works while the category is enabled

        vm.prank(owner);
        wallet.setTagEnabled(TAG_EXCHANGE, false);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentWallet.CounterpartyNotAllowed.selector, exchange));
        wallet.pay(exchange, 1e6);

        // Other categories are untouched.
        vm.prank(agent);
        wallet.pay(vendor, 1e6);
    }

    function test_RemovingCounterpartyBlocksIt() public {
        vm.prank(owner);
        wallet.setCounterparty(vendor, bytes32(0));

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentWallet.CounterpartyNotAllowed.selector, vendor));
        wallet.pay(vendor, 1e6);
    }

    // -----------------------------------------------------------------
    // Core requirement 1 — spend limits
    // -----------------------------------------------------------------

    function test_RevertWhen_PerTxCapExceeded() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AgentWallet.SpendLimitExceeded.selector, PER_TX_CAP + 1, PER_TX_CAP)
        );
        wallet.pay(vendor, PER_TX_CAP + 1);
    }

    function test_RevertWhen_RollingCapExceeded() public {
        vm.startPrank(agent);
        wallet.pay(vendor, 40e6);
        wallet.pay(vendor, 40e6); // 80 spent, 20 of the 100 cap left

        vm.expectRevert(abi.encodeWithSelector(AgentWallet.RollingLimitExceeded.selector, 40e6, 20e6));
        wallet.pay(vendor, 40e6);
        vm.stopPrank();

        assertEq(wallet.rolling24h(), 80e6);
        assertEq(wallet.remainingToday(), 20e6);
    }

    /// @dev The window genuinely rolls: spend ages out 24h after it happened, not at midnight.
    function test_RollingWindowExpiresAfter24h() public {
        vm.startPrank(agent);
        wallet.pay(vendor, 40e6);
        wallet.pay(vendor, 40e6);
        vm.stopPrank();
        assertEq(wallet.rolling24h(), 80e6);

        // One second short of the window: still counted, still blocked.
        vm.warp(block.timestamp + 24 hours - 1);
        assertEq(wallet.rolling24h(), 80e6);

        vm.warp(block.timestamp + 2);
        assertEq(wallet.rolling24h(), 0, "spend should have aged out of the window");

        vm.prank(agent);
        wallet.pay(vendor, 40e6);
        assertEq(wallet.rolling24h(), 40e6);
    }

    /// @dev With all 32 history slots live, the wallet must refuse rather than overwrite an
    /// entry that is still inside the window — overwriting would under-count the window and let
    /// spending quietly drift past the cap.
    function test_SpendHistoryFailsClosedWhenFull() public {
        vm.prank(owner);
        wallet.setLimits(1e6, 1_000e6); // caps out of the way; we are testing the buffer

        vm.startPrank(agent);
        for (uint256 i = 0; i < 32; i++) {
            wallet.pay(vendor, 1e6);
        }

        vm.expectRevert(AgentWallet.SpendHistoryFull.selector);
        wallet.pay(vendor, 1e6);
        vm.stopPrank();
    }

    function test_ThrottleScalesBothCaps() public {
        vm.prank(owner);
        wallet.setThrottle(100); // 1%

        assertEq(wallet.effectivePerTxCap(), PER_TX_CAP / 100);
        assertEq(wallet.effectiveRollingCap(), ROLLING_CAP / 100);

        // A payment that was fine at full allowance is now over the per-tx cap.
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AgentWallet.SpendLimitExceeded.selector, 25e6, PER_TX_CAP / 100)
        );
        wallet.pay(vendor, 25e6);

        // Small payments still flow — this is a throttle, not a freeze.
        vm.prank(agent);
        wallet.pay(vendor, 0.2e6);
    }

    // -----------------------------------------------------------------
    // Bonus — session keys / in-flight revocation
    // -----------------------------------------------------------------

    function test_RevertWhen_SessionRevoked() public {
        vm.prank(owner);
        wallet.revokeSession(agent);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentWallet.SessionInvalid.selector, agent));
        wallet.pay(vendor, 1e6);
    }

    function test_RevertWhen_SessionExpired() public {
        vm.warp(block.timestamp + 31 days);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentWallet.SessionInvalid.selector, agent));
        wallet.pay(vendor, 1e6);
    }

    function test_RevertWhen_CallerHasNoSession() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AgentWallet.SessionInvalid.selector, stranger));
        wallet.pay(vendor, 1e6);
    }

    // -----------------------------------------------------------------
    // Batch execution — the in-flight kill
    // -----------------------------------------------------------------

    function test_BatchExecutesEveryLegWhenCompliant() public {
        AgentWallet.Payment[] memory ps = new AgentWallet.Payment[](3);
        ps[0] = AgentWallet.Payment({to: vendor, amount: 30e6});
        ps[1] = AgentWallet.Payment({to: vendor2, amount: 30e6});
        ps[2] = AgentWallet.Payment({to: exchange, amount: 30e6});

        vm.prank(agent);
        wallet.payBatch(ps);

        assertEq(token.balanceOf(vendor), 30e6);
        assertEq(token.balanceOf(vendor2), 30e6);
        assertEq(token.balanceOf(exchange), 30e6);
    }

    function test_BatchStopsAtFirstDisallowedCounterparty() public {
        AgentWallet.Payment[] memory ps = new AgentWallet.Payment[](3);
        ps[0] = AgentWallet.Payment({to: vendor, amount: 10e6});
        ps[1] = AgentWallet.Payment({to: unknownPayee, amount: 10e6});
        ps[2] = AgentWallet.Payment({to: vendor2, amount: 10e6});

        vm.expectEmit(true, true, true, true, address(wallet));
        emit AgentWallet.PaymentBlocked(
            1, agent, unknownPayee, 10e6, AgentWallet.BlockReason.CounterpartyNotAllowed
        );

        vm.prank(agent);
        wallet.payBatch(ps);

        assertEq(token.balanceOf(vendor), 10e6, "leg 0 should have gone through");
        assertEq(token.balanceOf(unknownPayee), 0, "leg 1 must be blocked");
        assertEq(token.balanceOf(vendor2), 0, "leg 2 must never run");
    }

    /// @dev THE headline test. The owner's freeze lands part-way through a running multi-leg
    /// payment, and the run stops dead at the very next leg. Not "the next transaction is
    /// rejected" — the batch already in flight halts.
    function test_BatchHaltsMidFlightWhenPausedBetweenLegs() public {
        PausingToken pausing = new PausingToken();
        AgentWallet w = new AgentWallet(IERC20(address(pausing)), owner, PER_TX_CAP, ROLLING_CAP);
        pausing.mint(address(w), 1_000e6);

        vm.startPrank(owner);
        w.grantSession(agent, uint48(block.timestamp + 30 days));
        w.setCounterparty(vendor, TAG_VENDOR);
        w.setCounterparty(vendor2, TAG_VENDOR);
        w.setTagEnabled(TAG_VENDOR, true);
        // Hand the freeze authority to the token so it can pull the switch mid-transfer.
        w.transferOwnership(address(pausing));
        vm.stopPrank();

        pausing.arm(w);

        AgentWallet.Payment[] memory ps = new AgentWallet.Payment[](3);
        ps[0] = AgentWallet.Payment({to: vendor, amount: 10e6});
        ps[1] = AgentWallet.Payment({to: vendor2, amount: 10e6});
        ps[2] = AgentWallet.Payment({to: vendor, amount: 10e6});

        vm.expectEmit(true, true, true, true, address(w));
        emit AgentWallet.PaymentBlocked(1, agent, vendor2, 10e6, AgentWallet.BlockReason.Paused);

        vm.prank(agent);
        w.payBatch(ps);

        assertTrue(w.paused(), "freeze landed during the batch");
        assertEq(pausing.balanceOf(vendor), 10e6, "leg 0 completed before the freeze");
        assertEq(pausing.balanceOf(vendor2), 0, "leg 1 was killed in flight");
        assertEq(w.rolling24h(), 10e6, "only the completed leg is accounted for");
    }

    function test_BatchStopsWhenRollingCapTripsPartWay() public {
        AgentWallet.Payment[] memory ps = new AgentWallet.Payment[](4);
        ps[0] = AgentWallet.Payment({to: vendor, amount: 40e6});
        ps[1] = AgentWallet.Payment({to: vendor, amount: 40e6});
        ps[2] = AgentWallet.Payment({to: vendor, amount: 40e6}); // 120 > 100 cap
        ps[3] = AgentWallet.Payment({to: vendor, amount: 1e6});

        vm.expectEmit(true, true, true, true, address(wallet));
        emit AgentWallet.PaymentBlocked(
            2, agent, vendor, 40e6, AgentWallet.BlockReason.RollingCapExceeded
        );

        vm.prank(agent);
        wallet.payBatch(ps);

        assertEq(wallet.rolling24h(), 80e6);
        assertEq(token.balanceOf(vendor), 80e6);
    }

    function test_RevertWhen_BatchEmpty() public {
        AgentWallet.Payment[] memory ps = new AgentWallet.Payment[](0);
        vm.prank(agent);
        vm.expectRevert(AgentWallet.EmptyBatch.selector);
        wallet.payBatch(ps);
    }

    // -----------------------------------------------------------------
    // simulate() must agree with pay()
    // -----------------------------------------------------------------

    function test_SimulateMatchesExecution() public {
        assertEq(
            uint256(wallet.simulate(agent, vendor, 25e6)), uint256(AgentWallet.BlockReason.None)
        );
        assertEq(
            uint256(wallet.simulate(agent, unknownPayee, 25e6)),
            uint256(AgentWallet.BlockReason.CounterpartyNotAllowed)
        );
        assertEq(
            uint256(wallet.simulate(agent, vendor, PER_TX_CAP + 1)),
            uint256(AgentWallet.BlockReason.PerTxCapExceeded)
        );

        vm.prank(owner);
        wallet.pause();
        assertEq(
            uint256(wallet.simulate(agent, vendor, 1e6)), uint256(AgentWallet.BlockReason.Paused)
        );
    }

    // -----------------------------------------------------------------
    // Fuzz — the property that actually matters
    // -----------------------------------------------------------------

    /// @dev The property the whole project rests on: whatever the agent asks for, a single call
    /// can never move more than the per-tx cap and can never reach a non-allowlisted address.
    ///
    /// The payee is drawn from a small set (three allowlisted, one not) rather than fuzzed over
    /// the full address space on purpose. A fully random `to` is essentially never on the
    /// allowlist, so every run would take the revert branch and the success branch — where the
    /// interesting assertions live — would go unexercised while the test still reported green.
    function testFuzz_AgentNeverMovesMoreThanPerTxCap(uint256 amount, uint8 payeeSelector) public {
        address[4] memory payees = [vendor, vendor2, exchange, unknownPayee];
        address to = payees[payeeSelector % 4];
        amount = bound(amount, 0, 10_000e6);

        uint256 before = token.balanceOf(address(wallet));

        vm.prank(agent);
        try wallet.pay(to, amount) {
            uint256 moved = before - token.balanceOf(address(wallet));
            assertLe(moved, wallet.effectivePerTxCap(), "per-tx cap breached");
            assertLe(wallet.rolling24h(), wallet.effectiveRollingCap(), "rolling cap breached");
            assertTrue(wallet.isAllowed(to), "paid a counterparty that is not allowlisted");
            assertFalse(wallet.paused(), "paid while frozen");
        } catch {
            assertEq(token.balanceOf(address(wallet)), before, "reverted call still moved funds");
        }
    }

    /// @dev Nobody without a live session key can move funds, no matter who they are.
    function testFuzz_OnlySessionKeyCanPay(address caller) public {
        vm.assume(caller != agent);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(AgentWallet.SessionInvalid.selector, caller));
        wallet.pay(vendor, 1e6);
    }
}
