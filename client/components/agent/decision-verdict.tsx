"use client";

import type { Decision, TxAttempt } from "@/lib/collections";
import { explainReason, formatFixed2, shortenAddress, shortenHash, timeAgo } from "@/lib/format";

/**
 * The agent's intent, beside the chain's verdict.
 *
 * This is the project's entire argument in one row. The two halves must be visually simultaneous —
 * never stacked on a wide screen — because the point being made is that the verdict did not come
 * from the agent. Read left to right you get: here is what the agent decided to do, and here,
 * independently, is what the contract did about it.
 *
 * `explainReason()` is used verbatim: it already phrases refusals as "Blocked on-chain — …", which
 * puts the *location* of the decision inside the sentence rather than leaving it implied.
 */

export interface Pair {
  key: string;
  decision?: Decision;
  attempt: TxAttempt;
}

/** Join on `runId` + `tick`, which is the key `TxAttempt` already carries for exactly this. */
export function pairDecisions(decisions: Decision[], attempts: TxAttempt[]): Pair[] {
  const byKey = new Map<string, Decision>();
  for (const decision of decisions) byKey.set(`${decision.runId}:${decision.tick}`, decision);

  return attempts.map((attempt, index) => ({
    key: `${attempt.txHash ?? attempt.runId}-${attempt.tick}-${attempt.legIndex}-${index}`,
    decision: byKey.get(`${attempt.runId}:${attempt.tick}`),
    attempt,
  }));
}

export function DecisionVerdictList({
  decisions,
  attempts,
  limit = 6,
  explorerBase = "https://sepolia.etherscan.io",
}: {
  decisions: Decision[];
  attempts: TxAttempt[];
  limit?: number;
  explorerBase?: string;
}) {
  const pairs = pairDecisions(decisions, attempts).slice(0, limit);

  if (pairs.length === 0) {
    return (
      <div className="m-well px-5 py-8 text-center">
        <p className="legend text-placard/60">Nothing to compare yet</p>
        <p className="measure mx-auto mt-2 text-body text-placard/50">
          Each row here puts what the agent decided next to what the contract did about it.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {pairs.map((pair) => (
        <li key={pair.key}>
          <DecisionVerdictRow pair={pair} explorerBase={explorerBase} />
        </li>
      ))}
    </ul>
  );
}

function DecisionVerdictRow({ pair, explorerBase }: { pair: Pair; explorerBase: string }) {
  const { decision, attempt } = pair;
  const refused = attempt.status === "blocked" || attempt.status === "reverted";

  return (
    <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)]">
      {/* --- What the agent meant to do --------------------------------- */}
      <div className="m-placard flex flex-col px-5 py-4">
        <p className="legend text-ink-soft">Agent decided</p>
        <hr className="rule-engraved-light my-3" />

        {decision?.reasoning ? (
          <p className="text-body italic text-ink">&ldquo;{decision.reasoning}&rdquo;</p>
        ) : (
          <p className="text-body text-ink-soft">
            Proposed {formatFixed2(attempt.amount)} to{" "}
            {attempt.vendor ?? shortenAddress(attempt.to)}.
            {/* The model sometimes calls tools without narrating; say so rather than showing a
                blank card that looks like a loading failure. */}
            <span className="text-ink-soft/70"> No narration recorded for this tick.</span>
          </p>
        )}

        <p className="legend mt-auto pt-4 text-ink-soft">
          {decision?.model ?? decision?.provider ?? "agent"}
          {typeof attempt.tick === "number" && ` · tick ${attempt.tick}`}
          {attempt.mode && attempt.mode !== "normal" && (
            <span style={{ color: "var(--color-estop-ink)" }}> · {attempt.mode}</span>
          )}
        </p>
      </div>

      {/* --- The arrow. Hidden on mobile, where the stack already implies order. --- */}
      <div className="hidden items-center justify-center lg:flex" aria-hidden="true">
        <span className="display text-lead text-placard/30">→</span>
      </div>

      {/* --- What the chain did about it -------------------------------- */}
      <div
        className={`${refused ? "m-placard-blocked" : "m-placard"} flex flex-col px-5 py-4`}
      >
        <p className="legend text-ink-soft">Chain ruled</p>
        <hr className="rule-engraved-light my-3" />

        <p
          className="heading text-lead leading-none"
          style={{ color: refused ? "var(--color-estop-ink)" : "var(--color-running-ink)" }}
        >
          {refused ? "Refused" : attempt.status === "pending" ? "Sending" : "Executed"}
        </p>

        {refused && attempt.reason ? (
          <p className="mt-2 text-body text-ink">
            <span className="font-mono">{attempt.reason}</span>
            <span className="block text-ink-soft">{explainReason(String(attempt.reason))}</span>
          </p>
        ) : (
          <p className="mt-2 text-body text-ink-soft">
            {formatFixed2(attempt.amount)} to {attempt.vendor ?? shortenAddress(attempt.to)}
          </p>
        )}

        <p className="legend mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-ink-soft">
          {attempt.blockNumber && <span className="tnum">Block {attempt.blockNumber}</span>}
          {attempt.txHash && (
            <a
              href={`${explorerBase}/tx/${attempt.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono underline decoration-ink-soft/40 underline-offset-2 hover:text-ink"
            >
              {shortenHash(attempt.txHash)} ↗
            </a>
          )}
          <span>{timeAgo(attempt.createdAt)}</span>
        </p>
      </div>
    </div>
  );
}
