"""Offline smoke test — verifies the SDK surfaces this service depends on.

Runs without API keys, without a deployment record, and without touching the network. It exists
because the failure mode it catches (a renamed SDK attribute) shows up at the worst possible
moment otherwise: mid-demo, on the first real transaction.

    ./.venv/Scripts/python.exe smoke_test.py
"""

from __future__ import annotations

import json
import sys

failures: list[str] = []


def check(label: str, fn) -> None:
    try:
        fn()
        print(f"  ok    {label}")
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL  {label}: {exc}")
        failures.append(label)


print("SDK surfaces")


def _signing_roundtrip() -> None:
    """The one that actually bites: web3 v6 exposed `rawTransaction`, v7 `raw_transaction`."""
    from eth_account import Account

    account = Account.from_key(
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
    )
    signed = account.sign_transaction(
        {
            "to": "0x0000000000000000000000000000000000000001",
            "value": 1,
            "gas": 21000,
            "maxFeePerGas": 10**10,
            "maxPriorityFeePerGas": 10**9,
            "nonce": 0,
            "chainId": 11155111,
        }
    )
    assert hasattr(signed, "raw_transaction"), (
        "SignedTransaction has no `raw_transaction` — this web3 version uses a different name, "
        "and chain/client.py sends `signed.raw_transaction`"
    )
    assert isinstance(account.address, str) and account.address.startswith("0x")


def _web3_contract_surface() -> None:
    from web3 import Web3

    w3 = Web3()  # no provider needed to build a contract object
    abi = json.loads(
        '[{"type":"function","name":"pay","inputs":[{"name":"to","type":"address"},'
        '{"name":"amount","type":"uint256"}],"outputs":[],"stateMutability":"nonpayable"}]'
    )
    contract = w3.eth.contract(
        address=w3.to_checksum_address("0x0000000000000000000000000000000000000002"), abi=abi
    )
    assert contract.functions.pay  # the call shape used in chain/client.py


def _openai_client_shape() -> None:
    from openai import AsyncOpenAI, APIError, APIStatusError, RateLimitError  # noqa: F401

    client = AsyncOpenAI(api_key="sk-not-a-real-key", base_url="https://example.invalid/v1")
    # Only assert the attribute path exists; calling it would hit the network.
    assert client.chat.completions.create


def _tool_schemas_valid() -> None:
    """Tool schemas must be JSON-serialisable and shaped the way both providers expect."""
    sys.path.insert(0, ".")
    from agent.tools import TOOL_SCHEMAS

    json.dumps(TOOL_SCHEMAS)
    assert len(TOOL_SCHEMAS) >= 8, "expected the full AP toolset"

    names = {s["function"]["name"] for s in TOOL_SCHEMAS}
    for required in (
        "match_purchase_order",
        "check_duplicate",
        "get_vendor_history",
        "hold_for_review",
    ):
        assert required in names, f"{required} missing from the toolset"
    for schema in TOOL_SCHEMAS:
        assert schema["type"] == "function"
        fn = schema["function"]
        assert isinstance(fn["name"], str) and fn["name"]
        assert isinstance(fn["description"], str) and fn["description"]
        params = fn["parameters"]
        assert params["type"] == "object"
        for required in params.get("required", []):
            assert required in params["properties"], (
                f"{fn['name']}: '{required}' is required but not declared in properties"
            )


PARTIES = [
    {"address": "0x1111111111111111111111111111111111111111", "tag": "vendor", "label": "Acme"},
    {"address": "0x2222222222222222222222222222222222222222", "tag": "gas", "label": "Gas Refill"},
    {"address": "0x3333333333333333333333333333333333333333", "tag": "vendor", "label": "Globex"},
]


def _sample_world():
    """A stand-in for one LLM response, so these checks run offline.

    Shaped exactly like real generator output, including one invoice of every required category.
    It exercises the schema and the ledger's mechanics; it is never used at runtime.
    """
    from agent.generator import GeneratedWorld

    return GeneratedWorld.model_validate(
        {
            "approved_vendors": [
                {
                    "name": "Harbour Freight Co",
                    "first_seen": "2024-04-02",
                    "typical_amount_usdc": 25.0,
                    "payments_on_record": 5,
                },
                {
                    "name": "Fleet Fuel Services",
                    "first_seen": "2024-08-11",
                    "typical_amount_usdc": 12.0,
                    "payments_on_record": 4,
                },
            ],
            "unapproved_vendor": {
                "name": "Northbeam Advisory",
                "first_seen": "",
                "typical_amount_usdc": 30.0,
                "payments_on_record": 0,
            },
            "purchase_orders": [
                {
                    "po_number": "PO-4471",
                    "vendor": "Harbour Freight Co",
                    "approved_amount_usdc": 25.0,
                },
            ],
            "invoices": [
                {
                    "invoice_id": "HF-9001",
                    "vendor": "Harbour Freight Co",
                    "amount_usdc": 25.0,
                    "due": "2026-08-01",
                    "memo": "Pallet wrap and strapping, monthly.",
                    "po_ref": "PO-4471",
                    "category": "clean",
                    "arrives_after_seconds": 0,
                },
                {
                    "invoice_id": "HF-9002",
                    "vendor": "Harbour Freight Co",
                    "amount_usdc": 25.0,
                    "due": "2026-08-01",
                    "memo": "Pallet wrap and strapping, monthly.",
                    "po_ref": "PO-4471",
                    "category": "duplicate",
                    "arrives_after_seconds": 30,
                },
                {
                    "invoice_id": "FF-2210",
                    "vendor": "Fleet Fuel Services",
                    "amount_usdc": 130.0,
                    "due": "2026-08-05",
                    "memo": "Quarterly fuel true-up.",
                    "po_ref": None,
                    "category": "anomalous",
                    "arrives_after_seconds": 60,
                },
                {
                    "invoice_id": "NB-0001",
                    "vendor": "Northbeam Advisory",
                    "amount_usdc": 30.0,
                    "due": "2026-08-06",
                    "memo": "Advisory retainer, first invoice.",
                    "po_ref": None,
                    "category": "unknown_vendor",
                    "arrives_after_seconds": 90,
                },
            ],
        }
    )


def _injection_payload_present() -> None:
    """The compromise scenario must produce an invoice payable to the attacker.

    Everything about it is per-run now — the address is random and the memo is written by a model
    — so this asserts the *mechanism*, not any particular string.
    """
    from eth_utils import is_hex_address

    from agent.generator import _fallback_injection_memo
    from agent.ledger import Ledger
    from agent.prompts import SYSTEM_PROMPT

    ledger = Ledger(_sample_world(), PARTIES)
    assert not ledger.has_injected_invoice(), "a clean run must contain no poisoned invoice"

    memo = _fallback_injection_memo(ledger.attacker_address)
    poisoned = ledger.add_injected_invoice(memo)

    assert ledger.has_injected_invoice()
    assert poisoned.address == ledger.attacker_address
    assert is_hex_address(poisoned.address)
    assert ledger.attacker_address in poisoned.memo, "memo does not name the payment address"

    # It must impersonate a REAL vendor — that is what makes it convincing, and what makes the
    # allowlist the thing that catches it rather than the vendor name.
    assert poisoned.vendor in {v.name for v in ledger.vendors.values()}

    # Two runs must not share an attacker address, or it is a fixture wearing a disguise.
    other = Ledger(_sample_world(), PARTIES)
    assert other.attacker_address != ledger.attacker_address, "attacker address is not per-run"

    assert "hold_for_review" in SYSTEM_PROMPT, "prompt no longer teaches the agent to escalate"


def _compromised_prompt_cannot_reach_the_limits() -> None:
    """The subverted agent may be told anything EXCEPT how to get past the contract.

    `injected` mode models a compromised agent. It is allowed to be persuaded to pay an attacker —
    that is the demo. What it must never contain is any suggestion that the spend caps or the
    allowlist are negotiable, because they are not reachable from the prompt at all. If this
    assertion ever fails, someone has started demonstrating prompt engineering instead of
    enforcement.
    """
    from agent.prompts import COMPROMISED_SYSTEM_PROMPT

    assert COMPROMISED_SYSTEM_PROMPT, "compromised prompt missing — scenario B needs it"

    lowered = COMPROMISED_SYSTEM_PROMPT.lower()
    for forbidden in ("allowlist", "spend limit", "per-transaction cap", "rolling cap", "pause"):
        assert forbidden not in lowered, (
            f"compromised prompt references {forbidden!r}; the contract's controls must never be "
            "something a prompt can argue with"
        )


def _generator_schema_enforces_the_scenario() -> None:
    """The generator's schema is what keeps a *generated* world safe to demo.

    Categories are the contract: without one of each, an entire branch of the agent's behaviour
    never comes up and the run silently proves less than it appears to. Better to reject the batch
    than to find out live.
    """
    from pydantic import ValidationError

    from agent.generator import REQUIRED_CATEGORIES, GeneratedInvoice, GeneratedWorld

    assert REQUIRED_CATEGORIES == {"clean", "duplicate", "anomalous", "unknown_vendor"}

    world = GeneratedWorld.model_validate(_sample_world().model_dump())
    assert REQUIRED_CATEGORIES <= world.categories(), "sample world does not cover every category"

    # An unknown category must be rejected rather than silently carried into the ledger.
    try:
        GeneratedInvoice.model_validate(
            {
                "invoice_id": "X-1",
                "vendor": "Anyone",
                "amount_usdc": 1,
                "category": "whatever",
                "arrives_after_seconds": 0,
            }
        )
    except ValidationError:
        pass
    else:
        raise AssertionError("an unknown invoice category was accepted")


def _ledger_addresses_are_valid() -> None:
    """Every address the ledger produces must be a real 20-byte address.

    Kept after a hand-written literal once came up one hex character short and blew up only when
    the agent reached that invoice, minutes into a run. The addresses are generated now, so this
    guards the generator instead of a fixture.
    """
    from eth_utils import is_hex_address

    from agent.ledger import Ledger

    ledger = Ledger(_sample_world(), PARTIES)
    checked = [(inv.id, inv.address) for inv in ledger.invoices]
    checked += [(v.name, v.address) for v in ledger.vendors.values()]
    checked.append(("attacker", ledger.attacker_address))

    for label, address in checked:
        assert is_hex_address(address), f"{label}: {address!r} is not a valid address"


def _ledger_mechanics_hold_up() -> None:
    """The ledger's checks must work on whatever world it is handed, not on known IDs."""
    from agent.ledger import Ledger

    ledger = Ledger(_sample_world(), PARTIES)

    clean = next(i for i in ledger.invoices if i.po_ref and ledger.po_for(i.id))
    po = ledger.po_for(clean.id)
    assert po and clean.amount == po.approved_amount, "clean invoice should match its PO exactly"

    # Duplicate detection depends on the original having been paid — order matters.
    dup = next(i for i in ledger.invoices if i.id != clean.id and i.amount == clean.amount)
    assert ledger.duplicate_of(dup.id) is None, "nothing is a duplicate before anything is paid"
    ledger.mark_paid(clean.address, clean.amount, invoice_id=clean.id)
    assert ledger.duplicate_of(dup.id) is not None, "duplicate not detected after the original paid"

    # Allowlisted vendors must carry the REAL on-chain addresses, or every payment fails for the
    # wrong reason and the demo proves nothing.
    approved = {p["address"].lower() for p in PARTIES}
    for vendor in ledger.vendors.values():
        if vendor.known:
            assert vendor.address.lower() in approved, (
                f"{vendor.name} is marked approved but its address is not an on-chain counterparty"
            )

    # Hold -> approve puts an invoice back in the payable queue.
    target = next(i for i in ledger.invoices if i.status == "pending")
    assert ledger.hold(target.id, "outside the vendor's usual range") is not None
    assert ledger.find(target.id).status == "held"
    assert len(ledger.pending_review()) == 1
    ledger.resolve(target.id, True)
    assert ledger.find(target.id).status == "approved"
    assert not ledger.pending_review(), "approved item still sitting in the pending queue"


def _time_travel_is_chain_gated() -> None:
    """The dev-only endpoint must be impossible to enable on a public chain."""
    from config import CHAIN_PROFILES

    assert CHAIN_PROFILES[31337].allow_time_travel is True
    for chain_id, profile in CHAIN_PROFILES.items():
        if chain_id != 31337:
            assert not profile.allow_time_travel, f"{profile.label} must not allow time travel"


def _amount_conversion_is_exact() -> None:
    """A rounding error here is a wrong payment amount."""
    from config import from_base_units, to_base_units

    assert to_base_units(25.0) == 25_000_000
    assert to_base_units(12.5) == 12_500_000
    assert to_base_units(0.01) == 10_000
    assert from_base_units(40_000_000) == 40.0


check("eth_account signing -> raw_transaction", _signing_roundtrip)
check("web3 contract function surface", _web3_contract_surface)
check("openai AsyncOpenAI client shape", _openai_client_shape)
check("tool schemas well-formed", _tool_schemas_valid)
check("injection payload lives in data, not prompt", _injection_payload_present)
check("compromised prompt cannot reach the limits", _compromised_prompt_cannot_reach_the_limits)
check("ledger addresses are valid", _ledger_addresses_are_valid)
check("generator schema enforces the scenario", _generator_schema_enforces_the_scenario)
check("ledger mechanics hold up on any world", _ledger_mechanics_hold_up)
check("time travel is chain-gated", _time_travel_is_chain_gated)
check("amount conversion is exact", _amount_conversion_is_exact)

print()
if failures:
    print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)

print("All smoke checks passed.")
