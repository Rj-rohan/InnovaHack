"use client";

import type { LegEvent } from "@/lib/use-agent";
import { formatFixed2, shortenHash } from "@/lib/format";

/**
 * Legs of a multi-leg run, as they land.
 *
 * The whole point of scenario C is *"I can stop this while it is still running — not before it
 * starts, not after it finishes."* That claim is only legible if the freeze has a visible before
 * and after, so this shows each leg's own outcome rather than one status for the run: legs already
 * paid stay paid, the leg in flight is marked, and the ones that never happened are named as such.
 *
 * A leg refused after a freeze and a leg that was never attempted are different facts and get
 * different words.
 */
export function RunProgress({
  legs,
  expected,
  note,
}: {
  legs: LegEvent[];
  /** Total legs the scenario said it would fire. */
  expected: number;
  /** e.g. the session key expiring part-way through scenario F. */
  note?: string | null;
}) {
  const paid = legs.filter((leg) => leg.status === "pending" || leg.status === "confirmed").length;
  const refused = legs.filter((leg) => leg.status === "blocked" || leg.status === "reverted").length;
  const remaining = Math.max(0, expected - legs.length);
  const done = remaining === 0;

  return (
    <div className="m-panel mt-4 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="legend flex items-center gap-2.5 text-placard/80">
          <span
            className={`led ${done ? "led-running" : "led-caution"}`}
            aria-hidden="true"
          />
          {done ? "Run complete" : `Leg ${Math.min(legs.length + 1, expected)} of ${expected}`}
        </p>

        <p className="legend text-placard/50">
          <span style={{ color: "var(--color-running)" }}>{paid} sent</span>
          {" · "}
          <span style={{ color: "var(--color-estop)" }}>{refused} refused</span>
          {" · "}
          {remaining} to go
        </p>
      </div>

      <ol className="mt-4 flex flex-col gap-px" aria-live="polite">
        {Array.from({ length: expected }, (_, index) => {
          const leg = legs.find((l) => l.leg === index);
          return <LegRow key={index} index={index} leg={leg} />;
        })}
      </ol>

      {note && (
        <p className="legend mt-4 flex items-start gap-2 text-hazard">
          <span className="led led-caution mt-1" aria-hidden="true" />
          <span className="normal-case tracking-normal">{note}</span>
        </p>
      )}

      {!done && (
        <p className="measure mt-4 text-body text-placard/60">
          Hold the switch now. Legs already sent stay sent — the rest never happen.
        </p>
      )}
    </div>
  );
}

function LegRow({ index, leg }: { index: number; leg?: LegEvent }) {
  const refused = leg?.status === "blocked" || leg?.status === "reverted";
  const sent = leg?.status === "pending" || leg?.status === "confirmed";

  // Not yet reached. Named rather than left blank: "never happened" is the outcome the freeze
  // produces, and it is the one worth seeing.
  if (!leg) {
    return (
      <li className="m-well flex items-baseline justify-between gap-4 px-4 py-2.5">
        <span className="legend text-placard/35">Leg {index + 1}</span>
        <span className="legend text-placard/35">Not attempted</span>
      </li>
    );
  }

  return (
    <li
      className={`${refused ? "m-placard-blocked" : "m-placard"} flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5`}
    >
      <span className="flex items-baseline gap-3">
        <span className="legend text-ink-soft">Leg {index + 1}</span>
        <span
          className="legend"
          style={{ color: refused ? "var(--color-estop-ink)" : "var(--color-running-ink)" }}
        >
          {refused ? "Refused" : sent ? "Sent" : (leg.status ?? "—")}
        </span>
      </span>

      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {leg.amountUsdc != null && (
          <span className="tnum font-mono text-legend text-ink">
            {formatFixed2(BigInt(Math.round(leg.amountUsdc * 1e6)))}
          </span>
        )}
        {leg.vendor && <span className="text-legend text-ink-soft">{leg.vendor}</span>}
        {leg.txHash && (
          <a
            href={`https://sepolia.etherscan.io/tx/${leg.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-legend text-ink-soft underline decoration-ink-soft/40 underline-offset-2 hover:text-ink"
          >
            {shortenHash(leg.txHash)}
          </a>
        )}
      </span>
    </li>
  );
}
