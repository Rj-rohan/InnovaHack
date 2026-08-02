"use client";

import type { Decision, ReviewItem, TxAttempt } from "@/lib/collections";
import { explainReason, formatFixed2, shortenAddress, shortenHash, timeAgo } from "@/lib/format";

/**
 * The agent's intent, beside the chain's verdict.
 *
 * This is the project's entire argument in one row. The two halves must be visually simultaneous —
 * never stacked on a wide screen — because the point being made is that the verdict did not come
 * from the agent. Read left to right: here is what the agent decided to do, and here,
 * independently, is what the contract did about it.
 *
 * **The join runs decision-first, not attempt-first.** An earlier version mapped over `attempts`,
 * which silently dropped the most interesting ticks of all — the ones where the agent decided
 * *not* to pay. A tick that produced no transaction is still a decision, and on a page arguing
 * about agent behaviour it has to be visible.
 *
 * `explainReason()` is used verbatim: it already phrases refusals as "Blocked on-chain — …", which
 * puts the *location* of the decision inside the sentence rather than leaving it implied.
 */

export interface Pair {
  key: string;
  decision: Decision;
  /** Zero for a held or declined tick; several for a `payBatch`, one per `legIndex`. */
  attempts: TxAttempt[];
  /** Set when the tick ended in a hold rather than a payment. */
  review?: ReviewItem;
}

/**
 * Join on `runId` + `tick` — the key `TxAttempt` already carries for exactly this.
 *
 * One tick maps to zero, one, or many attempts. A `payBatch` tick produces several legs under a
 * single key, distinguished by `legIndex`, and they belong in one row rather than three unrelated
 * ones: the agent made a single decision and the chain ruled on each leg of it.
 */
export function pairDecisions(
  decisions: Decision[],
  attempts: TxAttempt[],
  reviewItems: ReviewItem[] = [],
): Pair[] {
  const attemptsByTick = new Map<string, TxAttempt[]>();
  for (const attempt of attempts) {
    const key = `${attempt.runId}:${attempt.tick}`;
    const list = attemptsByTick.get(key);
    if (list) list.push(attempt);
    else attemptsByTick.set(key, [attempt]);
  }

  // A held invoice is the agent's own decision to defer. Matched by run so a tick with no
  // transaction still says what happened instead of rendering as a blank verdict.
  const reviewByRun = new Map<string, ReviewItem>();
  for (const item of reviewItems) {
    if (!reviewByRun.has(item.runId)) reviewByRun.set(item.runId, item);
  }

  return decisions.map((decision) => {
    const key = `${decision.runId}:${decision.tick}`;
    const legs = (attemptsByTick.get(key) ?? []).sort((a, b) => a.legIndex - b.legIndex);

    return {
      key,
      decision,
      attempts: legs,
      review: legs.length === 0 ? reviewByRun.get(decision.runId) : undefined,
    };
  });
}

export function DecisionVerdictList({
  decisions,
  attempts,
  reviewItems = [],
  limit = 6,
  explorerBase = "https://sepolia.etherscan.io",
}: {
  decisions: Decision[];
  attempts: TxAttempt[];
  reviewItems?: ReviewItem[];
  limit?: number;
  explorerBase?: string;
}) {
  const pairs = pairDecisions(decisions, attempts, reviewItems).slice(0, limit);

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
  const { decision, attempts, review } = pair;

  return (
    <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)]">
      {/* --- What the agent meant to do --------------------------------- */}
      <div className="m-placard flex flex-col px-5 py-4">
        <p className="legend text-ink-soft">Agent decided</p>
        <hr className="rule-engraved-light my-3" />

        {decision.reasoning ? (
          <p className="text-body italic text-ink">&ldquo;{decision.reasoning}&rdquo;</p>
        ) : (
          <p className="text-body text-ink-soft">
            {/* The model sometimes calls tools without narrating; say so rather than showing a
                blank card that looks like a loading failure. */}
            No narration recorded for this tick — {decision.toolCalls.length} tool
            {decision.toolCalls.length === 1 ? "" : "s"} called.
          </p>
        )}

        <p className="legend mt-auto pt-4 text-ink-soft">
          {decision.model ?? decision.provider ?? "agent"} · tick {decision.tick}
          {decision.mode !== "normal" && (
            <span style={{ color: "var(--color-estop-ink)" }}> · {decision.mode}</span>
          )}
        </p>
      </div>

      {/* --- The arrow. Hidden on mobile, where the stack already implies order. --- */}
      <div className="hidden items-center justify-center lg:flex" aria-hidden="true">
        <span className="display text-lead text-placard/30">→</span>
      </div>

      {/* --- What the chain did about it -------------------------------- */}
      {attempts.length === 0 ? (
        <NoAttemptVerdict review={review} createdAt={decision.createdAt} />
      ) : (
        <div className="flex flex-col gap-2">
          {attempts.map((attempt) => (
            <ChainVerdict
              key={`${attempt.txHash ?? "none"}-${attempt.legIndex}`}
              attempt={attempt}
              showLeg={attempts.length > 1}
              explorerBase={explorerBase}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A tick that never reached the chain.
 *
 * Worth its own treatment rather than an empty panel: "the agent chose not to pay" is a different
 * claim from "the contract refused", and collapsing the two would muddy exactly the distinction
 * this component exists to draw.
 */
function NoAttemptVerdict({ review, createdAt }: { review?: ReviewItem; createdAt: Date | string }) {
  return (
    <div className="m-well flex flex-col px-5 py-4">
      <p className="legend text-placard/50">Chain ruled</p>
      <hr className="rule-engraved my-3" />

      <p className="heading text-lead leading-none text-placard/70">Nothing submitted</p>

      <p className="measure mt-2 text-body text-placard/60">
        {review
          ? `The agent held ${review.invoiceId} for review rather than paying it.`
          : "The agent decided against a payment this tick."}
      </p>

      {review && (
        <p className="mt-2 text-body italic text-placard/50">&ldquo;{review.reason}&rdquo;</p>
      )}

      <p className="legend mt-auto pt-4 text-placard/40">
        {/* The distinction the standing framing note insists on. */}
        A soft control — the agent&apos;s own caution, not the contract&apos;s ·{" "}
        {timeAgo(createdAt)}
      </p>
    </div>
  );
}

function ChainVerdict({
  attempt,
  showLeg,
  explorerBase,
}: {
  attempt: TxAttempt;
  showLeg: boolean;
  explorerBase: string;
}) {
  const refused = attempt.status === "blocked" || attempt.status === "reverted";

  return (
    <div className={`${refused ? "m-placard-blocked" : "m-placard"} flex flex-1 flex-col px-5 py-4`}>
      <p className="legend flex items-center justify-between gap-3 text-ink-soft">
        <span>Chain ruled</span>
        {showLeg && <span>Leg {attempt.legIndex + 1}</span>}
      </p>
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
  );
}
