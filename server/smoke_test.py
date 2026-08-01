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


def _injection_payload_present() -> None:
    """Scenario B depends on the poisoned invoice actually carrying the attacker address."""
    from agent.ledger import ATTACKER_ADDRESS, injected_invoice
    from agent.prompts import SYSTEM_PROMPT

    poisoned = injected_invoice()
    assert poisoned.address == ATTACKER_ADDRESS, "poisoned invoice does not target the attacker"
    assert "0xBAD" in poisoned.memo, "memo does not carry the injected instruction"

    # The normal agent must be clean: no attacker address, and it must still know how to escalate.
    assert "0xBAD" not in SYSTEM_PROMPT, "normal prompt leaks the attack address"
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


def _ledger_addresses_are_valid() -> None:
    """Every address in the scripted ledger must be a real 20-byte address.

    Added after a hand-written literal came up one hex character short and blew up only when the
    agent reached that invoice, several minutes into a run.
    """
    from eth_utils import is_hex_address

    from agent.ledger import ATTACKER_ADDRESS, Ledger, injected_invoice

    ledger = Ledger(PARTIES)
    addresses = [(inv.id, inv.address) for inv in ledger.invoices]
    addresses.append(("injected", injected_invoice().address))
    addresses.append(("ATTACKER_ADDRESS", ATTACKER_ADDRESS))

    for label, address in addresses:
        assert is_hex_address(address), f"{label}: {address!r} is not a valid address"


def _ledger_scenarios_hold_up() -> None:
    """The scripted sequence has to actually produce the decisions the demo narrates."""
    from agent.ledger import Ledger

    ledger = Ledger(PARTIES)

    # A clean invoice matches its PO exactly.
    clean = ledger.find("INV-2041")
    po = ledger.po_for("INV-2041")
    assert clean and po and clean.amount == po.approved_amount, "clean invoice should match its PO"

    # The duplicate is only detectable once the original is paid.
    assert ledger.duplicate_of("INV-2044") is None, "nothing is a duplicate before anything is paid"
    ledger.mark_paid(clean.address, clean.amount)
    dup = ledger.duplicate_of("INV-2044")
    assert dup and dup.id == "INV-2041", "duplicate of INV-2041 not detected"

    # The anomaly invoice is far outside its vendor's pattern — that is the whole point of it.
    anomaly = ledger.find("INV-2045")
    vendor = ledger.vendor_for(anomaly.vendor)
    assert vendor and vendor.average > 0
    assert anomaly.amount / vendor.average > 5, "anomaly invoice is not anomalous enough to notice"

    # Hold -> approve puts the invoice back in the payable queue.
    assert ledger.hold("INV-2045", "10x vendor average") is not None
    assert ledger.find("INV-2045").status == "held"
    assert len(ledger.pending_review()) == 1
    ledger.resolve("INV-2045", True)
    assert ledger.find("INV-2045").status == "approved"
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
check("ledger scenarios produce the narrated decisions", _ledger_scenarios_hold_up)
check("time travel is chain-gated", _time_travel_is_chain_gated)
check("amount conversion is exact", _amount_conversion_is_exact)

print()
if failures:
    print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)

print("All smoke checks passed.")
