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
CHAIN_ID = int(os.getenv("CHAIN_ID", "11155111"))


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
            raise RuntimeError(
                f"No deployment record at {path}.\n"
                "Deploy the contracts first:  cd contracts && npm run deploy:sepolia"
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

        return cls(
            rpc_url=_require("SEPOLIA_RPC_URL"),
            session_key_private=_require("AGENT_SESSION_KEY_PRIVATE"),
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
            # Sepolia blocks are ~12s. Ticking faster just races the chain and burns rate limit.
            tick_seconds=int(os.getenv("AGENT_TICK_SECONDS", "25")),
            max_tool_iterations=int(os.getenv("MAX_TOOL_ITERATIONS", "6")),
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
