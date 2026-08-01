"use client";

import { formatFixed6, percentOf } from "@/lib/format";

/**
 * The rolling 24-hour window.
 *
 * A true rolling window, not a calendar day — see `rolling24h()` in AgentWallet.sol. The bar
 * turns hazard yellow at 75% because that is the point where the next ordinary payment is
 * plausibly the one that gets refused, and red once nothing is left.
 */
export function Gauge({
  spent,
  cap,
  paused = false,
  label = "24h window",
}: {
  spent: string;
  cap: string;
  paused?: boolean;
  label?: string;
}) {
  const used = percentOf(spent, cap);
  const exhausted = used >= 100;
  const nearCap = used >= 75;

  const fill = paused || exhausted ? "var(--color-estop)" : nearCap ? "var(--color-hazard)" : "var(--color-running)";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="legend text-placard/70">{label}</p>
        <p className="tnum font-mono text-body">
          <span className={exhausted ? "text-estop" : undefined}>{formatFixed6(spent)}</span>
          <span className="text-placard/45"> / {formatFixed6(cap)}</span>
        </p>
      </div>

      <div
        className="m-well mt-2 h-2.5 w-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(used)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${Math.round(used)} percent of the cap spent`}
      >
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(used, used > 0 ? 1.5 : 0)}%`, backgroundColor: fill }}
        />
      </div>

      <p className="legend mt-1.5 text-placard/45">
        {exhausted ? "Cap reached — the next payment reverts" : `${(100 - used).toFixed(1)}% headroom`}
      </p>
    </div>
  );
}
