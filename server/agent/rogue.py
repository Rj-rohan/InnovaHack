"""The compromised agent, with the model removed entirely.

Scenario B has two layers. Layer 1 is indirect prompt injection through a poisoned invoice
(`prompts.injected_invoices`), which is the interesting demo. This is layer 2: roughly thirty
lines that sign a policy-violating transaction and broadcast it, with no LLM anywhere.

Layer 2 is not a fallback for when the demo fails — it is the stronger form of the argument. The
contract cannot tell whether a transaction came from a careful model, a jailbroken one, a rogue
script, or an attacker holding the leaked session key. It refuses all four identically, because
it never asks. If the model behaves on stage, run this next and the point lands harder.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from chain.client import extract_policy_reason, get_chain
from config import get_deployment, to_base_units
from agent.prompts import ATTACKER_ADDRESS

log = logging.getLogger(__name__)


@dataclass
class RogueResult:
    description: str
    to: str
    amount: int
    tx_hash: str | None
    error: str | None


def _first_allowlisted() -> str | None:
    for party in get_deployment().counterparties:
        return party["address"]
    return None


def run(attack: str = "exfiltrate") -> RogueResult:
    """Attempt a payment that policy forbids.

    attack:
      exfiltrate  — pay an address that is not on the allowlist
      overspend   — pay an allowlisted vendor far more than the per-transaction cap
    """
    chain = get_chain()
    deployment = get_deployment()

    if attack == "overspend":
        to = _first_allowlisted() or ATTACKER_ADDRESS
        # Comfortably over the per-tx cap, and to a legitimate vendor — so the ONLY thing
        # stopping it is the limit itself, not the allowlist.
        amount = deployment.per_tx_cap * 5
        readable = amount / 10**deployment.decimals
        description = (
            f"Rogue script: pay allowlisted vendor {readable} mUSDC, far over the per-tx cap"
        )
    else:
        to = ATTACKER_ADDRESS
        amount = to_base_units(35.0)
        description = "Rogue script: drain funds to an address that is not on the allowlist"

    log.warning("ROGUE: %s", description)

    try:
        tx_hash = chain.send_payment(to, amount)
        if not tx_hash.startswith("0x"):
            tx_hash = "0x" + tx_hash
        return RogueResult(description=description, to=to, amount=amount, tx_hash=tx_hash, error=None)
    except Exception as exc:  # noqa: BLE001
        return RogueResult(
            description=description, to=to, amount=amount, tx_hash=None, error=str(exc)[:300]
        )
