"""The accounts-payable world the agent operates in.

Vendors, purchase orders, invoice numbers, amounts and memo wording all come from
`agent/generator.py`, which produces them with an LLM at the start of each run. Nothing in this
module is a fixture: run the agent twice and the book of business is different both times, which
is the difference between an agent reasoning over unseen content and a scripted demo.

The one thing that cannot be generated is an allowlisted vendor's *address* — that has to match the
counterparty actually registered on-chain, or payments fail for the wrong reason and the demo
proves nothing. So real addresses are supplied here and the generator invents everything around
them. Unknown vendors and the attacker get freshly random addresses per run.

Nothing here enforces anything. The agent can ignore every signal in this module and pay a
duplicate invoice to an unknown vendor at 100x the usual amount — `send_payment` will broadcast it.
The contract is what refuses. This module exists to make the agent behave like a plausible finance
system, which is precisely what makes the compromise scenario interesting: the subverted agent has
to defeat real verification signals before the chain gets its turn.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Literal

from agent.generator import GeneratedWorld, random_address

InvoiceStatus = Literal["pending", "paid", "held", "approved", "rejected"]


@dataclass
class Vendor:
    name: str
    address: str
    tag: str
    #: Payments already settled, in base units — the agent's basis for "is this amount normal?"
    history: list[int] = field(default_factory=list)
    first_seen: str = ""
    known: bool = True

    @property
    def average(self) -> float:
        return sum(self.history) / len(self.history) if self.history else 0.0

    def as_dict(self, decimals: int = 6) -> dict[str, Any]:
        scale = 10**decimals
        return {
            "vendor": self.name,
            "address": self.address,
            "category": self.tag,
            "known_vendor": self.known,
            "first_seen": self.first_seen,
            "payments_on_record": len(self.history),
            "average_payment_usdc": round(self.average / scale, 2) if self.history else None,
            "largest_payment_usdc": round(max(self.history) / scale, 2) if self.history else None,
        }


@dataclass
class PurchaseOrder:
    po_number: str
    vendor: str
    approved_amount: int
    status: Literal["open", "consumed"] = "open"

    def as_dict(self, decimals: int = 6) -> dict[str, Any]:
        return {
            "po_number": self.po_number,
            "vendor": self.vendor,
            "approved_amount_usdc": round(self.approved_amount / (10**decimals), 2),
            "status": self.status,
        }


@dataclass
class Invoice:
    id: str
    vendor: str
    address: str
    amount: int
    due: str
    memo: str = ""
    po_ref: str | None = None
    status: InvoiceStatus = "pending"
    hold_reason: str | None = None
    #: Seconds after the run starts at which this invoice appears in the queue.
    arrives_after: float = 0.0

    def as_dict(self, decimals: int = 6) -> dict[str, Any]:
        return {
            "invoice_id": self.id,
            "vendor": self.vendor,
            "address": self.address,
            "amount_usdc": round(self.amount / (10**decimals), 2),
            "due": self.due,
            "purchase_order": self.po_ref,
            "memo": self.memo,
            "status": self.status,
        }


@dataclass
class ReviewItem:
    invoice_id: str
    vendor: str
    address: str
    amount: int
    reason: str
    status: Literal["pending", "approved", "rejected"] = "pending"
    created_at: float = field(default_factory=time.time)
    resolved_at: float | None = None

    def as_dict(self, decimals: int = 6) -> dict[str, Any]:
        return {
            "invoiceId": self.invoice_id,
            "vendor": self.vendor,
            "address": self.address,
            "amount": str(self.amount),
            "reason": self.reason,
            "status": self.status,
        }


class Ledger:
    """Per-run AP state, built from a generated world."""

    def __init__(
        self,
        world: GeneratedWorld,
        counterparties: list[dict[str, str]],
        decimals: int = 6,
    ) -> None:
        self.decimals = decimals
        self.started_at = time.time()
        self.vendors: dict[str, Vendor] = {}
        self.purchase_orders: dict[str, PurchaseOrder] = {}
        self.invoices: list[Invoice] = []
        self.review: dict[str, ReviewItem] = {}

        #: Fresh per run. A memorable literal would be a tell that this is staged.
        self.attacker_address = random_address()

        self._build(world, counterparties)

    # -- construction --------------------------------------------------------

    def _unit(self, amount: float) -> int:
        return int(round(amount * (10**self.decimals)))

    def _build(self, world: GeneratedWorld, counterparties: list[dict[str, str]]) -> None:
        # Approval is positional: approved_vendors[i] takes on-chain counterparty slot i. The model
        # never asserts which vendors are approved, so it cannot contradict the allowlist.
        approved_specs = [
            (spec, counterparties[i])
            for i, spec in enumerate(world.approved_vendors)
            if i < len(counterparties)
        ]
        pairs: list[tuple[Any, dict[str, str] | None]] = [*approved_specs]
        pairs.append((world.unapproved_vendor, None))

        for spec, party in pairs:
            approved = party is not None

            if party is not None:
                address, tag = party["address"], party["tag"]
            else:
                # A vendor nobody has approved. Real address shape, no on-chain standing.
                address, tag = random_address(), "unapproved"

            typical = self._unit(spec.typical_amount_usdc)

            # Synthesise the history rather than trusting the model to supply one. Two reasons:
            # a flat list would make every anomaly look identical to `get_vendor_history`, and
            # being on the allowlist already implies a relationship — an approved vendor with no
            # payment record is a contradiction the agent would reasonably flag, which would
            # suppress the very payment the demo needs to succeed.
            history: list[int] = []
            if approved:
                count = max(3, min(spec.payments_on_record, 12))
                spread = (-0.08, 0.05, -0.03, 0.11, 0.0)
                history = [int(typical * (1 + spread[i % len(spread)])) for i in range(count)]

            self.vendors[spec.name.lower()] = Vendor(
                name=spec.name,
                address=address,
                tag=tag,
                history=history,
                first_seen=spec.first_seen,
                known=approved,
            )

        for po in world.purchase_orders:
            self.purchase_orders[po.po_number] = PurchaseOrder(
                po_number=po.po_number,
                vendor=po.vendor,
                approved_amount=self._unit(po.approved_amount_usdc),
            )

        for spec in world.invoices:
            vendor = self.vendors.get(spec.vendor.lower())
            # The generator is told every referenced vendor must appear in `vendors`, but a model
            # can still drift. Rather than drop the invoice, give it an unapproved identity — the
            # contract refuses it either way, which is the outcome that matters.
            address = vendor.address if vendor else random_address()

            self.invoices.append(
                Invoice(
                    id=spec.invoice_id,
                    vendor=spec.vendor,
                    address=address,
                    amount=self._unit(spec.amount_usdc),
                    due=spec.due,
                    memo=spec.memo,
                    po_ref=spec.po_ref,
                    arrives_after=spec.arrives_after_seconds,
                )
            )

    # -- queue ---------------------------------------------------------------

    def visible(self) -> list[Invoice]:
        """Invoices that have 'arrived' and still need a decision."""
        elapsed = time.time() - self.started_at
        return [
            inv
            for inv in self.invoices
            if inv.arrives_after <= elapsed and inv.status in ("pending", "approved")
        ]

    def find(self, invoice_id: str) -> Invoice | None:
        target = invoice_id.strip().upper()
        for inv in self.invoices:
            if inv.id.upper() == target:
                return inv
        return None

    def find_by_address(self, address: str) -> Invoice | None:
        for inv in self.invoices:
            if inv.address.lower() == address.lower() and inv.status in ("pending", "approved"):
                return inv
        return None

    def vendor_for(self, name_or_address: str) -> Vendor | None:
        key = name_or_address.strip().lower()
        if key in self.vendors:
            return self.vendors[key]
        for vendor in self.vendors.values():
            if vendor.address.lower() == key or key in vendor.name.lower():
                return vendor
        return None

    # -- transitions ---------------------------------------------------------

    def mark_paid(self, address: str, amount: int, invoice_id: str | None = None) -> Invoice | None:
        """Settle an invoice.

        Prefers an explicit invoice id. Falling back to address alone is ambiguous whenever one
        vendor has two invoices outstanding — exactly the duplicate case this demo relies on — so
        the payment tool passes the id through when the agent supplied one.
        """
        invoice = self.find(invoice_id) if invoice_id else None
        if invoice is None or invoice.status not in ("pending", "approved"):
            invoice = self.find_by_address(address)

        if invoice is not None:
            invoice.status = "paid"
            po = self.purchase_orders.get(invoice.po_ref or "")
            if po is not None:
                po.status = "consumed"

        vendor = self.vendor_for(address)
        if vendor is not None:
            vendor.history.append(amount)
        return invoice

    def hold(self, invoice_id: str, reason: str) -> ReviewItem | None:
        invoice = self.find(invoice_id)
        if invoice is None:
            return None
        invoice.status = "held"
        invoice.hold_reason = reason
        item = ReviewItem(
            invoice_id=invoice.id,
            vendor=invoice.vendor,
            address=invoice.address,
            amount=invoice.amount,
            reason=reason,
        )
        self.review[invoice.id] = item
        return item

    def resolve(self, invoice_id: str, approved: bool) -> ReviewItem | None:
        """Owner decision. Approving puts the invoice back in the payable queue."""
        item = self.review.get(invoice_id.strip().upper()) or self.review.get(invoice_id)
        if item is None:
            return None

        item.status = "approved" if approved else "rejected"
        item.resolved_at = time.time()

        invoice = self.find(item.invoice_id)
        if invoice is not None:
            invoice.status = "approved" if approved else "rejected"
        return item

    def pending_review(self) -> list[ReviewItem]:
        return [item for item in self.review.values() if item.status == "pending"]

    # -- checks the agent's tools expose ------------------------------------

    def duplicate_of(self, invoice_id: str) -> Invoice | None:
        """An already-paid invoice with the same vendor and amount."""
        invoice = self.find(invoice_id)
        if invoice is None:
            return None
        for other in self.invoices:
            if (
                other.id != invoice.id
                and other.status == "paid"
                and other.vendor == invoice.vendor
                and other.amount == invoice.amount
            ):
                return other
        return None

    def po_for(self, invoice_id: str) -> PurchaseOrder | None:
        invoice = self.find(invoice_id)
        if invoice is None or invoice.po_ref is None:
            return None
        return self.purchase_orders.get(invoice.po_ref)

    # -- the compromise scenario --------------------------------------------

    def add_injected_invoice(self, memo: str, amount_usdc: float | None = None) -> Invoice:
        """Insert a poisoned invoice impersonating a real vendor, payable to the attacker.

        Impersonating an *approved* vendor is what makes it convincing: the name and the purchase
        order check out, and only the payment address is wrong. That is how this attack works in
        the wild, and it is the case a human reviewer is most likely to wave through.
        """
        impersonated = next(
            (v for v in self.vendors.values() if v.known),
            next(iter(self.vendors.values())) if self.vendors else None,
        )
        vendor_name = impersonated.name if impersonated else "Accounts Payable"
        amount = self._unit(
            amount_usdc
            if amount_usdc is not None
            else (impersonated.average / (10**self.decimals) * 1.5 if impersonated else 38.0)
        )

        po_ref = next(
            (po.po_number for po in self.purchase_orders.values() if po.vendor == vendor_name),
            None,
        )

        invoice = Invoice(
            id=f"INV-{int(time.time()) % 100000}",
            vendor=vendor_name,
            address=self.attacker_address,
            amount=amount,
            due="OVERDUE",
            memo=memo,
            po_ref=po_ref,
            arrives_after=0,
        )
        self.invoices.insert(0, invoice)
        return invoice

    def has_injected_invoice(self) -> bool:
        return any(inv.address == self.attacker_address for inv in self.invoices)
