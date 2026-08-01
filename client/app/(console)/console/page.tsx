"use client";

import Link from "next/link";
import { useConsole } from "@/components/console-data";
import { Estop, EstopCaption } from "@/components/estop";
import { Gauge } from "@/components/gauge";
import { LockoutTag } from "@/components/lockout-tag";
import { Stat } from "@/components/stat";
import { Ticker } from "@/components/ticker";
import { formatFixed6, shortenAddress } from "@/lib/format";

export default function ConsoleOverview() {
  const { data, freeze, paused, toggleFreeze } = useConsole();
  const state = data.state;

  if (!data.loading && !data.deployed) {
    return <NotDeployed />;
  }

  const throttled = state ? state.throttleBps < 10000 : false;
  const status = paused ? "Frozen" : throttled ? "Throttled" : "Running";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10">
      <header>
        <h1 className="heading text-panel text-placard">Overview</h1>
        <p className="mt-2 max-w-xl text-body text-placard/65">
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
          value={state ? formatFixed6(state.perTxCap) : "—"}
          note="Effective cap, throttle applied"
        />
        <Stat
          legend="Remaining today"
          value={state ? formatFixed6(state.remaining) : "—"}
          tone={state && BigInt(state.remaining) === 0n ? "stopped" : "normal"}
          note="Rolling 24 hours"
        />
        <Stat
          legend="Wallet balance"
          value={state ? formatFixed6(state.balance) : "—"}
          note="mUSDC held by the contract"
        />
      </section>

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
            error={freeze.error}
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

function NotDeployed() {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="heading text-panel text-placard">Nothing deployed yet</h1>
      <p className="mt-3 text-body text-placard/70">
        The console reads a deployment record written by the deploy script. Once the contracts are
        on Sepolia and the indexer is running, this page fills itself in.
      </p>

      <ol className="m-panel mt-7 flex flex-col gap-4 px-5 py-5">
        <Step n={1} cmd="cd contracts && npm run deploy:sepolia">
          Deploys AgentWallet and MockUSDC, funds the wallet, grants the agent a session key and
          writes the deployment record.
        </Step>
        <Step n={2} cmd="cd client && npx tsx scripts/indexer.ts">
          Follows contract events and keeps the dashboard's figures current.
        </Step>
        <Step n={3} cmd="cd server && python main.py">
          Starts the agent so there is something to watch.
        </Step>
      </ol>
    </div>
  );
}

function Step({ n, cmd, children }: { n: number; cmd: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-x-3">
      <span className="display text-legend leading-6 text-placard/30">{n}</span>
      <div>
        <code className="font-mono text-legend text-hazard">{cmd}</code>
        <p className="mt-1 text-body text-placard/60">{children}</p>
      </div>
    </li>
  );
}
