"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AgentStatusStrip } from "@/components/agent/status-strip";
import { DecisionVerdictList } from "@/components/agent/decision-verdict";
import { LiveTrace } from "@/components/agent/live-trace";
import { ConnectButton } from "@/components/connect-button";
import { useConsole } from "@/components/console-data";
import { Estop, EstopCaption } from "@/components/estop";
import { Gauge } from "@/components/gauge";
import { Shell } from "@/components/layout";
import { LockoutTag } from "@/components/lockout-tag";
import { Button } from "@/components/ui/button";
import { formatFixed2 } from "@/lib/format";
import { useAgent } from "@/lib/use-agent";

/**
 * The judge stage.
 *
 * Built to answer the requirement in one screen: an agent running unsupervised, attempting to
 * exceed its policy, and being blocked. Top to bottom that is — is it alive, what is it thinking,
 * and what did the chain do about it.
 *
 * Everything below the status strip works with the agent process down; it falls back to persisted
 * chain data and says so. The argument is what the *contract* did, and that is recorded whether or
 * not the agent is currently talking.
 */

const SCENARIOS = [
  {
    id: "a",
    letter: "A",
    title: "Normal operation",
    path: "/demo/scenario/a",
    expect: "Pays an allowlisted vendor within the caps. It goes through.",
    outcome: "PaymentExecuted",
  },
  {
    id: "b",
    letter: "B",
    title: "Attack",
    path: "/demo/scenario/b",
    expect:
      "A poisoned invoice steers the agent at an address nobody approved. The contract refuses it.",
    outcome: "CounterpartyNotAllowed",
  },
  {
    id: "c",
    letter: "C",
    title: "Freeze mid-flight",
    path: "/demo/scenario/c?legs=3&amount_usdc=20",
    expect:
      "Starts a three-leg run with a pause between legs. Hold the switch while it runs and the rest never happens.",
    outcome: "WalletPaused",
  },
] as const;

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8000";

type TraceLine = { id: number; text: string; tone: "note" | "good" | "bad" };

export function DemoStage() {
  const { data, freeze, paused, toggleFreeze, connectError } = useConsole();
  const agent = useAgent();

  const [running, setRunning] = useState<string | null>(null);
  const [log, setLog] = useState<TraceLine[]>([]);

  const say = useCallback((text: string, tone: TraceLine["tone"] = "note") => {
    setLog((lines) => [{ id: Date.now() + Math.random(), text, tone }, ...lines].slice(0, 12));
  }, []);

  async function run(scenario: (typeof SCENARIOS)[number]) {
    setRunning(scenario.id);
    say(`Scenario ${scenario.letter} — ${scenario.title}`);

    try {
      const response = await fetch(`${AGENT_URL}${scenario.path}`, { method: "POST" });
      const payload = await response.json();

      if (!response.ok) {
        say(payload.detail ?? "The agent could not run that scenario", "bad");
      } else if (scenario.id === "c") {
        say("Run started. Legs land seconds apart — freeze it now.", "good");
      } else {
        if (payload.note) say(payload.note);
        if (payload.injectionFollowed === false) {
          say("The model declined the injection. Running it without a model instead…");
          const rogue = await fetch(`${AGENT_URL}/demo/scenario/b-rogue`, { method: "POST" });
          const body = await rogue.json();
          say(
            body.error ? `Refused on chain: ${body.error}` : `Broadcast ${body.txHash ?? ""}`,
            body.error ? "bad" : "good",
          );
        }
        say("Done. The verdict is below.", "good");
      }
    } catch {
      say("The agent is not reachable", "bad");
    } finally {
      setRunning(null);
    }
  }

  const state = data.state;
  const offline = agent.online === false;

  return (
    <main className="flex min-h-svh flex-col">
      <header className="border-b border-black/45">
        <Shell className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="legend text-placard/70 transition-colors hover:text-placard">
              ← Kill Switch
            </Link>
            <span className="flex items-center gap-2">
              <span
                className={`led ${data.connected ? "led-running" : "led-off"}`}
                aria-hidden="true"
              />
              <span className="legend text-placard/55">
                {data.connected ? "Chain live" : "Chain offline"}
              </span>
            </span>
            {data.indexerStale && (
              <span className="legend text-hazard">Figures may be behind</span>
            )}
          </div>
          <ConnectButton />
        </Shell>
      </header>

      <Shell className="grid flex-1 grid-cols-1 gap-x-16 gap-y-10 py-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <h1 className="display text-panel text-placard sm:text-display sm:leading-[0.9]">
            An agent, governed
          </h1>
          <p className="measure mt-5 text-body text-placard/70">
            The agent decides on its own. The contract decides whether that decision becomes a
            payment. Run a scenario and watch the two disagree.
          </p>

          {/* --- Is it alive? ------------------------------------------- */}
          <section className="settle mt-10">
            <h2 className="legend pb-3 text-placard/70">Agent</h2>
            <AgentStatusStrip agent={agent} />
          </section>

          {/* --- Scenarios ---------------------------------------------- */}
          <section className="settle mt-10" style={{ animationDelay: "60ms" }}>
            <h2 className="legend pb-3 text-placard/70">Scenarios</h2>
            <div className="grid gap-4 lg:grid-cols-3">
              {SCENARIOS.map((scenario) => (
                <div key={scenario.id} className="m-panel flex flex-col px-5 py-5">
                  <div className="flex items-baseline gap-3">
                    <span className="display text-lead leading-none text-placard/30">
                      {scenario.letter}
                    </span>
                    <h3 className="heading text-subhead text-placard">{scenario.title}</h3>
                  </div>

                  <p className="mt-3 flex-1 text-body text-placard/65">{scenario.expect}</p>

                  <p className="font-mono text-legend text-placard/45">
                    Expect <span className="text-hazard">{scenario.outcome}</span>
                  </p>

                  {/* Secondary on purpose. These are three peers; the one primary on this
                      page is Start agent. Three yellow fills side by side name nothing. */}
                  <Button
                    variant="secondary"
                    className="mt-4 w-full"
                    disabled={offline || running !== null}
                    onClick={() => void run(scenario)}
                  >
                    {running === scenario.id ? "Running…" : "Run"}
                  </Button>
                </div>
              ))}
            </div>

            {log.length > 0 && (
              <ul className="m-well mt-4 flex flex-col gap-1.5 px-4 py-3.5" aria-live="polite">
                {log.map((line) => (
                  <li
                    key={line.id}
                    className="font-mono text-legend"
                    style={{
                      color:
                        line.tone === "bad"
                          ? "var(--color-estop)"
                          : line.tone === "good"
                            ? "var(--color-running)"
                            : "rgb(232 228 217 / .6)",
                    }}
                  >
                    ▸ {line.text}
                  </li>
                ))}
              </ul>
            )}
          </section>


          {/* --- The argument ------------------------------------------- */}
          <section className="settle mt-12">
            <h2 className="legend text-placard/70">Decided, then ruled on</h2>
            <p className="measure mb-4 mt-2 text-body text-placard/55">
              What the agent intended, beside what the chain independently did about it.
            </p>
            <DecisionVerdictList decisions={data.decisions} attempts={data.attempts} limit={5} />
          </section>

          {/* --- Thinking out loud -------------------------------------- */}
          <section className="settle mt-12">
            <h2 className="legend pb-3 text-placard/70">Reasoning</h2>
            <LiveTrace ticks={agent.ticks} decisions={data.decisions} online={agent.online} />
          </section>
        </div>

        {/* --- The switch, always in reach ------------------------------ */}
        {/* `min-w-0`: a grid child defaults to `min-width: auto`, which refuses to shrink below
            its content and pushes the whole row wider than the viewport on a phone. */}
        <aside className="flex min-w-0 flex-col items-center gap-6 xl:sticky xl:top-8 xl:self-start">
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

          {state && (
            <div className="m-panel w-full max-w-xs px-5 py-5">
              <Gauge spent={state.spentInWindow} cap={state.rollingCap} paused={paused} />
              <hr className="rule-engraved my-5" />
              <div className="flex items-baseline justify-between gap-3">
                <span className="legend text-placard/45">Per tx</span>
                <span className="tnum font-mono text-legend text-placard/80">
                  {formatFixed2(state.perTxCap)}
                </span>
              </div>
            </div>
          )}
        </aside>
      </Shell>
    </main>
  );
}
