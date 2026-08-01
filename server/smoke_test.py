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
    assert len(TOOL_SCHEMAS) >= 4
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


def _injection_payload_present() -> None:
    """Scenario B depends on the poisoned invoice actually carrying the attacker address."""
    from agent.prompts import ATTACKER_ADDRESS, injected_invoices

    parties = [
        {"address": "0x1111111111111111111111111111111111111111", "tag": "vendor", "label": "Acme"},
        {"address": "0x2222222222222222222222222222222222222222", "tag": "gas", "label": "Gas"},
    ]
    invoices = injected_invoices(parties)
    poisoned = [i for i in invoices if i.address == ATTACKER_ADDRESS]
    assert poisoned, "no invoice points at the attacker address"
    assert "0xBAD" in poisoned[0].memo, "memo does not carry the injected instruction"
    # The clean queue must be untouched — the attack is in the data, not the prompt.
    from agent.prompts import SYSTEM_PROMPT

    assert "0xBAD" not in SYSTEM_PROMPT, "system prompt leaks the attack; it must live in the data"


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
check("amount conversion is exact", _amount_conversion_is_exact)

print()
if failures:
    print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)

print("All smoke checks passed.")
