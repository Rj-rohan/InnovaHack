"""Configuration and the shared deployment record.

Everything the agent needs to reach the chain, the LLM providers, and the ingest API. Addresses
and ABIs come from `contracts/deployments/<chainId>.json`, the same file client/ reads, so an
address is never pasted into two places and allowed to drift.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parent.parent

LOCAL_CHAIN_ID = 31337
CHAIN_ID = int(os.getenv("CHAIN_ID", str(LOCAL_CHAIN_ID)))

# Hardhat's account #1, from the mnemonic printed in every tutorial on the internet. Safe as a
# default ONLY because it is gated to chain 31337 below; on any other chain the key is required.
_LOCAL_SESSION_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
_LOCAL_RPC_URL = "http://127.0.0.1:8545"


@dataclass(frozen=True)
class ChainProfile:
    """Mirror of `client/lib/chains.ts`. Nothing in the service hardcodes a chain."""

    chain_id: int
    label: str
    default_rpc: str | None
    default_tick_seconds: int
    #: Whether `evm_increaseTime` may be used. True only for a dev chain — this is checked at
    #: call time, so the time-travel endpoint cannot function on a public network even if the
    #: service is deployed with it present.
    allow_time_travel: bool


CHAIN_PROFILES: dict[int, ChainProfile] = {
    LOCAL_CHAIN_ID: ChainProfile(
        chain_id=LOCAL_CHAIN_ID,
        label="Hardhat (local)",
        default_rpc=_LOCAL_RPC_URL,
        # Instant blocks, so the agent can think at a watchable pace rather than waiting on the
        # chain. On a public network this would just race block production.
        default_tick_seconds=8,
        allow_time_travel=True,
    ),
    11155111: ChainProfile(
        chain_id=11155111,
        label="Sepolia",
        default_rpc=None,
        default_tick_seconds=25,
        allow_time_travel=False,
    ),
}


def get_chain_profile(chain_id: int = CHAIN_ID) -> ChainProfile:
    profile = CHAIN_PROFILES.get(chain_id)
    if profile is None:
        raise RuntimeError(
            f"No chain profile for chain {chain_id}. Add one to server/config.py "
            "(and client/lib/chains.ts) — chain-specific settings are resolved from there."
        )
    return profile


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"Missing required env var {name}. Copy server/.env.example to server/.env."
        )
    return value


@dataclass(frozen=True)
class Deployment:
    chain_id: int
    wallet_address: str
    token_address: str
    owner: str
    agent_session_key: str
    wallet_abi: list[dict[str, Any]]
    token_abi: list[dict[str, Any]]
    per_tx_cap: int
    rolling_cap: int
    decimals: int
    counterparties: list[dict[str, str]] = field(default_factory=list)

    @classmethod
    def load(cls, chain_id: int = CHAIN_ID) -> "Deployment":
        path = REPO_ROOT / "contracts" / "deployments" / f"{chain_id}.json"
        if not path.exists():
            how = (
                "npx hardhat node   (then, in another terminal)   npm run deploy:local"
                if chain_id == LOCAL_CHAIN_ID
                else "npm run deploy:sepolia"
            )
            available = sorted(
                p.stem for p in (REPO_ROOT / "contracts" / "deployments").glob("*.json")
            ) if (REPO_ROOT / "contracts" / "deployments").exists() else []
            hint = (
                f"\nDeployments that DO exist: {', '.join(available)}. "
                f"If you meant one of those, set CHAIN_ID accordingly in server/.env."
                if available
                else ""
            )
            raise RuntimeError(
                f"No deployment record at {path}.\nDeploy first:  cd contracts && {how}{hint}"
            )

        raw = json.loads(path.read_text(encoding="utf-8"))
        return cls(
            chain_id=raw["chainId"],
            wallet_address=raw["contracts"]["agentWallet"],
            token_address=raw["contracts"]["mockUsdc"],
            owner=raw["owner"],
            agent_session_key=raw["agentSessionKey"],
            wallet_abi=raw["abi"]["agentWallet"],
            token_abi=raw["abi"]["mockUsdc"],
            per_tx_cap=int(raw["policy"]["perTxCap"]),
            rolling_cap=int(raw["policy"]["rollingCap"]),
            decimals=int(raw["policy"]["decimals"]),
            counterparties=raw.get("counterparties", []),
        )


@dataclass(frozen=True)
class Settings:
    rpc_url: str
    session_key_private: str
    ingest_url: str
    ingest_secret: str

    gemini_api_key: str | None
    groq_api_key: str | None

    gemini_model: str
    groq_model: str

    tick_seconds: int
    max_tool_iterations: int

    @classmethod
    def load(cls) -> "Settings":
        gemini = os.getenv("GEMINI_API_KEY") or None
        groq = os.getenv("GROQ_API_KEY") or None
        if not gemini and not groq:
            raise RuntimeError(
                "Set at least one of GEMINI_API_KEY or GROQ_API_KEY in server/.env."
            )

        profile = get_chain_profile()
        is_local = profile.chain_id == LOCAL_CHAIN_ID

        rpc_url = os.getenv("RPC_URL") or profile.default_rpc
        if not rpc_url:
            raise RuntimeError(
                f"RPC_URL is required for chain {profile.chain_id} ({profile.label})."
            )

        # The well-known Hardhat key is a default only on the local dev chain. Off 31337 the key
        # stays mandatory, so a deployment can never be signed by a publicly-known account.
        session_key = os.getenv("AGENT_SESSION_KEY_PRIVATE") or (
            _LOCAL_SESSION_KEY if is_local else ""
        )
        if not session_key:
            raise RuntimeError(
                "AGENT_SESSION_KEY_PRIVATE is required on any chain other than the local dev node."
            )

        return cls(
            rpc_url=rpc_url,
            session_key_private=session_key,
            ingest_url=os.getenv("INGEST_URL", "http://localhost:3000"),
            ingest_secret=_require("INGEST_SECRET"),
            gemini_api_key=gemini,
            groq_api_key=groq,
            # Gemini Flash: most reliable free-tier function calling — the normal path must work
            # on the first try, every try.
            gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            # An open-weight model for the compromised agent. Less injection-hardened, which is
            # exactly what the attack scenario needs, and it doubles as Groq-speed failover.
            groq_model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            tick_seconds=int(
                os.getenv("AGENT_TICK_SECONDS", str(profile.default_tick_seconds))
            ),
            max_tool_iterations=int(os.getenv("MAX_TOOL_ITERATIONS", "8")),
        )


_settings: Settings | None = None
_deployment: Deployment | None = None

DEFAULT_DECIMALS = 6


def get_settings() -> Settings:
    """Loaded on first use, not at import.

    Eager loading here made the whole service unimportable without a full .env and a deployed
    contract — which broke offline tests and made partial startup impossible to diagnose. Config
    errors should surface when something actually needs config.
    """
    global _settings
    if _settings is None:
        _settings = Settings.load()
    return _settings


def get_deployment() -> Deployment:
    global _deployment
    if _deployment is None:
        _deployment = Deployment.load()
    return _deployment


def _decimals(explicit: int | None) -> int:
    if explicit is not None:
        return explicit
    try:
        return get_deployment().decimals
    except RuntimeError:
        # No deployment record yet — mUSDC is 6dp and always has been.
        return DEFAULT_DECIMALS


def to_base_units(amount: float, decimals: int | None = None) -> int:
    """Human amount -> integer base units."""
    return int(round(amount * (10 ** _decimals(decimals))))


def from_base_units(amount: int, decimals: int | None = None) -> float:
    return amount / (10 ** _decimals(decimals))
