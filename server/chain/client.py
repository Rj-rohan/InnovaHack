"""Chain access for the agent.

The agent signs with a session key that can do exactly one thing: propose a payment. It cannot
pause, unpause, change limits, edit the allowlist, or withdraw — those are owner-only, and the
owner key is not present in this process.

Nothing in this module validates policy. That is deliberate and load-bearing; see `send_payment`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from eth_account import Account
from web3 import Web3
from web3.exceptions import ContractLogicError

from config import get_deployment, get_settings

log = logging.getLogger(__name__)

BLOCK_REASONS = [
    "None",
    "Paused",
    "SessionInvalid",
    "CounterpartyNotAllowed",
    "PerTxCapExceeded",
    "RollingCapExceeded",
    "InsufficientBalance",
]

# Used when gas estimation fails. A policy-violating transaction reverts during estimation, so
# estimation failure is the NORMAL case for the attack scenario — see send_payment.
FALLBACK_GAS = 250_000


@dataclass
class PolicySnapshot:
    paused: bool
    throttle_bps: int
    per_tx_cap: int
    rolling_cap: int
    spent_in_window: int
    remaining: int
    balance: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "paused": self.paused,
            "throttleBps": self.throttle_bps,
            "perTxCap": str(self.per_tx_cap),
            "rollingCap": str(self.rolling_cap),
            "spentInWindow": str(self.spent_in_window),
            "remaining": str(self.remaining),
            "balance": str(self.balance),
        }


class ChainClient:
    def __init__(self) -> None:
        settings = get_settings()
        deployment = get_deployment()
        self.deployment = deployment

        self.w3 = Web3(Web3.HTTPProvider(settings.rpc_url, request_kwargs={"timeout": 30}))
        self.account = Account.from_key(settings.session_key_private)
        self.address = self.w3.to_checksum_address(self.account.address)

        self.wallet = self.w3.eth.contract(
            address=self.w3.to_checksum_address(deployment.wallet_address),
            abi=deployment.wallet_abi,
        )
        self.token = self.w3.eth.contract(
            address=self.w3.to_checksum_address(deployment.token_address),
            abi=deployment.token_abi,
        )

        if self.address.lower() == deployment.owner.lower():
            raise RuntimeError(
                "AGENT_SESSION_KEY_PRIVATE is the OWNER key. The agent would be able to unfreeze "
                "itself, which defeats the entire design. Generate a separate session key."
            )

    # -- reads ---------------------------------------------------------------

    def policy_snapshot(self) -> PolicySnapshot:
        paused, throttle, tx_cap, day_cap, spent, remaining, balance = (
            self.wallet.functions.policySnapshot().call()
        )
        return PolicySnapshot(
            paused=paused,
            throttle_bps=int(throttle),
            per_tx_cap=int(tx_cap),
            rolling_cap=int(day_cap),
            spent_in_window=int(spent),
            remaining=int(remaining),
            balance=int(balance),
        )

    def is_allowed(self, to: str) -> bool:
        return bool(self.wallet.functions.isAllowed(self.w3.to_checksum_address(to)).call())

    def simulate(self, to: str, amount: int) -> str:
        """Dry-run a payment. Returns a BlockReason name; 'None' means it would go through.

        This lets the agent OBSERVE policy. It is not enforcement — `send_payment` below does not
        consult it, and the contract re-derives the answer from storage regardless of what this
        returned or whether it was called at all.
        """
        try:
            index = self.wallet.functions.simulate(
                self.address, self.w3.to_checksum_address(to), int(amount)
            ).call()
            return BLOCK_REASONS[int(index)] if int(index) < len(BLOCK_REASONS) else "Unknown"
        except Exception as exc:  # noqa: BLE001 - a failed simulation must not kill the tick
            log.warning("simulate() failed: %s", exc)
            return "SimulationUnavailable"

    def eth_balance(self) -> int:
        return int(self.w3.eth.get_balance(self.address))

    # -- writes --------------------------------------------------------------

    def send_payment(self, to: str, amount: int) -> str:
        """Build, sign and broadcast a payment. Returns the transaction hash.

        NO POLICY CHECKS HERE. Deliberately.

        Whatever the model asked for is what gets signed and broadcast. If it violates policy the
        contract reverts and we report that revert verbatim. Adding a client-side guard here would
        make the demo a lie: the claim is that enforcement does not depend on this process
        behaving, and the only way to show that is to let this process misbehave.
        """
        checksummed = self.w3.to_checksum_address(to)
        nonce = self.w3.eth.get_transaction_count(self.address, "pending")

        call = self.wallet.functions.pay(checksummed, int(amount))

        # Estimation runs the call against current state, so a policy-violating payment fails
        # here rather than on chain. That must NOT stop the broadcast: a reverted transaction on
        # Sepolia, visible on Etherscan, is the entire point of the attack scenario. Falling back
        # to a fixed gas limit is what lets the block actually happen where judges can see it.
        try:
            gas = int(call.estimate_gas({"from": self.address}) * 1.25)
        except (ContractLogicError, ValueError) as exc:
            log.info("gas estimation reverted (expected for a blocked payment): %s", exc)
            gas = FALLBACK_GAS

        base_fee = self.w3.eth.get_block("latest").get("baseFeePerGas", 0) or 0
        priority = self.w3.to_wei(2, "gwei")

        tx = call.build_transaction(
            {
                "from": self.address,
                "nonce": nonce,
                "gas": gas,
                "maxPriorityFeePerGas": priority,
                "maxFeePerGas": base_fee * 2 + priority,
                "chainId": self.deployment.chain_id,
            }
        )

        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return tx_hash.hex()

    def send_batch(self, payments: list[tuple[str, int]]) -> str:
        """Multi-leg payment in one transaction. Same no-checks rule as `send_payment`."""
        legs = [(self.w3.to_checksum_address(to), int(amount)) for to, amount in payments]
        nonce = self.w3.eth.get_transaction_count(self.address, "pending")
        call = self.wallet.functions.payBatch(legs)

        try:
            gas = int(call.estimate_gas({"from": self.address}) * 1.3)
        except (ContractLogicError, ValueError):
            gas = FALLBACK_GAS + 150_000 * len(legs)

        base_fee = self.w3.eth.get_block("latest").get("baseFeePerGas", 0) or 0
        priority = self.w3.to_wei(2, "gwei")

        tx = call.build_transaction(
            {
                "from": self.address,
                "nonce": nonce,
                "gas": gas,
                "maxPriorityFeePerGas": priority,
                "maxFeePerGas": base_fee * 2 + priority,
                "chainId": self.deployment.chain_id,
            }
        )
        signed = self.account.sign_transaction(tx)
        return self.w3.eth.send_raw_transaction(signed.raw_transaction).hex()


_client: ChainClient | None = None


def get_chain() -> ChainClient:
    global _client
    if _client is None:
        _client = ChainClient()
    return _client
