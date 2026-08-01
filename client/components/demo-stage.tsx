"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConnectButton } from "@/components/connect-button";
import { useConsole } from "@/components/console-data";
import { Estop, EstopCaption } from "@/components/estop";
import { Gauge } from "@/components/gauge";
import { LockoutTag } from "@/components/lockout-tag";
import { Ticker } from "@/components/ticker";
import { formatFixed6 } from "@/lib/format";

/**
 * The judge stage.
 *
 * Built to be read across a room: large type, three buttons, one trace. The agent service is
 * optional — with no `NEXT_PUBLIC_AGENT_URL` reachable the page runs in watch mode, showing the
 * same live trace from chain data with the run buttons disabled and a line saying why. Watch mode
 * is the useful half anyway: the argument is what the *contract* did, not what triggered it.
 */

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8000";

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
      "Starts a three-leg run with 20s between legs. Hold the switch while it is running and the rest never happens.",
    outcome: "WalletPaused",
  },
] as const;

type TraceLine = { id: number; text: string; tone: "note" | "good" | "bad" };

export function DemoStage() {
  const { data, freeze, paused, toggleFreeze, connectError } = useConsole();

  const [agentUp, setAgentUp] = useState<boolean | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceLine[]>([]);

  const say = useCallback((text: string, tone: TraceLine["tone"] = "note") => {
    setTrace((lines) => [{ id: Date.now() + Math.random(), text, tone }, ...lines].slice(0, 40));
  }, []);

  // Probe once. A failed probe is information, not an error to swallow.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${AGENT_URL}/health`, { cache: "no-store" });
        if (!cancelled) setAgentUp(response.ok);
      } catch {
        if (!cancelled) setAgentUp(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(scenario: (typeof SCENARIOS)[number]) {
    setRunning(scenario.id);
    say(`Scenario ${scenario.letter} — ${scenario.title}`);

    try {
      const response = await fetch(`${AGENT_URL}${scenario.path}`, { method: "POST" });
      const payload = await response.json();

      if (!response.ok) {
        say(payload.detail ?? `Agent returned ${response.status}`, "bad");
      } else if (scenario.id === "c") {
        say("Run started. Legs land ~20s apart — freeze it now.", "good");
      } else {
        if (payload.note) say(payload.note);
        if (payload.injectionFollowed === false) {
          say("Model declined the injection. Running the rogue variant instead…");
          const rogue = await fetch(`${AGENT_URL}/demo/scenario/b-rogue`, { method: "POST" });
          const rogueBody = await rogue.json();
          say(
            rogueBody.error
              ? `Refused on chain: ${rogueBody.error}`
              : `Broadcast ${rogueBody.txHash ?? ""}`,
            rogueBody.error ? "bad" : "good",
          );
        }
        say("Done. Watch the trace below for what the contract decided.", "good");
      }
    } catch {
      say("Could not reach the agent service.", "bad");
      setAgentUp(false);
    } finally {
      setRunning(null);
    }
  }

  const state = data.state;

  return (
    <main className="flex min-h-svh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-black/45 px-6 py-4 sm:px-10">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/" className="legend text-placard/70 transition-colors hover:text-placard">
            ← Kill Switch
          </Link>
          <span className="flex items-center gap-2">
            <span
              className={`led ${agentUp === null ? "led-off" : agentUp ? "led-running" : "led-stopped"}`}
              aria-hidden="true"
            />
            <span className="legend text-placard/55">
              {agentUp === null ? "Checking agent…" : agentUp ? "Agent reachable" : "Watch mode"}
            </span>
          </span>
        </div>
        <ConnectButton />
      </header>

      <div className="grid flex-1 grid-cols-1 gap-10 px-6 py-10 sm:px-10 xl:grid-cols-[1.35fr_auto]">
        <div className="min-w-0">
          <h1 className="display text-panel text-placard sm:text-display sm:leading-[0.9]">
            Three scenarios
          </h1>

          {agentUp === false && (
            <p className="m-well mt-6 max-w-2xl px-4 py-3.5 text-body text-placard/70">
              The agent service isn&apos;t answering at{" "}
              <span className="font-mono text-placard">{AGENT_URL}</span>. Start it with{" "}
              <span className="font-mono text-placard">uvicorn main:app --port 8000</span> in{" "}
              <span className="font-mono text-placard">server/</span>. The trace below stays live
              either way — it reads the chain, not the agent.
            </p>
          )}

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {SCENARIOS.map((scenario) => (
              <div key={scenario.id} className="m-panel flex flex-col px-5 py-5">
                <div className="flex items-baseline gap-3">
                  <span className="display text-lead leading-none text-placard/30">
                    {scenario.letter}
                  </span>
                  <h2 className="heading text-body text-placard">{scenario.title}</h2>
                </div>

                <p className="mt-3 flex-1 text-body text-placard/65">{scenario.expect}</p>

                <p className="font-mono text-legend text-placard/45">
                  Expect <span className="text-hazard">{scenario.outcome}</span>
                </p>

                <button
                  type="button"
                  disabled={!agentUp || running !== null}
                  onClick={() => void run(scenario)}
                  className="legend mt-4 px-4 py-3 text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: "var(--color-hazard)" }}
                >
                  {running === scenario.id ? "Running…" : "Run"}
                </button>
              </div>
            ))}
          </div>

          {/* --- Trace ---------------------------------------------------- */}
          <section className="mt-10">
            <div className="flex items-baseline justify-between gap-4 pb-3">
              <h2 className="legend text-placard/70">Live trace</h2>
              <span className="legend flex items-center gap-2 text-placard/45">
                <span
                  className={`led ${data.connected ? "led-running" : "led-off"}`}
                  aria-hidden="true"
                />
                {data.connected ? "Listening" : "Offline"}
              </span>
            </div>

            {trace.length > 0 && (
              <ul className="m-well mb-3 flex flex-col gap-1.5 px-4 py-3.5" aria-live="polite">
                {trace.map((line) => (
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

            <Ticker
              attempts={data.attempts}
              limit={12}
              emptyHint="Run a scenario, or start the agent, and payments appear here as the chain settles them."
            />
          </section>
        </div>

        {/* --- The switch --------------------------------------------------- */}
        <aside className="flex flex-col items-center gap-6 xl:sticky xl:top-10 xl:self-start">
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
                  {formatFixed6(state.perTxCap)}
                </span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
