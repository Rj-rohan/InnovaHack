"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AllowlistEntry,
  ChainState,
  Decision,
  PolicyEvent,
  TxAttempt,
} from "./collections";

/**
 * Headless live-data hook for the dashboard.
 *
 * Deliberately renders nothing and imposes no markup — presentation belongs to the UI layer.
 * Fetches a snapshot from /api/state, then subscribes to /api/stream for deltas.
 */

export interface KillSwitchData {
  loading: boolean;
  deployed: boolean;
  connected: boolean;
  chainId: number | null;
  contracts: { agentWallet: `0x${string}`; mockUsdc: `0x${string}` } | null;
  owner: `0x${string}` | null;
  counterparties: { address: `0x${string}`; tag: string; label: string }[];
  state: ChainState | null;
  attempts: TxAttempt[];
  events: PolicyEvent[];
  decisions: Decision[];
  allowlist: AllowlistEntry[];
  /** True when the indexer has not written recently — surface it, don't hide it. */
  indexerStale: boolean;
  notice: string | null;
  refresh: () => void;
}

const MAX_ROWS = 60;

/** Newest-first merge that replaces a row in place when it already exists. */
function upsert<T>(rows: T[], incoming: T, isSame: (a: T, b: T) => boolean): T[] {
  const index = rows.findIndex((row) => isSame(row, incoming));
  if (index === -1) return [incoming, ...rows].slice(0, MAX_ROWS);
  const next = rows.slice();
  next[index] = incoming;
  return next;
}

export function useKillSwitch(): KillSwitchData {
  const [loading, setLoading] = useState(true);
  const [deployed, setDeployed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [chainId, setChainId] = useState<number | null>(null);
  const [contracts, setContracts] = useState<KillSwitchData["contracts"]>(null);
  const [owner, setOwner] = useState<`0x${string}` | null>(null);
  const [counterparties, setCounterparties] = useState<KillSwitchData["counterparties"]>([]);
  const [state, setState] = useState<ChainState | null>(null);
  const [attempts, setAttempts] = useState<TxAttempt[]>([]);
  const [events, setEvents] = useState<PolicyEvent[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [indexerStale, setIndexerStale] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const sourceRef = useRef<EventSource | null>(null);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Snapshot
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        const payload = await response.json();
        if (cancelled) return;

        if (!payload.deployed) {
          setDeployed(false);
          setLoading(false);
          return;
        }

        setDeployed(true);
        setChainId(payload.chainId ?? null);
        setContracts(payload.contracts ?? null);
        setOwner(payload.owner ?? null);
        setCounterparties(payload.counterparties ?? []);
        setState(payload.state ?? null);
        setAttempts(payload.attempts ?? []);
        setEvents(payload.events ?? []);
        setDecisions(payload.decisions ?? []);
        setIndexerStale(payload.indexerHealthy === false);
      } catch {
        if (!cancelled) setNotice("Could not reach /api/state");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Live deltas
  useEffect(() => {
    const source = new EventSource("/api/stream");
    sourceRef.current = source;

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false); // EventSource reconnects on its own

    source.addEventListener("snapshot", (event) => {
      const payload = JSON.parse((event as MessageEvent).data);
      if (payload.attempts) setAttempts(payload.attempts);
      if (payload.events) setEvents(payload.events);
      if (payload.state) setState(payload.state);
    });

    source.addEventListener("tx", (event) => {
      const doc = JSON.parse((event as MessageEvent).data) as TxAttempt;
      setAttempts((rows) =>
        upsert(rows, doc, (a, b) =>
          a.txHash != null && b.txHash != null
            ? a.txHash === b.txHash && a.legIndex === b.legIndex
            : a.runId === b.runId && a.tick === b.tick && a.to === b.to,
        ),
      );
    });

    source.addEventListener("policy", (event) => {
      const doc = JSON.parse((event as MessageEvent).data) as PolicyEvent;
      setEvents((rows) =>
        upsert(rows, doc, (a, b) => a.txHash === b.txHash && a.logIndex === b.logIndex),
      );
    });

    source.addEventListener("decision", (event) => {
      const doc = JSON.parse((event as MessageEvent).data) as Decision;
      setDecisions((rows) => upsert(rows, doc, (a, b) => a.runId === b.runId && a.tick === b.tick));
    });

    source.addEventListener("state", (event) => {
      const doc = JSON.parse((event as MessageEvent).data) as ChainState;
      setState(doc);
      setIndexerStale(false);
    });

    source.addEventListener("notice", (event) => {
      setNotice(JSON.parse((event as MessageEvent).data).message ?? null);
    });

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, []);

  // The indexer writes chain_state every few seconds. If it goes quiet the numbers on screen are
  // stale, and a dashboard that quietly shows stale safety limits is worse than one that admits it.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!state) return;
      setIndexerStale(Date.now() - new Date(state.updatedAt).getTime() > 30_000);
    }, 5000);
    return () => clearInterval(timer);
  }, [state]);

  return {
    loading,
    deployed,
    connected,
    chainId,
    contracts,
    owner,
    counterparties,
    state,
    attempts,
    events,
    decisions,
    allowlist: state?.allowlist ?? [],
    indexerStale,
    notice,
    refresh,
  };
}
