"use client";

import Link from "next/link";
import { useConsole } from "@/components/console-data";
import { Shell } from "@/components/layout";
import { ScrollStage } from "@/components/scroll-stage";
import { explainReason, formatFixed6, shortenAddress } from "@/lib/format";

/**
 * T2 — the live rail.
 *
 * Full bleed, because a ledger that runs off both edges reads as ongoing rather than as a list
 * that happens to have four items in it. Drifts sideways with scroll: continuous and cheap, the
 * breather between the hero's entry sequence and the first showpiece.
 *
 * Real attempts off the chain. When there are none it says so rather than inventing rows — a fake
 * ticker on a page arguing for verifiable enforcement would be a strange thing to ship.
 */
export function PaymentsRail() {
  const { data } = useConsole();
  const rows = data.attempts.slice(0, 10);

  return (
    <ScrollStage
      pin={false}
      start="top bottom"
      end="bottom top"
      scrub={1}
      className="overflow-hidden border-t border-black/40 py-16 lg:py-20"
      build={(tl, { q }) => {
        // Against the scroll direction, and only a little: this is texture, not a carousel.
        tl.fromTo(q("[data-rail]"), { xPercent: 4 }, { xPercent: -10, ease: "none" });
      }}
    >
      <Shell className="flex items-baseline justify-between gap-4 pb-6">
        <p className="legend text-placard/70">Live payments</p>
        <Link
          href="/console/activity"
          className="legend text-placard/50 underline decoration-placard/25 underline-offset-4 transition-colors hover:text-placard"
        >
          Full log
        </Link>
      </Shell>

      {rows.length === 0 ? (
        <Shell>
          <p className="m-well px-5 py-8 text-center text-body text-placard/60">
            No payments yet. Start the agent and this fills from the chain.
          </p>
        </Shell>
      ) : (
        <div
          data-rail
          className="flex w-max gap-3 px-6 sm:px-10 xl:px-16"
          // Fades the rail into the gutters so it reads as continuing past the frame.
          style={{
            maskImage:
              "linear-gradient(90deg, transparent 0, #000 6%, #000 94%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(90deg, transparent 0, #000 6%, #000 94%, transparent 100%)",
          }}
        >
          {rows.map((row, index) => {
            const blocked = row.status === "blocked" || row.status === "reverted";
            return (
              <article
                key={`${row.txHash ?? row.runId}-${row.tick}-${row.legIndex}-${index}`}
                className={`${blocked ? "m-placard-blocked" : "m-placard"} w-72 shrink-0 px-4 py-3.5`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="legend"
                    style={{
                      color: blocked ? "var(--color-estop-ink)" : "var(--color-running-ink)",
                    }}
                  >
                    {blocked ? "Blocked" : row.status === "pending" ? "Sending" : "Paid"}
                  </span>
                  <span className="tnum font-mono text-body font-medium">
                    {formatFixed6(row.amount)}
                  </span>
                </div>

                <p className="mt-1.5 truncate text-body">
                  {row.vendor ?? <span className="font-mono">{shortenAddress(row.to)}</span>}
                </p>

                {blocked && row.reason && (
                  <p
                    className="mt-1.5 truncate font-mono text-legend"
                    style={{ color: "var(--color-estop-ink)" }}
                    title={explainReason(String(row.reason))}
                  >
                    {row.reason}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </ScrollStage>
  );
}
