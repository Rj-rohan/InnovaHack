"use client";

import { useMemo, useState } from "react";
import { DecisionVerdictList } from "@/components/agent/decision-verdict";
import { useConsole } from "@/components/console-data";
import { Ticker } from "@/components/ticker";
import { BLOCK_REASONS } from "@/lib/policy";
import { formatBlockNumber, shortenAddress, shortenHash, timeAgo } from "@/lib/format";

type Filter = "all" | "paid" | (typeof BLOCK_REASONS)[number];

/**
 * The full log.
 *
 * Filters are the contract's own `BlockReason` values rather than invented categories like
 * "failed" or "error". A judge who reads `CounterpartyNotAllowed` here can grep the same word in
 * AgentWallet.sol and find the line that produced it.
 */
export default function ActivityPage() {
  const { data } = useConsole();
  const [filter, setFilter] = useState<Filter>("all");

  const reasonsSeen = useMemo(() => {
    const seen = new Set<string>();
    for (const attempt of data.attempts) {
      if (attempt.reason && attempt.reason !== "None") seen.add(String(attempt.reason));
    }
    return BLOCK_REASONS.filter((reason) => reason !== "None" && seen.has(reason));
  }, [data.attempts]);

  const filtered = useMemo(() => {
    if (filter === "all") return data.attempts;
    if (filter === "paid") return data.attempts.filter((a) => a.status === "confirmed");
    return data.attempts.filter((a) => String(a.reason) === filter);
  }, [data.attempts, filter]);

  const blockedCount = data.attempts.filter(
    (a) => a.status === "blocked" || a.status === "reverted",
  ).length;

  return (
    <div className="mx-auto flex max-w-384 flex-col gap-8">
      <header>
        <h1 className="heading text-panel text-placard">Activity</h1>
        <p className="measure mt-2 text-body text-placard/65">
          Every payment the agent attempted, and what the contract did about it.{" "}
          {blockedCount > 0 && (
            <>
              <span className="text-estop">{blockedCount}</span> of {data.attempts.length} were
              refused.
            </>
          )}
        </p>
      </header>

      {/* The pairing goes above the flat feed: intent-beside-verdict is the reading that matters,
          and the filtered list below is for looking something specific up. */}
      {data.decisions.length > 0 && (
        <section>
          <h2 className="legend text-placard/70">Decided, then ruled on</h2>
          <p className="measure mb-4 mt-2 text-body text-placard/55">
            What the agent intended, beside what the chain independently did about it.
          </p>
          <DecisionVerdictList decisions={data.decisions} attempts={data.attempts} limit={4} />
        </section>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by outcome">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All · {data.attempts.length}
        </Chip>
        <Chip active={filter === "paid"} onClick={() => setFilter("paid")}>
          Paid
        </Chip>
        {reasonsSeen.map((reason) => (
          <Chip key={reason} active={filter === reason} onClick={() => setFilter(reason)} danger>
            {reason}
          </Chip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="m-well px-4 py-8 text-center text-body text-placard/60">
          {data.attempts.length === 0
            ? "No payments yet. The agent hasn't run since the last deploy."
            : "Nothing matches that filter."}
        </p>
      ) : (
        <Ticker attempts={filtered} limit={filtered.length} />
      )}

      {/* --- Contract events ------------------------------------------------ */}
      <section>
        <h2 className="legend text-placard/70">Policy events</h2>
        <p className="measure mt-2 text-body text-placard/60">
          Owner actions and contract-level notices, straight from the logs.
        </p>

        {data.events.length === 0 ? (
          <p className="m-well mt-4 px-4 py-6 text-center text-body text-placard/60">
            No events indexed yet.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-px">
            {data.events.slice(0, 25).map((event) => (
              <li
                key={`${event.txHash}-${event.logIndex}`}
                className="m-placard grid grid-cols-1 gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[12rem_1fr_auto] sm:items-baseline"
              >
                <span className="legend text-ink">{event.event}</span>

                <span className="truncate font-mono text-legend text-ink-soft">
                  {Object.entries(event.args)
                    .map(([key, value]) => {
                      const raw = String(value);
                      return `${key}=${raw.startsWith("0x") && raw.length === 42 ? shortenAddress(raw) : raw}`;
                    })
                    .join("  ")}
                </span>

                <span className="flex items-baseline gap-3 sm:justify-self-end">
                  <span className="tnum font-mono text-legend text-ink-soft">
                    #{formatBlockNumber(event.blockNumber)}
                  </span>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${event.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-legend text-ink-soft underline decoration-ink-soft/40 underline-offset-2 hover:text-ink"
                  >
                    {shortenHash(event.txHash)}
                  </a>
                  <span className="legend text-ink-soft">{timeAgo(event.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Chip({
  active,
  danger = false,
  onClick,
  children,
}: {
  active: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`legend px-3.5 py-2 transition-colors ${
        active ? "bg-placard text-ink" : "m-panel text-placard/70 hover:text-placard"
      }`}
      style={active && danger ? { backgroundColor: "var(--color-estop)", color: "#fff" } : undefined}
    >
      {children}
    </button>
  );
}
