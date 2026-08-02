"use client";

import type { AgentControls } from "@/lib/use-agent";
import type { AgentMode } from "@/lib/policy";
import { Button } from "@/components/ui/button";
import { shortenAddress } from "@/lib/format";

/**
 * Is the agent alive, and what is it doing?
 *
 * "Unsupervised" has to be visibly true — without this there is no way to see the agent is even
 * running, which makes the whole demo a claim rather than a demonstration.
 *
 * Two things are surfaced rather than buried, both because hiding them costs more than showing
 * them: a session key with no ETH (every payment then fails for a dull reason that looks like the
 * policy working), and provider failover (which reads as resilience, not embarrassment).
 */

const MODES: { value: AgentMode; label: string; note: string }[] = [
  { value: "normal", label: "Normal", note: "Ordinary invoice processing" },
  { value: "injected", label: "Injected", note: "A poisoned invoice in the queue" },
  { value: "rogue", label: "Rogue", note: "No model in the loop at all" },
];

export function AgentStatusStrip({ agent }: { agent: AgentControls }) {
  const { online, status, error } = agent;

  if (online === false) {
    return (
      <div className="m-well px-5 py-4">
        <p className="legend flex items-center gap-2.5 text-hazard">
          <span className="led led-caution" aria-hidden="true" />
          Agent not reachable
        </p>
        <p className="measure mt-2 text-body text-placard/65">
          The chain view below is still live — everything the contract has done is recorded there.
          The agent&apos;s own commentary is what&apos;s unavailable.
        </p>
      </div>
    );
  }

  const running = status?.running ?? false;
  // Wei as a decimal string. Zero means broadcasts fail before policy is ever consulted.
  const outOfGas = status?.sessionKeyEth != null && BigInt(status.sessionKeyEth || "0") === 0n;

  return (
    <div className="m-panel px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2.5">
            <span
              className={`led ${online === null ? "led-off" : running ? "led-running" : "led-caution"}`}
              aria-hidden="true"
            />
            <span className="heading text-body text-placard">
              {online === null ? "Checking…" : running ? "Running" : "Stopped"}
            </span>
          </span>

          {status && (
            <>
              <Reading label="Tick" value={String(status.tick)} />
              {status.sessionKey && (
                <Reading label="Agent key" value={shortenAddress(status.sessionKey)} />
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={running ? "secondary" : "primary"}
            size="sm"
            onClick={() => void (running ? agent.stop() : agent.start())}
          >
            {running ? "Stop agent" : "Start agent"}
          </Button>
        </div>
      </div>

      <hr className="rule-engraved my-4" />

      {/* Which model is serving, and what it can fall back to.
          Failover is a reliability feature and reads as one — hiding it would only make a mid-demo
          provider switch look like a fault. The serving provider is highlighted; the rest are
          standing by. */}
      {status && status.providers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="legend mr-1 text-placard/45">Model</span>
          {status.providers.map((provider) => {
            const serving = provider === status.lastProvider;
            return (
              <span
                key={provider}
                className={`legend px-3 py-2 ${
                  serving ? "bg-placard text-ink" : "m-well text-placard/50"
                }`}
                title={serving ? "Serving this tick" : "Standing by"}
              >
                {provider}
                {serving && " ·  live"}
              </span>
            );
          })}
          {status.providers.length > 1 && (
            <span className="legend text-placard/35">falls over automatically</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="legend mr-1 text-placard/45">Mode</span>
        {MODES.map((mode) => {
          const active = status?.mode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              title={mode.note}
              aria-pressed={active}
              onClick={() => void agent.setMode(mode.value)}
              className={`legend px-3 py-2 transition-colors ${
                active ? "bg-placard text-ink" : "m-well text-placard/70 hover:text-placard"
              }`}
            >
              {mode.label}
            </button>
          );
        })}
      </div>

      {outOfGas && (
        <p className="legend mt-4 flex items-start gap-2 text-hazard">
          <span className="led led-caution mt-1" aria-hidden="true" />
          <span className="normal-case tracking-normal">
            The agent&apos;s key has no ETH. Payments will fail before policy is ever consulted —
            that is a funding problem, not the contract refusing anything.
          </span>
        </p>
      )}

      {status?.lastError && (
        <p className="legend mt-3 text-estop" role="alert">
          {status.lastError}
        </p>
      )}

      {error && (
        <p className="legend mt-3 text-estop" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="legend text-placard/45">{label}</span>
      <span className="tnum font-mono text-legend text-placard/85">{value}</span>
    </span>
  );
}
