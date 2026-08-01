"""Writes agent activity into MongoDB — via the Next.js API, never directly.

The Python service holds no database driver and no connection string. All persistence goes
through `client/`'s two ingest routes, so database access stays in one place.

Every call is best-effort: if the dashboard is down, the agent keeps running and keeps paying.
Losing a log line is acceptable; halting the agent because a UI is unreachable is not.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from config import get_settings

log = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=get_settings().ingest_url.rstrip("/"),
            timeout=8.0,
            headers={"Authorization": f"Bearer {get_settings().ingest_secret}"},
        )
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def _post(path: str, payload: dict[str, Any]) -> None:
    try:
        response = await _http().post(path, json=payload)
        if response.status_code >= 400:
            log.warning("ingest %s -> %s %s", path, response.status_code, response.text[:200])
    except httpx.HTTPError as exc:
        log.warning("ingest %s unreachable: %s", path, exc)


async def record_decision(
    *,
    run_id: str,
    tick: int,
    mode: str,
    provider: str | None,
    model: str | None,
    reasoning: str,
    tool_calls: list[dict[str, Any]],
) -> None:
    await _post(
        "/api/ingest/decision",
        {
            "runId": run_id,
            "tick": tick,
            "mode": mode,
            "provider": provider,
            "model": model,
            "reasoning": reasoning,
            "toolCalls": tool_calls,
        },
    )


async def record_review(*, run_id: str, item: dict[str, Any]) -> None:
    """Mirror a review-queue entry into Mongo so the owner's console can render it.

    The queue itself is owned by this service; this is a read-model projection, which is why an
    upsert on `invoiceId` is the right shape — the same item is written again on approve/reject.
    """
    await _post("/api/ingest/review", {"runId": run_id, **item})


async def record_tx_attempt(
    *,
    run_id: str,
    tick: int,
    tx_hash: str | None,
    sender: str,
    to: str,
    vendor: str | None,
    amount: int,
    status: str,
    reason: str | None,
    mode: str,
    leg_index: int = 0,
) -> None:
    await _post(
        "/api/ingest/tx-attempt",
        {
            "runId": run_id,
            "tick": tick,
            "txHash": tx_hash,
            "legIndex": leg_index,
            "from": sender,
            "to": to,
            "vendor": vendor,
            # Base units as a string — a float here would silently lose precision.
            "amount": str(amount),
            "status": status,
            "reason": reason,
            "mode": mode,
        },
    )
