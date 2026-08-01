"""Provider layer for Gemini and Groq.

Both expose OpenAI-compatible endpoints, so a single SDK and a single tool-calling loop serve
both and switching providers is a base-URL swap. Failover between them is genuinely useful rather
than decorative: the free tiers rate-limit, and they are separate buckets, so a 429 on one is not
a 429 on the other.
"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass
from typing import Any

from openai import AsyncOpenAI, APIError, APIStatusError, RateLimitError

from config import get_settings

log = logging.getLogger(__name__)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"


@dataclass
class Provider:
    name: str
    model: str
    client: AsyncOpenAI


@dataclass
class LLMResult:
    provider: str
    model: str
    message: Any
    """The raw assistant message. May carry `tool_calls`, plain `content`, or neither."""


class AllProvidersFailed(RuntimeError):
    pass


class EmptyResponse(RuntimeError):
    """Provider returned 200 with no choices — usually a safety block on Gemini."""


class LLMRouter:
    def __init__(self) -> None:
        self._providers: dict[str, Provider] = {}
        settings = get_settings()

        if settings.gemini_api_key:
            self._providers["gemini"] = Provider(
                name="gemini",
                model=settings.gemini_model,
                client=AsyncOpenAI(
                    api_key=settings.gemini_api_key,
                    base_url=GEMINI_BASE_URL,
                    timeout=60.0,
                    max_retries=0,  # retry/failover is handled here, not silently in the SDK
                ),
            )

        if settings.groq_api_key:
            self._providers["groq"] = Provider(
                name="groq",
                model=settings.groq_model,
                client=AsyncOpenAI(
                    api_key=settings.groq_api_key,
                    base_url=GROQ_BASE_URL,
                    timeout=60.0,
                    max_retries=0,
                ),
            )

        if not self._providers:
            raise RuntimeError("No LLM providers configured.")

    @property
    def available(self) -> list[str]:
        return list(self._providers)

    def _order(self, prefer: str | None) -> list[Provider]:
        """Preferred provider first, then the rest as failover."""
        names = list(self._providers)
        if prefer and prefer in self._providers:
            names.remove(prefer)
            names.insert(0, prefer)
        return [self._providers[name] for name in names]

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        prefer: str | None = None,
        temperature: float = 0.2,
    ) -> LLMResult:
        last_error: Exception | None = None

        for provider in self._order(prefer):
            for attempt in range(2):
                try:
                    response = await provider.client.chat.completions.create(
                        model=provider.model,
                        messages=messages,  # type: ignore[arg-type]
                        tools=tools,  # type: ignore[arg-type]
                        tool_choice="auto" if tools else None,  # type: ignore[arg-type]
                        temperature=temperature,
                    )

                    # Gemini can return a candidate with a safety finish reason and no choices at
                    # all. Reading choices[0] unconditionally is a crash waiting to happen on
                    # stage, and the compromised-agent prompt is exactly the kind of input that
                    # triggers it.
                    if not response.choices:
                        raise EmptyResponse(
                            f"{provider.name} returned no choices (likely a safety block)"
                        )

                    return LLMResult(
                        provider=provider.name,
                        model=provider.model,
                        message=response.choices[0].message,
                    )

                except RateLimitError as exc:
                    last_error = exc
                    if attempt == 0:
                        delay = 1.5 + random.random()
                        log.warning(
                            "%s rate limited, retrying in %.1fs", provider.name, delay
                        )
                        await asyncio.sleep(delay)
                        continue
                    log.warning("%s still rate limited — failing over", provider.name)
                    break

                except (APIStatusError, APIError, EmptyResponse) as exc:
                    last_error = exc
                    log.warning("%s failed (%s) — failing over", provider.name, exc)
                    break

        raise AllProvidersFailed(
            f"every provider failed; last error: {last_error}"
        ) from last_error


_router: LLMRouter | None = None


def get_router() -> LLMRouter:
    global _router
    if _router is None:
        _router = LLMRouter()
    return _router
