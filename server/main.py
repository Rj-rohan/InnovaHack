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
from config import from_base_units, get_chain_profile, get_deployment

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s"
)
log = logging.getLogger("killswitch")


@asynccontextmanager
async def lifespan(_: FastAPI):
    chain = get_chain()
    router = get_router()

    deployment = get_deployment()
    profile = get_chain_profile(deployment.chain_id)

    log.info("chain        %s (%s)", profile.label, deployment.chain_id)
    log.info("wallet       %s", deployment.wallet_address)
    log.info("session key  %s", chain.address)
    log.info("providers    %s", ", ".join(router.available))

    if chain.eth_balance() == 0:
        how = (
            "Is `npx hardhat node` running, and was the contract deployed against it?"
            if profile.allow_time_travel
            else f"Fund {chain.address} from a faucet."
        )
        log.warning(
            "Session key has 0 ETH — it pays its own gas, so every payment will fail. %s", how
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
# Hold-for-review queue
#
# The agent service owns this queue; Mongo holds a projection of it for the console to render.
# Owner decisions therefore come here rather than to the database, which keeps a single writer and
# avoids a two-way sync.
#
# Worth being precise about in the demo: this is a SOFT control. It is the agent choosing to defer,
# and a compromised agent would simply not use it. The contract is the hard control.
# ---------------------------------------------------------------------------


@app.get("/agent/review")
async def list_review() -> dict[str, Any]:
    return {"items": loop.review_queue()}


def _no_such_item(invoice_id: str) -> HTTPException:
    """A 404 here is nearly always stale data, so say that rather than just "not found".

    The queue lives in this process. Restarting the service, or redeploying the chain, empties it
    while the dashboard keeps rendering rows from MongoDB — so the row on screen is real and the
    invoice behind it is gone.
    """
    if loop.state.ledger is None:
        detail = (
            f"{invoice_id} is not in the review queue — the agent has not run since it last "
            "started, so its queue is empty. The row on screen is recorded history. Start the "
            "agent, or clear old records with `npm run db:reset` in client/."
        )
    else:
        known = [item["invoiceId"] for item in loop.review_queue()]
        detail = (
            f"{invoice_id} is not in the current run's review queue. "
            f"Currently held: {', '.join(known) if known else 'nothing'}."
        )
    return HTTPException(404, detail)


@app.post("/agent/review/{invoice_id}/approve")
async def approve_review(invoice_id: str) -> dict[str, Any]:
    item = await loop.resolve_review(invoice_id, approved=True)
    if item is None:
        raise _no_such_item(invoice_id)
    return item


@app.post("/agent/review/{invoice_id}/reject")
async def reject_review(invoice_id: str) -> dict[str, Any]:
    item = await loop.resolve_review(invoice_id, approved=False)
    if item is None:
        raise _no_such_item(invoice_id)
    return item


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


@app.post("/demo/advance-time")
async def advance_time(hours: int = 25) -> dict[str, Any]:
    """Jump the chain clock forward, to demonstrate the rolling 24h window live.

    Spend to the cap, watch the next payment refused, advance 25 hours, watch the same payment
    succeed — proof the window genuinely rolls rather than resetting at midnight. On a public
    network this is impossible, which is why it was previously only provable in a unit test.

    Gated on the chain id at call time, not on an env flag: the endpoint cannot function against a
    public network even if the service is deployed with it present.
    """
    chain = get_chain()
    profile = get_chain_profile(chain.deployment.chain_id)

    if not profile.allow_time_travel:
        raise HTTPException(
            400,
            f"Time travel is not available on {profile.label} (chain "
            f"{profile.chain_id}). It only works against a local dev node.",
        )

    if hours <= 0:
        raise HTTPException(400, "hours must be positive")

    seconds = hours * 3600
    before = chain.w3.eth.get_block("latest")["timestamp"]
    chain.w3.provider.make_request("evm_increaseTime", [seconds])
    chain.w3.provider.make_request("evm_mine", [])
    after = chain.w3.eth.get_block("latest")["timestamp"]

    snapshot = chain.policy_snapshot()
    loop.emit("time_travel", {"hours": hours, "spentUsdc": round(from_base_units(snapshot.spent_in_window), 2)})

    return {
        "advancedHours": hours,
        "blockTimestampBefore": before,
        "blockTimestampAfter": after,
        "spentInWindowUsdc": round(from_base_units(snapshot.spent_in_window), 2),
        "remainingUsdc": round(from_base_units(snapshot.remaining), 2),
        "note": "Spend older than 24h has aged out of the rolling window.",
    }


@app.get("/agent/threat")
async def threat_status() -> dict[str, Any]:
    """Live threat state: blocked streak, auto-pause threshold, recent block reasons."""
    chain = get_chain()
    try:
        streak, threshold, auto_triggered = chain.w3.eth.contract(
            address=chain.deployment.wallet_address,
            abi=chain.deployment.wallet_abi,
        ).functions.threatSnapshot().call()
    except Exception:  # noqa: BLE001
        streak, threshold, auto_triggered = 0, 3, False

    snapshot = chain.policy_snapshot()
    return {
        "blockedStreak": streak,
        "autoPauseThreshold": threshold,
        "autoTriggered": auto_triggered,
        "paused": snapshot.paused,
        "remainingUsdc": round(from_base_units(snapshot.remaining), 2),
        "spentUsdc": round(from_base_units(snapshot.spent_in_window), 2),
    }


@app.get("/agent/watchdog")
async def watchdog() -> dict[str, Any]:
    """Agent health check — detects silent crashes."""
    from config import get_settings
    settings = get_settings()
    last_tick = loop.state.last_tick_at
    overdue = False
    seconds_since_tick = None

    if last_tick:
        from datetime import datetime, timezone
        last_dt = datetime.fromisoformat(last_tick)
        now = datetime.now(timezone.utc)
        seconds_since_tick = (now - last_dt).total_seconds()
        overdue = loop.state.running and seconds_since_tick > settings.tick_seconds * 3

    if overdue:
        await ingest.send_alert(
            reason="Agent overdue — possible silent crash",
            tx_hash=None,
            extra={"secondsSinceTick": seconds_since_tick, "expectedInterval": settings.tick_seconds},
        )

    return {
        "running": loop.state.running,
        "lastTickAt": last_tick,
        "secondsSinceTick": round(seconds_since_tick, 1) if seconds_since_tick is not None else None,
        "expectedIntervalSeconds": settings.tick_seconds,
        "overdue": overdue,
        "lastError": loop.state.last_error,
    }


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
    """The same attack with the model removed entirely. Guaranteed to attempt the payment.

    attack:
      exfiltrate  — pay a non-allowlisted address
      overspend   — pay a legitimate vendor 5x the per-tx cap
      velocity    — 5 payments of 19 mUSDC each, each under the per-tx cap but together over the rolling cap
    """
    loop.state.mode = "rogue"
    result = rogue.run(attack)
    chain = get_chain()

    if result.error:
        await ingest.send_alert(
            reason=result.error,
            tx_hash=result.tx_hash,
            extra={"attack": attack, "to": result.to},
        )

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


@app.post("/demo/scenario/f")
async def scenario_f() -> dict[str, Any]:
    """Scenario F — session key expiry mid-run.

    Grants a 15-second session key, starts a 3-leg run with 10s between legs.
    Leg 1 succeeds. After leg 1 the chain clock is advanced past the expiry.
    Legs 2-3 revert with SessionInvalid — from natural expiry, not manual revocation.
    """
    chain = get_chain()
    deployment = get_deployment()
    profile = get_chain_profile(deployment.chain_id)
    parties = deployment.counterparties

    if not parties:
        raise HTTPException(500, "no counterparties in the deployment record")
    if not profile.allow_time_travel:
        raise HTTPException(400, "Scenario F requires a local dev chain (chain 31337).")

    from config import to_base_units
    from eth_account import Account

    # Grant a 15-second session key using the well-known local owner key
    owner_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    owner_account = Account.from_key(owner_key)
    now_ts = chain.w3.eth.get_block("latest")["timestamp"]
    expires_at = now_ts + 15

    wallet_contract = chain.w3.eth.contract(
        address=chain.w3.to_checksum_address(deployment.wallet_address),
        abi=deployment.wallet_abi,
    )
    nonce = chain.w3.eth.get_transaction_count(owner_account.address, "pending")
    base_fee = chain.w3.eth.get_block("latest").get("baseFeePerGas", 0) or 0
    priority = chain.w3.to_wei(2, "gwei")
    tx = wallet_contract.functions.grantSession(
        chain.w3.to_checksum_address(chain.address), expires_at
    ).build_transaction({
        "from": owner_account.address,
        "nonce": nonce,
        "gas": 100_000,
        "maxPriorityFeePerGas": priority,
        "maxFeePerGas": base_fee * 2 + priority,
        "chainId": deployment.chain_id,
    })
    signed = owner_account.sign_transaction(tx)
    chain.w3.eth.send_raw_transaction(signed.raw_transaction)

    loop.set_mode("normal")
    amount = to_base_units(15.0)

    async def run_legs() -> None:
        for i in range(3):
            party = parties[i % len(parties)]
            try:
                tx_hash = chain.send_payment(party["address"], amount)
                if not tx_hash.startswith("0x"):
                    tx_hash = "0x" + tx_hash
                status, error = "pending", None
            except Exception as exc:  # noqa: BLE001
                tx_hash, status, error = None, "blocked", str(exc)[:200]

            loop.emit("payment", {
                "tick": loop.state.tick, "to": party["address"],
                "vendor": party["label"], "amountUsdc": 15.0,
                "txHash": tx_hash, "status": status, "leg": i,
            })
            await ingest.record_tx_attempt(
                run_id=loop.state.run_id, tick=loop.state.tick, tx_hash=tx_hash,
                sender=chain.address, to=party["address"], vendor=party["label"],
                amount=amount, status=status, reason=error, mode="normal",
            )

            # After leg 1, advance chain time past the key expiry
            if i == 0:
                await asyncio.sleep(2)
                chain.w3.provider.make_request("evm_increaseTime", [20])
                chain.w3.provider.make_request("evm_mine", [])
                loop.emit("time_travel", {"note": "Session key expired — next legs get SessionInvalid"})
            else:
                await asyncio.sleep(2)

    asyncio.create_task(run_legs())
    return {
        "started": True,
        "keyExpiresInSeconds": 15,
        "legs": 3,
        "note": "Leg 1 succeeds. Key expires after leg 1. Legs 2-3 revert with SessionInvalid.",
    }
