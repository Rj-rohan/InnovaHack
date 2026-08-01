"use client";

import type { Decision } from "@/lib/collections";
import type { AgentTick } from "@/lib/use-agent";
import { timeAgo } from "@/lib/format";

/**
 * The agent thinking out loud.
 *
 * The ordered tool calls carry most of the weight here. Seeing
 * `match_purchase_order → check_duplicate → get_vendor_history → hold_for_review` *in that order*
 * is what makes this legible as an agent doing accounts-payable work rather than a random payment
 * generator, so the sequence stays numbered and in order rather than being summarised.
 *
 * Live from the agent's stream when it is up; from persisted `decisions[]` when it is not. The
 * fallback is not a degraded curiosity — it is the normal case during a chain-only demo, and it
 * says so plainly rather than showing an empty panel.
 */

export function LiveTrace({
  ticks,
  decisions,
  online,
  limit = 6,
}: {
  ticks: AgentTick[];
  decisions: Decision[];
  online: boolean | null;
  limit?: number;
}) {
  const live = online === true && ticks.length > 0;

  // Normalise both sources to one shape so the row renderer has a single contract.
  const rows = live
    ? ticks.slice(0, limit).map((tick) => ({
        key: `live-${tick.tick}`,
        tick: tick.tick,
        mode: tick.mode,
        model: tick.provider,
        reasoning: tick.reasoning,
        toolCalls: tick.toolCalls,
        at: tick.at,
        pending: !tick.ended,
      }))
    : decisions.slice(0, limit).map((decision, index) => ({
        key: `${decision.runId}-${decision.tick}-${index}`,
        tick: decision.tick,
        mode: decision.mode,
        model: decision.model ?? decision.provider ?? undefined,
        reasoning: decision.reasoning,
        toolCalls: decision.toolCalls.map((call) => ({
          name: call.name,
          args: call.args,
          result: call.result,
        })),
        at: String(decision.createdAt),
        pending: false,
      }));

  if (rows.length === 0) {
    return (
      <div className="m-well px-5 py-8 text-center">
        <p className="legend text-placard/60">The agent has not run yet</p>
        <p className="measure mx-auto mt-2 text-body text-placard/50">
          Start it above and its reasoning appears here, tick by tick.
        </p>
      </div>
    );
  }

  return (
    <div>
      {!live && (
        <p className="legend mb-3 flex items-center gap-2 text-placard/50">
          <span className="led led-off" aria-hidden="true" />
          Replaying recorded runs — the live feed is unavailable
        </p>
      )}

      <ul className="flex flex-col gap-3" aria-live="polite">
        {rows.map((row) => (
          <li key={row.key} className="m-panel px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="legend text-placard/80">
                Tick {row.tick}
                {row.mode && row.mode !== "normal" && (
                  <span style={{ color: "var(--color-estop)" }}> · {row.mode}</span>
                )}
                {row.pending && <span className="text-hazard"> · running</span>}
              </p>
              <p className="legend text-placard/40">
                {row.model ?? "—"}
                {row.at && ` · ${timeAgo(row.at)}`}
              </p>
            </div>

            {row.reasoning ? (
              <p className="measure mt-3 text-body italic text-placard/85">
                &ldquo;{row.reasoning}&rdquo;
              </p>
            ) : (
              <p className="mt-3 text-body text-placard/40">
                No narration this tick — the tool calls are below.
              </p>
            )}

            {row.toolCalls.length > 0 && (
              <ol className="mt-4 flex flex-col gap-px">
                {row.toolCalls.map((call, index) => (
                  <ToolRow key={`${call.name}-${index}`} index={index} call={call} />
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToolRow({
  index,
  call,
}: {
  index: number;
  call: { name: string; args?: unknown; result?: string };
}) {
  const args = call.args && Object.keys(call.args as object).length > 0 ? call.args : null;

  return (
    <li className="m-well px-3 py-2">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-baseline gap-3">
          <span className="tnum font-mono text-legend text-placard/30">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="font-mono text-legend text-placard/90">{call.name}</span>
          {args && (
            <span className="min-w-0 flex-1 truncate font-mono text-legend text-placard/40">
              {JSON.stringify(args)}
            </span>
          )}
          <span className="legend ml-auto shrink-0 text-placard/30 group-open:hidden">
            {call.result ? "result" : "…"}
          </span>
        </summary>

        {call.result && (
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-legend leading-relaxed text-placard/60">
            {call.result}
          </pre>
        )}
      </details>
    </li>
  );
}
