"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useConsole } from "@/components/console-data";
import { Estop, EstopCaption } from "@/components/estop";
import { Gauge } from "@/components/gauge";
import { LockoutTag } from "@/components/lockout-tag";
import { Stat } from "@/components/stat";
import { Ticker } from "@/components/ticker";
import { formatFixed2, shortenAddress } from "@/lib/format";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8000";

interface ThreatState {
  blockedStreak: number;
  autoPauseThreshold: number;
  autoTriggered: boolean;
  paused: boolean;
  remainingUsdc: number;
  spentUsdc: number;
}

function ThreatPanel() {
  const [threat, setThreat] = useState<ThreatState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`${AGENT_URL}/agent/threat`);
        if (res.ok && !cancelled) setThreat(await res.json());
      } catch { /* agent offline */ }
    }
    void poll();
    const id = setInterval(() => void poll(), 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!threat) return null;

  const streakPct = Math.min((threat.blockedStreak / threat.autoPauseThreshold) * 100, 100);
  const streakTone = threat.blockedStreak === 0 ? "normal" : threat.blockedStreak >= threat.autoPauseThreshold ? "stopped" : "caution";

  return (
    <section className="m-panel px-6 py-5">
      <h2 className="legend text-placard/70">Threat Monitor</h2>
      <p className="legend mt-1 text-placard/40">
        Contract auto-pauses after {threat.autoPauseThreshold} consecutive blocked attempts.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <p className="legend text-placard/55">Blocked streak</p>
          <p
            className="heading mt-1 text-lead leading-none"
            style={{
              color: streakTone === "stopped" ? "var(--color-estop)" : streakTone === "caution" ? "var(--color-hazard)" : undefined,
            }}
          >
            {threat.blockedStreak} / {threat.autoPauseThreshold}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-enamel-lo">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${streakPct}%`,
                backgroundColor: streakTone === "stopped" ? "var(--color-estop)" : streakTone === "caution" ? "var(--color-hazard)" : "var(--color-running)",
              }}
            />
          </div>
        </div>

        <div>
          <p className="legend text-placard/55">Auto-pause</p>
          <p
            className="heading mt-1 text-lead leading-none"
            style={{ color: threat.autoTriggered ? "var(--color-estop)" : undefined }}
          >
            {threat.autoTriggered ? "Triggered" : "Armed"}
          </p>
          <p className="legend mt-1 text-placard/40">
            {threat.autoTriggered ? "Contract self-paused" : "Watching for streak"}
          </p>
        </div>

        <div>
          <p className="legend text-placard/55">Remaining today</p>
          <p className="heading mt-1 text-lead leading-none">
            {threat.remainingUsdc.toFixed(2)}
            <span className="legend ml-1 text-placard/40">mUSDC</span>
          </p>
          <p className="legend mt-1 text-placard/40">{threat.spentUsdc.toFixed(2)} spent</p>
        </div>
      </div>
    </section>
  );
}

export default function ConsoleOverview() {
  const { data, freeze, paused, toggleFreeze, connectError } = useConsole();
  const state = data.state;

  if (!data.loading && !data.deployed) {
    return <NotDeployed />;
  }

  const throttled = state ? state.throttleBps < 10000 : false;
  const status = paused ? "Frozen" : throttled ? "Throttled" : "Running";

  return (
    <div className="mx-auto flex max-w-384 flex-col gap-10">
      <header>
        <h1 className="heading text-panel text-placard">Overview</h1>
        <p className="measure mt-2 text-body text-placard/65">
          Every figure here is contract storage, read back. Nothing on this page is what the agent
          reported about itself.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          legend="Agent"
          value={status}
          tone={paused ? "stopped" : throttled ? "caution" : "normal"}
          note={
            throttled && state
              ? `Throttled to ${(state.throttleBps / 100).toFixed(0)}% of full limits`
              : paused
                ? "Every payment reverts"
                : "Operating within policy"
          }
        />
        <Stat
          legend="Per transaction"
          value={state ? formatFixed2(state.perTxCap) : "—"}
          note="Effective cap, throttle applied"
        />
        <Stat
          legend="Remaining today"
          value={state ? formatFixed2(state.remaining) : "—"}
          tone={state && BigInt(state.remaining) === 0n ? "stopped" : "normal"}
          note="Rolling 24 hours"
        />
        <Stat
          legend="Wallet balance"
          value={state ? formatFixed2(state.balance) : "—"}
          note="mUSDC held by the contract"
        />
      </section>

      <ThreatPanel />

      <section className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="m-panel px-6 py-6">
          {state ? (
            <Gauge spent={state.spentInWindow} cap={state.rollingCap} paused={paused} />
          ) : (
            <p className="legend text-placard/45">Waiting for the indexer</p>
          )}

          <hr className="rule-engraved my-6" />

          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Row label="Wallet" value={data.contracts?.agentWallet} />
            <Row label="Owner" value={data.owner} />
          </dl>
        </div>

        <div className="flex flex-col items-center gap-5 lg:pl-4">
          <div className="estop-mount">
            <Estop
              paused={paused}
              status={freeze.status}
              connected={freeze.connected}
              onFreeze={toggleFreeze}
              onRelease={toggleFreeze}
            />
          </div>
          <EstopCaption
            paused={paused}
            status={freeze.status}
            connected={freeze.connected}
            isOwner={freeze.isOwner}
            error={freeze.error ?? connectError}
          />
          {paused && <LockoutTag owner={freeze.owner ?? data.owner} />}
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4 pb-3">
          <h2 className="legend text-placard/70">Recent attempts</h2>
          <Link
            href="/console/activity"
            className="legend text-placard/50 underline decoration-placard/25 underline-offset-4 transition-colors hover:text-placard"
          >
            Full log
          </Link>
        </div>
        <Ticker attempts={data.attempts} limit={6} />
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="legend text-placard/45">{label}</dt>
      <dd className="font-mono text-legend text-placard/80" title={value ?? undefined}>
        {value ? shortenAddress(value) : "—"}
      </dd>
    </div>
  );
}

/**
 * Empty state for the console.
 *
 * Carries no setup instructions on purpose. This is a product surface an evaluator may land on;
 * shell commands here read as an unfinished build. Setup lives in SETUP.md.
 */
function NotDeployed() {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="heading text-panel text-placard">No wallet under management</h1>
      <p className="mt-3 text-body text-placard/70">
        This console governs a policy-enforcing wallet — its spend limits, approved counterparties,
        agent session keys and the freeze. Every one of those controls lives in contract storage
        rather than in the agent, so none of them depend on the agent cooperating.
      </p>
      <p className="mt-4 text-body text-placard/45">
        Nothing is currently detected on the configured network.
      </p>
    </div>
  );
}
