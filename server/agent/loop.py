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
from agent.llm import AllProvidersFailed, get_router
from agent.prompts import (
    SYSTEM_PROMPT,
    InvoiceBook,
    clean_invoices,
    injected_invoices,
)
from agent.tools import TOOL_SCHEMAS, ToolBox, counterparties
from chain.client import get_chain
from config import from_base_units, get_settings

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


def _book_for(mode: Mode) -> InvoiceBook:
    parties = counterparties()
    return InvoiceBook(
        invoices=injected_invoices(parties) if mode == "injected" else clean_invoices(parties)
    )


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

    book = _book_for(mode)
    toolbox = ToolBox(book)
    router = get_router()

    snapshot = chain.policy_snapshot()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Payment cycle {tick}. Wallet balance is "
                f"{from_base_units(snapshot.balance):.2f} mUSDC. Review the queue and settle "
                "anything that needs settling."
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

    for _ in range(get_settings().max_tool_iterations):
        try:
            result = await router.chat(messages, tools=TOOL_SCHEMAS, prefer=prefer)
        except AllProvidersFailed as exc:
            state.last_error = str(exc)
            _emit("error", {"tick": tick, "message": str(exc)})
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
            # No tool calls means the agent is done deciding this cycle. Also the path a refusal
            # takes, which is why this is a normal exit rather than an error.
            break

        messages.append(
            {
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments,
                        },
                    }
                    for call in tool_calls
                ],
            }
        )

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

    reasoning = "\n\n".join(reasoning_parts) or "(no narration)"

    await ingest.record_decision(
        run_id=state.run_id, tick=tick, mode=mode, provider=provider_used,
        model=model_used, reasoning=reasoning, tool_calls=tool_calls_log,
    )

    for payment in toolbox.payments:
        invoice = book.find(payment.to)
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

    _emit("tick_end", {"tick": tick, "provider": provider_used})

    return {
        "tick": tick,
        "mode": mode,
        "provider": provider_used,
        "payments": len(toolbox.payments),
        "reasoning": reasoning,
    }


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
