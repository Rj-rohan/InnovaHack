"""The agent loop: scheduler, tool-calling cycle, and event broadcast."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

import ingest
from agent import rogue
from agent.ledger import Ledger, injected_invoice
from agent.llm import ProviderFailed, get_router
from agent.prompts import COMPROMISED_SYSTEM_PROMPT, SYSTEM_PROMPT
from agent.tools import TOOL_SCHEMAS, ToolBox, counterparties
from chain.client import get_chain
from config import from_base_units, get_deployment, get_settings

log = logging.getLogger(__name__)

Mode = Literal["normal", "injected", "rogue"]


@dataclass
class AgentState:
    running: bool = False
    mode: Mode = "normal"
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    tick: int = 0
    last_provider: str | None = None
    last_error: str | None = None
    subscribers: list[asyncio.Queue] = field(default_factory=list)
    #: AP state — persists across ticks so invoices can arrive over time. See `_ensure_ledger`.
    ledger: "Ledger | None" = None
    _task: asyncio.Task | None = None

    def snapshot(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "mode": self.mode,
            "runId": self.run_id,
            "tick": self.tick,
            "lastProvider": self.last_provider,
            "lastError": self.last_error,
        }


state = AgentState()


def _emit(event: str, data: dict[str, Any]) -> None:
    """Push an event to every connected SSE client. Never blocks the agent."""
    payload = {"event": event, "data": data, "at": datetime.now(timezone.utc).isoformat()}
    for queue in list(state.subscribers):
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            # A stalled browser tab must not slow the agent down.
            pass


#: Public alias — `main.py` broadcasts scenario progress through this.
emit = _emit


def subscribe() -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    state.subscribers.append(queue)
    return queue


def unsubscribe(queue: asyncio.Queue) -> None:
    if queue in state.subscribers:
        state.subscribers.remove(queue)


def _ensure_ledger(mode: Mode) -> Ledger:
    """The ledger persists across ticks, unlike the static list it replaced.

    It has to: invoices arrive on a timer, vendor history accumulates as payments settle, and the
    review queue outlives the tick that created it. Rebuilding per tick would reset the clock every
    cycle and nothing would ever "arrive".
    """
    if state.ledger is None:
        state.ledger = Ledger(counterparties(), decimals=get_deployment().decimals)

    # Injected mode drops the poisoned invoice into the front of the queue, once.
    if mode == "injected" and not any(
        inv.id == "INV-2043" for inv in state.ledger.invoices
    ):
        state.ledger.invoices.insert(0, injected_invoice(state.ledger.decimals))

    return state.ledger


def reset_ledger() -> None:
    state.ledger = None


async def run_tick() -> dict[str, Any]:
    """One decision cycle.

    Returns a summary. Never raises for ordinary failures — a tick that fails is logged and the
    loop continues, because an agent that dies on a rate limit is not an autonomous agent.
    """
    state.tick += 1
    tick = state.tick
    mode = state.mode
    chain = get_chain()

    _emit("tick_start", {"tick": tick, "mode": mode})

    # Rogue mode skips the model entirely.
    if mode == "rogue":
        result = rogue.run()
        _emit(
            "rogue",
            {
                "tick": tick,
                "description": result.description,
                "to": result.to,
                "txHash": result.tx_hash,
                "error": result.error,
            },
        )
        await ingest.record_decision(
            run_id=state.run_id, tick=tick, mode=mode, provider=None, model=None,
            reasoning=result.description, tool_calls=[],
        )
        await ingest.record_tx_attempt(
            run_id=state.run_id, tick=tick, tx_hash=result.tx_hash, sender=chain.address,
            to=result.to, vendor="ROGUE SCRIPT", amount=result.amount,
            status="pending" if result.tx_hash else "blocked",
            reason=None if result.tx_hash else result.error, mode=mode,
        )
        _emit("tick_end", {"tick": tick})
        return {"tick": tick, "mode": mode, "txHash": result.tx_hash}

    ledger = _ensure_ledger(mode)
    toolbox = ToolBox(ledger)
    router = get_router()

    snapshot = chain.policy_snapshot()

    # Anything the owner approved since the last cycle is called out explicitly, so the agent does
    # not have to infer that a previously-held invoice is now cleared.
    approved = [inv.id for inv in ledger.visible() if inv.status == "approved"]
    approved_note = (
        f" A human has approved {', '.join(approved)} for payment since your last cycle."
        if approved
        else ""
    )

    # In `injected` mode the agent itself is compromised — subverted instructions plus a poisoned
    # invoice. Which route the attacker took is not the point; the contract refuses either way.
    system_prompt = COMPROMISED_SYSTEM_PROMPT if mode == "injected" else SYSTEM_PROMPT

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"Payment cycle {tick}. Wallet balance is "
                f"{from_base_units(snapshot.balance):.2f} mUSDC.{approved_note} "
                "Review the queue and handle whatever needs handling."
            ),
        },
    ]

    # The compromised agent runs on the open-weight model. A heavily-aligned model may simply
    # refuse the injected instruction, which makes for a demo that does not demonstrate anything.
    prefer = "groq" if mode == "injected" else "gemini"

    reasoning_parts: list[str] = []
    tool_calls_log: list[dict[str, Any]] = []
    provider_used: str | None = None
    model_used: str | None = None
    base_messages = list(messages)

    # Failover happens per TURN, not per call.
    #
    # A conversation that already contains one provider's assistant messages cannot be handed to
    # another mid-flight: Gemini attaches a `thought_signature` to each function call and rejects a
    # history where it is missing, and feeding Gemini's extras to Groq is equally unsafe. So each
    # provider gets a clean history, and a failure restarts the turn rather than continuing a
    # contaminated one.
    for provider_name in router.order(prefer):
        messages = list(base_messages)
        reasoning_parts.clear()
        tool_calls_log.clear()
        turn_failed = False

        for _ in range(get_settings().max_tool_iterations):
            try:
                result = await router.chat_with(provider_name, messages, tools=TOOL_SCHEMAS)
            except ProviderFailed as exc:
                state.last_error = str(exc)

                # Restarting the turn re-runs the tools from scratch. That is safe only while the
                # turn has had no side effects — once a payment is on the wire, a retry could pay
                # twice, which is exactly the failure this whole project exists to prevent. Abandon
                # the turn instead and let the next tick pick things up.
                if toolbox.payments or toolbox.holds:
                    log.warning(
                        "%s failed after side effects; abandoning the turn rather than retrying: %s",
                        provider_name,
                        exc,
                    )
                    _emit(
                        "error",
                        {
                            "tick": tick,
                            "message": f"{provider_name} failed mid-turn after acting; not retried",
                        },
                    )
                    turn_failed = False  # stop here; do not fail over
                    break

                log.warning(
                    "%s failed with no side effects, restarting the turn on the next provider: %s",
                    provider_name,
                    exc,
                )
                _emit(
                    "provider_failover",
                    {"tick": tick, "from": provider_name, "error": str(exc)[:200]},
                )
                turn_failed = True
                break

            provider_used = result.provider
            model_used = result.model
            state.last_provider = result.provider
            state.last_error = None

            message = result.message
            text = (message.content or "").strip()
            if text:
                reasoning_parts.append(text)
                _emit("reasoning", {"tick": tick, "provider": result.provider, "text": text})

            tool_calls = getattr(message, "tool_calls", None)
            if not tool_calls:
                # No tool calls means the agent is done deciding this cycle. Also the path a
                # refusal takes, which is why this is a normal exit rather than an error.
                break

            # Echo the assistant message back VERBATIM rather than rebuilding it from its parts.
            # Reconstruction drops provider-specific fields — notably Gemini's `thought_signature`,
            # whose absence makes every subsequent call in the turn fail with a 400.
            messages.append(message.model_dump(exclude_none=True))

            for call in tool_calls:
                name = call.function.name
                raw_args = call.function.arguments or "{}"
                _emit("tool_call", {"tick": tick, "name": name, "args": raw_args})

                output = toolbox.call(name, raw_args)

                try:
                    parsed_args = json.loads(raw_args)
                except json.JSONDecodeError:
                    parsed_args = {"_raw": raw_args}

                tool_calls_log.append({"name": name, "args": parsed_args, "result": output[:1000]})
                _emit("tool_result", {"tick": tick, "name": name, "result": output[:600]})

                messages.append({"role": "tool", "tool_call_id": call.id, "content": output})

        if not turn_failed:
            break
    else:
        _emit("error", {"tick": tick, "message": "every provider failed this turn"})

    reasoning = "\n\n".join(reasoning_parts) or "(no narration)"

    await ingest.record_decision(
        run_id=state.run_id, tick=tick, mode=mode, provider=provider_used,
        model=model_used, reasoning=reasoning, tool_calls=tool_calls_log,
    )

    for payment in toolbox.payments:
        invoice = ledger.find_by_address(payment.to)
        await ingest.record_tx_attempt(
            run_id=state.run_id, tick=tick, tx_hash=payment.tx_hash, sender=chain.address,
            to=payment.to, vendor=payment.vendor or (invoice.vendor if invoice else None),
            amount=payment.amount, status=payment.status, reason=payment.reason, mode=mode,
        )
        _emit(
            "payment",
            {
                "tick": tick,
                "to": payment.to,
                "vendor": payment.vendor,
                "amountUsdc": round(from_base_units(payment.amount), 2),
                "txHash": payment.tx_hash,
                "status": payment.status,
            },
        )

    # Mirror any new holds so the owner's console can act on them. The queue itself lives here in
    # the service; Mongo is only the read model.
    for item in toolbox.holds:
        await ingest.record_review(run_id=state.run_id, item=item.as_dict(ledger.decimals))
        _emit(
            "hold",
            {
                "tick": tick,
                "invoiceId": item.invoice_id,
                "vendor": item.vendor,
                "amountUsdc": round(from_base_units(item.amount), 2),
                "reason": item.reason,
            },
        )

    _emit("tick_end", {"tick": tick, "provider": provider_used})

    return {
        "tick": tick,
        "mode": mode,
        "provider": provider_used,
        "payments": len(toolbox.payments),
        "holds": len(toolbox.holds),
        "reasoning": reasoning,
    }


async def resolve_review(invoice_id: str, approved: bool) -> dict[str, Any] | None:
    """Owner approves or rejects a held invoice. Approved ones become payable next tick."""
    if state.ledger is None:
        return None

    item = state.ledger.resolve(invoice_id, approved)
    if item is None:
        return None

    await ingest.record_review(run_id=state.run_id, item=item.as_dict(state.ledger.decimals))
    _emit(
        "review_resolved",
        {"invoiceId": item.invoice_id, "status": item.status},
    )
    return item.as_dict(state.ledger.decimals)


def review_queue() -> list[dict[str, Any]]:
    if state.ledger is None:
        return []
    return [item.as_dict(state.ledger.decimals) for item in state.ledger.review.values()]


async def _loop() -> None:
    log.info("agent loop started (run %s, mode %s)", state.run_id, state.mode)
    while state.running:
        try:
            await run_tick()
        except Exception as exc:  # noqa: BLE001
            # A tick must never take the loop down with it.
            log.exception("tick failed")
            state.last_error = str(exc)
            _emit("error", {"message": str(exc)[:300]})
        await asyncio.sleep(get_settings().tick_seconds)
    log.info("agent loop stopped")


def start(mode: Mode | None = None) -> dict[str, Any]:
    if state.running:
        return state.snapshot()

    if mode:
        state.mode = mode
    state.running = True
    state.run_id = uuid.uuid4().hex[:12]
    state.tick = 0
    # Fresh AP state per run — otherwise the invoice arrival clock and the review queue carry over
    # from the previous demo.
    reset_ledger()
    state._task = asyncio.create_task(_loop())
    _emit("started", state.snapshot())
    return state.snapshot()


async def stop() -> dict[str, Any]:
    state.running = False
    if state._task:
        state._task.cancel()
        try:
            await state._task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        state._task = None
    _emit("stopped", state.snapshot())
    return state.snapshot()


def set_mode(mode: Mode) -> dict[str, Any]:
    state.mode = mode
    _emit("mode", {"mode": mode})
    return state.snapshot()
