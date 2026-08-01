"""FastAPI entry point for the agent service.

    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import ingest
from agent import loop, rogue
from agent.llm import get_router
from chain.client import get_chain
from config import from_base_units, get_deployment

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s"
)
log = logging.getLogger("killswitch")


@asynccontextmanager
async def lifespan(_: FastAPI):
    chain = get_chain()
    router = get_router()

    deployment = get_deployment()
    log.info("wallet       %s", deployment.wallet_address)
    log.info("session key  %s", chain.address)
    log.info("providers    %s", ", ".join(router.available))

    gas = chain.eth_balance()
    if gas == 0:
        log.warning(
            "Session key has 0 ETH — it pays its own gas, so every payment will fail. "
            "Fund %s from a Sepolia faucet.",
            chain.address,
        )

    yield

    await loop.stop()
    await ingest.close()


app = FastAPI(title="The Kill Switch — Agent", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ModeRequest(BaseModel):
    mode: str


class StartRequest(BaseModel):
    mode: str | None = None


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True}


@app.get("/agent/status")
async def status() -> dict[str, Any]:
    chain = get_chain()
    snapshot = chain.policy_snapshot()
    return {
        **loop.state.snapshot(),
        "providers": get_router().available,
        "sessionKey": chain.address,
        "sessionKeyEth": str(chain.eth_balance()),
        "wallet": get_deployment().wallet_address,
        "chainId": get_deployment().chain_id,
        "policy": {
            "paused": snapshot.paused,
            "throttleBps": snapshot.throttle_bps,
            "perTxCapUsdc": round(from_base_units(snapshot.per_tx_cap), 2),
            "rollingCapUsdc": round(from_base_units(snapshot.rolling_cap), 2),
            "spentUsdc": round(from_base_units(snapshot.spent_in_window), 2),
            "remainingUsdc": round(from_base_units(snapshot.remaining), 2),
            "balanceUsdc": round(from_base_units(snapshot.balance), 2),
        },
    }


# ---------------------------------------------------------------------------
# Control
# ---------------------------------------------------------------------------


@app.post("/agent/start")
async def start(body: StartRequest | None = None) -> dict[str, Any]:
    mode = body.mode if body and body.mode else None
    if mode and mode not in ("normal", "injected", "rogue"):
        raise HTTPException(400, "mode must be normal, injected, or rogue")
    return loop.start(mode)  # type: ignore[arg-type]


@app.post("/agent/stop")
async def stop() -> dict[str, Any]:
    return await loop.stop()


@app.post("/agent/tick")
async def tick() -> dict[str, Any]:
    """Force one decision cycle. The demo driver — no waiting for the scheduler."""
    return await loop.run_tick()


@app.post("/agent/mode")
async def set_mode(body: ModeRequest) -> dict[str, Any]:
    if body.mode not in ("normal", "injected", "rogue"):
        raise HTTPException(400, "mode must be normal, injected, or rogue")
    return loop.set_mode(body.mode)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Live reasoning stream
# ---------------------------------------------------------------------------


@app.get("/agent/stream")
async def stream() -> StreamingResponse:
    """SSE feed of the agent's reasoning and tool calls.

    Separate from the dashboard's /api/stream, which carries persisted chain state. This one is
    the agent thinking out loud, and is intentionally ephemeral.
    """
    queue = loop.subscribe()

    async def generator():
        try:
            yield f"event: hello\ndata: {json.dumps(loop.state.snapshot())}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"event: {payload['event']}\ndata: {json.dumps(payload)}\n\n"
        finally:
            loop.unsubscribe(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Demo scenarios
# ---------------------------------------------------------------------------


@app.post("/demo/scenario/a")
async def scenario_a() -> dict[str, Any]:
    """Normal operation — the agent pays an allowlisted vendor and it goes through."""
    loop.set_mode("normal")
    return await loop.run_tick()


@app.post("/demo/scenario/b")
async def scenario_b() -> dict[str, Any]:
    """Attack — a poisoned invoice steers the agent to an address that is not allowlisted.

    Layer 1: indirect prompt injection through tool-returned data. If the model declines to
    follow it (which a well-aligned model may), the response says so and layer 2 is one call
    away at /demo/scenario/b-rogue. The contract's answer is identical either way.
    """
    loop.set_mode("injected")
    result = await loop.run_tick()

    attempted = result.get("payments", 0) > 0
    return {
        **result,
        "injectionFollowed": attempted,
        "note": (
            "Agent followed the injected instruction; watch the chain refuse it."
            if attempted
            else "Model declined the injection this time. Run /demo/scenario/b-rogue — the "
            "contract blocks the same payment with no model in the loop at all."
        ),
    }


@app.post("/demo/scenario/b-rogue")
async def scenario_b_rogue(attack: str = "exfiltrate") -> dict[str, Any]:
    """The same attack with the model removed entirely. Guaranteed to attempt the payment."""
    loop.state.mode = "rogue"
    result = rogue.run(attack)
    chain = get_chain()

    await ingest.record_tx_attempt(
        run_id=loop.state.run_id,
        tick=loop.state.tick,
        tx_hash=result.tx_hash,
        sender=chain.address,
        to=result.to,
        vendor="ROGUE SCRIPT",
        amount=result.amount,
        status="pending" if result.tx_hash else "blocked",
        reason=None if result.tx_hash else result.error,
        mode="rogue",
    )

    return {
        "description": result.description,
        "to": result.to,
        "amountUsdc": round(from_base_units(result.amount), 2),
        "txHash": result.tx_hash,
        "error": result.error,
    }


@app.post("/demo/scenario/c")
async def scenario_c(legs: int = 3, amount_usdc: float = 20.0) -> dict[str, Any]:
    """Mid-flight freeze — start a multi-leg payment run, one transaction per leg.

    Separate transactions rather than one `payBatch`, because on Sepolia's ~12s blocks the owner
    needs a real window to land `pause()` between legs. The intra-transaction per-leg check is
    proven by the contract test suite, which is the right place for something a 12-second chain
    cannot demonstrate live.

    Returns immediately; the run continues in the background so the owner can hit FREEZE.
    """
    loop.set_mode("normal")
    chain = get_chain()
    parties = get_deployment().counterparties
    if not parties:
        raise HTTPException(500, "no counterparties in the deployment record")

    async def run_legs() -> None:
        from config import to_base_units

        amount = to_base_units(amount_usdc)
        for index in range(legs):
            party = parties[index % len(parties)]
            reason = chain.simulate(party["address"], amount)

            try:
                tx_hash = chain.send_payment(party["address"], amount)
                if not tx_hash.startswith("0x"):
                    tx_hash = "0x" + tx_hash
                status, error = "pending", None
            except Exception as exc:  # noqa: BLE001
                tx_hash, status, error = None, "blocked", str(exc)[:200]

            loop.emit(
                "payment",
                {
                    "tick": loop.state.tick,
                    "to": party["address"],
                    "vendor": party["label"],
                    "amountUsdc": amount_usdc,
                    "txHash": tx_hash,
                    "status": status,
                    "preflight": reason,
                    "leg": index,
                },
            )

            await ingest.record_tx_attempt(
                run_id=loop.state.run_id, tick=loop.state.tick, tx_hash=tx_hash,
                sender=chain.address, to=party["address"], vendor=party["label"],
                amount=amount, status=status, reason=error, mode="normal",
            )

            # Long enough for a Sepolia block plus a human hand on the freeze button.
            await asyncio.sleep(20)

    asyncio.create_task(run_legs())

    return {
        "started": True,
        "legs": legs,
        "amountUsdc": amount_usdc,
        "note": "Run started. Hit FREEZE from the dashboard — the remaining legs will revert.",
    }
