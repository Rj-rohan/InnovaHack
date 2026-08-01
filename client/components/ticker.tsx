"use client";

import type { TxAttempt } from "@/lib/collections";
import { explainReason, formatFixed2, shortenAddress, shortenHash, timeAgo } from "@/lib/format";

/**
 * Payment attempts, on the placard.
 *
 * Blocked rows keep the contract's own word for the refusal — `CounterpartyNotAllowed`, not
 * "payment failed". That vocabulary is the same one the contract emits, the console filters on,
 * and the explainer teaches, so a judge can follow one term from the source to the screen.
 *
 * Colour is never the only signal: every row states its outcome in words.
 */

const STATUS: Record<TxAttempt["status"], { label: string; tone: string; marker: string }> = {
  confirmed: { label: "Paid", tone: "var(--color-running-ink)", marker: "var(--color-running)" },
  blocked: { label: "Blocked", tone: "var(--color-estop-ink)", marker: "var(--color-estop)" },
  reverted: { label: "Reverted", tone: "var(--color-estop-ink)", marker: "var(--color-estop)" },
  pending: { label: "Sending", tone: "var(--color-ink-soft)", marker: "var(--color-hazard)" },
};

export function Ticker({
  attempts,
  limit = 6,
  emptyHint,
}: {
  attempts: TxAttempt[];
  limit?: number;
  emptyHint?: React.ReactNode;
}) {
  const rows = attempts.slice(0, limit);

  if (rows.length === 0) {
    return (
      <div className="m-placard px-4 py-6 text-center">
        <p className="legend text-ink-soft">No payments yet</p>
        <p className="mt-1.5 text-body text-ink-soft">
          {emptyHint ?? "The agent hasn't run since the last deploy."}
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-px" aria-live="polite" aria-label="Recent payment attempts">
      {rows.map((row, index) => {
        const status = STATUS[row.status];
        const blocked = row.status === "blocked" || row.status === "reverted";

        return (
          <li
            key={`${row.txHash ?? row.runId}-${row.tick}-${row.legIndex}-${index}`}
            className={blocked ? "m-placard-blocked px-3 py-2.5" : "m-placard px-3 py-2.5"}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="flex items-center gap-2" style={{ color: status.tone }}>
                <span
                  className="led"
                  style={{ backgroundColor: status.marker, width: "0.4rem", height: "0.4rem" }}
                  aria-hidden="true"
                />
                <span className="legend">{status.label}</span>
              </span>

              <span className="tnum font-mono text-body font-medium">{formatFixed2(row.amount)}</span>

              <span className="min-w-0 flex-1 truncate text-body">
                {row.vendor ?? <span className="font-mono">{shortenAddress(row.to)}</span>}
              </span>

              {row.txHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${row.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-legend text-ink-soft underline decoration-ink-soft/40 underline-offset-2 hover:text-ink"
                >
                  {shortenHash(row.txHash)}
                </a>
              )}
            </div>

            {blocked && row.reason && (
              <p className="mt-1 text-legend" style={{ color: "var(--color-estop-ink)" }}>
                <span className="font-mono">{row.reason}</span>
                <span className="text-ink-soft"> — {explainReason(String(row.reason))}</span>
              </p>
            )}

            {row.legIndex > 0 && (
              <p className="legend mt-1 text-ink-soft">Leg {row.legIndex} of a batch</p>
            )}

            <p className="sr-only">{timeAgo(row.createdAt)}</p>
          </li>
        );
      })}
    </ul>
  );
}
