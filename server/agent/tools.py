"""The agent's tools.

Schemas are OpenAI function-calling format, which both Gemini and Groq accept through their
compatible endpoints.

The important property of this module: `send_payment` performs no validation. It signs and
broadcasts whatever the model asked for. Every guard lives in the contract.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Callable

from chain.client import get_chain
from config import get_deployment, from_base_units, to_base_units
from agent.prompts import InvoiceBook

log = logging.getLogger(__name__)

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_wallet_state",
            "description": (
                "Read the wallet's current balance, spend limits, how much has been spent in the "
                "rolling 24h window, and whether the owner has frozen the wallet."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_pending_invoices",
            "description": "List invoices that have not been paid yet.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "simulate_payment",
            "description": (
                "Check whether a payment would be permitted, without sending it. Returns 'None' "
                "if it would succeed, otherwise the reason it would be refused."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient address (0x…)."},
                    "amount_usdc": {"type": "number", "description": "Amount in mUSDC."},
                },
                "required": ["to", "amount_usdc"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_payment",
            "description": (
                "Send a payment from the wallet. Returns the transaction hash once broadcast. "
                "The transaction may still be refused on-chain after broadcast."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "vendor": {"type": "string", "description": "Vendor name, for the record."},
                    "to": {"type": "string", "description": "Recipient address (0x…)."},
                    "amount_usdc": {"type": "number", "description": "Amount in mUSDC."},
                },
                "required": ["vendor", "to", "amount_usdc"],
            },
        },
    },
]


@dataclass
class PaymentRecord:
    """A broadcast attempt, handed back to the loop so it can be written to the database."""

    vendor: str
    to: str
    amount: int
    tx_hash: str | None
    status: str  # "pending" once broadcast, "blocked" if it never made it out
    reason: str | None


class ToolBox:
    """Per-tick tool implementations bound to one invoice book."""

    def __init__(self, book: InvoiceBook) -> None:
        self.book = book
        self.chain = get_chain()
        self.payments: list[PaymentRecord] = []

    # -- individual tools ----------------------------------------------------

    def get_wallet_state(self) -> str:
        snapshot = self.chain.policy_snapshot()
        return json.dumps(
            {
                "balance_usdc": round(from_base_units(snapshot.balance), 2),
                "per_transaction_cap_usdc": round(from_base_units(snapshot.per_tx_cap), 2),
                "rolling_24h_cap_usdc": round(from_base_units(snapshot.rolling_cap), 2),
                "spent_last_24h_usdc": round(from_base_units(snapshot.spent_in_window), 2),
                "remaining_today_usdc": round(from_base_units(snapshot.remaining), 2),
                "wallet_frozen_by_owner": snapshot.paused,
                "throttle_percent": snapshot.throttle_bps / 100,
            }
        )

    def list_pending_invoices(self) -> str:
        return json.dumps([invoice.as_dict() for invoice in self.book.pending()])

    def simulate_payment(self, to: str, amount_usdc: float) -> str:
        amount = to_base_units(float(amount_usdc))
        reason = self.chain.simulate(to, amount)
        if reason == "None":
            return json.dumps({"would_succeed": True})
        return json.dumps({"would_succeed": False, "reason": reason})

    def send_payment(self, vendor: str, to: str, amount_usdc: float) -> str:
        """Sign and broadcast. No checks — see the module docstring."""
        amount = to_base_units(float(amount_usdc))

        try:
            tx_hash = self.chain.send_payment(to, amount)
        except Exception as exc:  # noqa: BLE001
            # The transaction never made it onto the chain (bad address, no gas, RPC down). Still
            # recorded as an attempt: an audit trail that only shows successes is not one.
            message = str(exc)
            self.payments.append(
                PaymentRecord(
                    vendor=vendor, to=to, amount=amount, tx_hash=None,
                    status="blocked", reason=message[:200],
                )
            )
            log.warning("broadcast failed for %s: %s", to, message)
            return json.dumps({"sent": False, "error": message[:300]})

        if not tx_hash.startswith("0x"):
            tx_hash = "0x" + tx_hash

        self.book.mark_paid(to)
        self.payments.append(
            PaymentRecord(
                vendor=vendor, to=to, amount=amount, tx_hash=tx_hash,
                status="pending", reason=None,
            )
        )

        return json.dumps(
            {
                "sent": True,
                "tx_hash": tx_hash,
                "note": (
                    "Broadcast. The wallet contract validates this payment when it executes; "
                    "it may still be refused on-chain."
                ),
            }
        )

    # -- dispatch ------------------------------------------------------------

    def handlers(self) -> dict[str, Callable[..., str]]:
        return {
            "get_wallet_state": self.get_wallet_state,
            "list_pending_invoices": self.list_pending_invoices,
            "simulate_payment": self.simulate_payment,
            "send_payment": self.send_payment,
        }

    def call(self, name: str, raw_args: str) -> str:
        handler = self.handlers().get(name)
        if handler is None:
            return json.dumps({"error": f"unknown tool {name}"})

        try:
            args = json.loads(raw_args) if raw_args else {}
        except json.JSONDecodeError:
            # Small models occasionally emit malformed argument JSON. Report it back as a tool
            # result so the model can correct itself, rather than crashing the tick.
            return json.dumps({"error": "arguments were not valid JSON"})

        try:
            return handler(**args)
        except TypeError as exc:
            return json.dumps({"error": f"bad arguments: {exc}"})
        except Exception as exc:  # noqa: BLE001
            log.exception("tool %s failed", name)
            return json.dumps({"error": str(exc)[:300]})


def counterparties() -> list[dict[str, str]]:
    return get_deployment().counterparties
