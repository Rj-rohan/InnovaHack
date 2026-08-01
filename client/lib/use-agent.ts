"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMode } from "./policy";

/**
 * Client for the agent service.
 *
 * Deliberately optional. Every panel built on this must still render from persisted chain data
 * when the agent process is down — the chain is the source of truth, the agent is a thing that
 * talks to it. So failures here resolve to `online: false` and never throw.
 *
 * Two feeds, and they are not interchangeable: the dashboard's `/api/stream` carries persisted
 * chain state, this one carries the agent thinking out loud and is intentionally ephemeral.
 */

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8000";
const POLL_MS = 3000;

export interface AgentStatus {
  running: boolean;
  mode: AgentMode;
  runId: string | null;
  tick: number;
  lastProvider: string | null;
  lastError: string | null;
  providers: string[];
  sessionKey: string | null;
  /** Wei, as a decimal string. Zero here means every payment fails for a boring reason. */
  sessionKeyEth: string | null;
  wallet: string | null;
  chainId: number | null;
}

export interface ToolCall {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
}

/** One decision cycle, assembled from the event stream. */
export interface AgentTick {
  tick: number;
  mode?: string;
  provider?: string;
  reasoning: string;
  toolCalls: ToolCall[];
  ended: boolean;
  at: string;
}

export interface AgentControls {
  /** null while the first probe is in flight. */
  online: boolean | null;
  status: AgentStatus | null;
  /** Newest first. Live only — history comes from `decisions[]` in the database. */
  ticks: AgentTick[];
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setMode: (mode: AgentMode) => Promise<void>;
  approve: (invoiceId: string) => Promise<boolean>;
  reject: (invoiceId: string) => Promise<boolean>;
}

const MAX_TICKS = 12;

/** Fold one stream event into the running list of ticks. Newest tick first. */
function reduceTick(ticks: AgentTick[], event: string, data: Record<string, unknown>, at: string) {
  const tickNumber = typeof data.tick === "number" ? data.tick : ticks[0]?.tick;
  if (tickNumber === undefined) return ticks;

  const next = ticks.slice();
  let index = next.findIndex((t) => t.tick === tickNumber);

  if (index === -1) {
    next.unshift({ tick: tickNumber, reasoning: "", toolCalls: [], ended: false, at });
    index = 0;
  }

  const tick = { ...next[index] };

  switch (event) {
    case "tick_start":
      tick.mode = typeof data.mode === "string" ? data.mode : tick.mode;
      break;
    case "reasoning":
      tick.reasoning = typeof data.text === "string" ? data.text : tick.reasoning;
      tick.provider = typeof data.provider === "string" ? data.provider : tick.provider;
      break;
    case "tool_call":
      tick.toolCalls = [
        ...tick.toolCalls,
        {
          name: String(data.name ?? "tool"),
          args: (data.args as Record<string, unknown>) ?? undefined,
        },
      ];
      break;
    case "tool_result": {
      // Attach to the most recent call of that name that has no result yet. Matching by name
      // rather than by position: the agent can call the same tool twice in a cycle.
      const calls = tick.toolCalls.slice();
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i].name === data.name && calls[i].result === undefined) {
          calls[i] = { ...calls[i], result: String(data.result ?? "") };
          break;
        }
      }
      tick.toolCalls = calls;
      break;
    }
    case "tick_end":
      tick.ended = true;
      tick.provider = typeof data.provider === "string" ? data.provider : tick.provider;
      break;
  }

  next[index] = tick;
  return next.slice(0, MAX_TICKS);
}

export function useAgent(): AgentControls {
  const [online, setOnline] = useState<boolean | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [ticks, setTicks] = useState<AgentTick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  // --- Status poll -----------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      // Nothing to learn while the tab is hidden, and it keeps a laptop fan quiet during a demo.
      if (document.hidden) return;

      try {
        const response = await fetch(`${AGENT_URL}/agent/status`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json();
        if (cancelled) return;

        setStatus({
          running: Boolean(payload.running),
          mode: (payload.mode ?? "normal") as AgentMode,
          runId: payload.runId ?? null,
          tick: payload.tick ?? 0,
          lastProvider: payload.lastProvider ?? null,
          lastError: payload.lastError ?? null,
          providers: payload.providers ?? [],
          sessionKey: payload.sessionKey ?? null,
          sessionKeyEth: payload.sessionKeyEth ?? null,
          wallet: payload.wallet ?? null,
          chainId: payload.chainId ?? null,
        });
        setOnline(true);
        setError(null);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // --- Live trace ------------------------------------------------------
  useEffect(() => {
    // Only worth opening once the service has answered at least once; EventSource retries
    // forever otherwise and fills the console with errors during a chain-only demo.
    if (online !== true) return;

    const source = new EventSource(`${AGENT_URL}/agent/stream`);
    sourceRef.current = source;

    const handle = (raw: MessageEvent) => {
      try {
        const payload = JSON.parse(raw.data);
        const name = payload.event ?? raw.type;
        const data = (payload.data ?? payload) as Record<string, unknown>;
        const at = payload.at ?? new Date().toISOString();
        setTicks((current) => reduceTick(current, name, data, at));
      } catch {
        // A malformed frame is not worth tearing the feed down for.
      }
    };

    for (const name of ["tick_start", "reasoning", "tool_call", "tool_result", "tick_end"]) {
      source.addEventListener(name, handle as EventListener);
    }

    source.addEventListener("error", ((raw: MessageEvent) => {
      try {
        const payload = JSON.parse(raw.data);
        setError(String(payload.data?.message ?? payload.message ?? "Agent error"));
      } catch {
        /* transport-level error; the poll decides whether we are offline */
      }
    }) as EventListener);

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [online]);

  // --- Controls --------------------------------------------------------
  const post = useCallback(async (path: string, body?: unknown) => {
    try {
      const response = await fetch(`${AGENT_URL}${path}`, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setError(detail?.detail ?? `Agent returned ${response.status}`);
        return false;
      }
      setError(null);
      return true;
    } catch {
      setError("Could not reach the agent");
      setOnline(false);
      return false;
    }
  }, []);

  return {
    online,
    status,
    ticks,
    error,
    start: async () => void (await post("/agent/start")),
    stop: async () => void (await post("/agent/stop")),
    setMode: async (mode: AgentMode) => void (await post("/agent/mode", { mode })),
    approve: (invoiceId: string) => post(`/agent/review/${encodeURIComponent(invoiceId)}/approve`),
    reject: (invoiceId: string) => post(`/agent/review/${encodeURIComponent(invoiceId)}/reject`),
  };
}
