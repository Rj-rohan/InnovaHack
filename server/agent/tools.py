"""The agent's tools.

Schemas are OpenAI function-calling format, which both Gemini and Groq accept through their
compatible endpoints.

The load-bearing property of this module: `send_payment` performs no validation. The verification
tools around it (`match_purchase_order`, `check_duplicate`, `get_vendor_history`) are advisory —
the agent can call all three, ignore every answer, and still broadcast the payment. They exist so
the agent behaves like a real finance system, not so they can stop it. Every actual guard lives in
the contract.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Callable

from agent.ledger import Ledger
from chain.client import extract_policy_reason, get_chain
from config import from_base_units, get_deployment, to_base_units

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
            "description": (
                "List invoices awaiting a decision. Invoices arrive over time, so this can return "
                "different results between cycles."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "match_purchase_order",
            "description": (
                "Look up the purchase order an invoice references and compare the approved amount "
                "against the invoiced amount. Reports whether a PO exists, whether it is still "
                "open, and the variance."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {"type": "string", "description": "e.g. INV-2041."},
                },
                "required": ["invoice_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_duplicate",
            "description": (
                "Check whether an invoice duplicates one already paid — same vendor, same amount. "
                "Vendors re-send invoices and paying twice is unrecoverable."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {"type": "string", "description": "e.g. INV-2044."},
                },
                "required": ["invoice_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_vendor_history",
            "description": (
                "Payment history for a vendor: how many times they have been paid, their average "
                "and largest payment, when they were first seen, and whether they are an approved "
                "counterparty. Use it to judge whether an amount is in line with the norm."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "vendor": {
                        "type": "string",
                        "description": "Vendor name or payment address.",
                    },
                },
                "required": ["vendor"],
            },
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
                    "invoice_id": {
                        "type": "string",
                        "description": "The invoice this payment settles, e.g. INV-2041.",
                    },
                },
                "required": ["vendor", "to", "amount_usdc"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "hold_for_review",
            "description": (
                "Flag an invoice for a human to review instead of paying it. Use when something "
                "does not add up: no purchase order, an amount far outside the vendor's pattern, "
                "an unknown vendor, or changed payment details. Pays nothing."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {"type": "string", "description": "e.g. INV-2045."},
                    "reason": {
                        "type": "string",
                        "description": "Plain-language reason a human can act on.",
                    },
                },
                "required": ["invoice_id", "reason"],
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
    """Per-tick tool implementations bound to one ledger."""

    def __init__(self, ledger: Ledger) -> None:
        self.ledger = ledger
        self.chain = get_chain()
        self.payments: list[PaymentRecord] = []
        #: Review items created this tick, mirrored to Mongo by the loop.
        self.holds: list[Any] = []

    # -- reads ---------------------------------------------------------------

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
        invoices = [inv.as_dict(self.ledger.decimals) for inv in self.ledger.visible()]
        if not invoices:
            return json.dumps({"invoices": [], "note": "Nothing awaiting a decision right now."})
        return json.dumps({"invoices": invoices})

    def match_purchase_order(self, invoice_id: str) -> str:
        invoice = self.ledger.find(invoice_id)
        if invoice is None:
            return json.dumps({"error": f"no invoice {invoice_id}"})

        po = self.ledger.po_for(invoice_id)
        if po is None:
            return json.dumps(
                {
                    "invoice_id": invoice.id,
                    "purchase_order_found": False,
                    "note": "No purchase order references this invoice.",
                }
            )

        variance = invoice.amount - po.approved_amount
        scale = 10**self.ledger.decimals
        return json.dumps(
            {
                "invoice_id": invoice.id,
                "purchase_order_found": True,
                "purchase_order": po.as_dict(self.ledger.decimals),
                "invoiced_amount_usdc": round(invoice.amount / scale, 2),
                "variance_usdc": round(variance / scale, 2),
                "amount_matches": variance == 0,
                "purchase_order_already_consumed": po.status == "consumed",
            }
        )

    def check_duplicate(self, invoice_id: str) -> str:
        invoice = self.ledger.find(invoice_id)
        if invoice is None:
            return json.dumps({"error": f"no invoice {invoice_id}"})

        duplicate = self.ledger.duplicate_of(invoice_id)
        if duplicate is None:
            return json.dumps({"invoice_id": invoice.id, "is_duplicate": False})

        return json.dumps(
            {
                "invoice_id": invoice.id,
                "is_duplicate": True,
                "duplicates": duplicate.id,
                "note": (
                    f"{duplicate.id} was already paid to {duplicate.vendor} for the same amount."
                ),
            }
        )

    def get_vendor_history(self, vendor: str) -> str:
        record = self.ledger.vendor_for(vendor)
        if record is None:
            return json.dumps(
                {
                    "vendor": vendor,
                    "known_vendor": False,
                    "payments_on_record": 0,
                    "note": "No payment history. This vendor has never been paid before.",
                }
            )

        payload = record.as_dict(self.ledger.decimals)
        payload["approved_counterparty"] = self.chain.is_allowed(record.address)
        return json.dumps(payload)

    def simulate_payment(self, to: str, amount_usdc: float) -> str:
        amount = to_base_units(float(amount_usdc))
        reason = self.chain.simulate(to, amount)
        if reason == "None":
            return json.dumps({"would_succeed": True})
        return json.dumps({"would_succeed": False, "reason": reason})

    # -- writes --------------------------------------------------------------

    def send_payment(
        self, vendor: str, to: str, amount_usdc: float, invoice_id: str | None = None
    ) -> str:
        """Sign and broadcast. No checks — see the module docstring."""
        amount = to_base_units(float(amount_usdc))

        try:
            tx_hash = self.chain.send_payment(to, amount)
        except Exception as exc:  # noqa: BLE001
            # Never reached the chain (node rejected it, bad address, no gas, RPC down). Still
            # recorded as an attempt: an audit trail that only shows successes is not one.
            #
            # A node with eager validation refuses a policy-violating transaction at submission
            # rather than mining it, so pull the contract's own error out of the message — the
            # dashboard should say "CounterpartyNotAllowed", not show a JSON-RPC blob.
            policy_reason = extract_policy_reason(exc)
            message = str(exc)
            self.payments.append(
                PaymentRecord(
                    vendor=vendor, to=to, amount=amount, tx_hash=None,
                    status="blocked", reason=policy_reason or message[:200],
                )
            )
            log.warning("broadcast refused for %s: %s", to, policy_reason or message[:160])
            return json.dumps(
                {
                    "sent": False,
                    "refused_by_contract": policy_reason is not None,
                    "reason": policy_reason,
                    "error": message[:300],
                }
            )

        if not tx_hash.startswith("0x"):
            tx_hash = "0x" + tx_hash

        self.ledger.mark_paid(to, amount, invoice_id=invoice_id)
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

    def hold_for_review(self, invoice_id: str, reason: str) -> str:
        item = self.ledger.hold(invoice_id, reason)
        if item is None:
            return json.dumps({"error": f"no invoice {invoice_id}"})

        self.holds.append(item)
        return json.dumps(
            {
                "held": True,
                "invoice_id": item.invoice_id,
                "note": "Queued for owner review. No payment was made.",
            }
        )

    # -- dispatch ------------------------------------------------------------

    def handlers(self) -> dict[str, Callable[..., str]]:
        return {
            "get_wallet_state": self.get_wallet_state,
            "list_pending_invoices": self.list_pending_invoices,
            "match_purchase_order": self.match_purchase_order,
            "check_duplicate": self.check_duplicate,
            "get_vendor_history": self.get_vendor_history,
            "simulate_payment": self.simulate_payment,
            "send_payment": self.send_payment,
            "hold_for_review": self.hold_for_review,
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
