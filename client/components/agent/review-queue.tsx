"use client";

import { useState } from "react";
import type { ReviewItem } from "@/lib/collections";
import type { AgentControls } from "@/lib/use-agent";
import { Button } from "@/components/ui/button";
import { formatFixed2, shortenAddress, timeAgo } from "@/lib/format";

/**
 * Invoices the agent declined to pay and referred to a human.
 *
 * **This is a soft control and must never be presented as anything else.** It is the agent
 * choosing to defer — a compromised agent simply would not use it. The contract is the hard
 * control. Hence the recessed `m-well` material rather than the raised `m-panel` used for policy
 * controls, and the caption below: if a judge leaves believing the agent's own caution is what
 * protects the money, the demo has failed.
 *
 * A human approving something does not override the contract either. An approved invoice can
 * still be refused on-chain for exceeding a cap, and that is correct.
 */
export function ReviewQueue({
  items,
  agent,
  onResolved,
}: {
  items: ReviewItem[];
  agent: AgentControls;
  onResolved?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const pending = items.filter((item) => item.status === "pending");
  const settled = items.filter((item) => item.status !== "pending");

  async function resolve(invoiceId: string, approve: boolean) {
    setBusy(invoiceId);
    setFailure(null);
    const ok = approve ? await agent.approve(invoiceId) : await agent.reject(invoiceId);
    setBusy(null);

    if (ok) {
      onResolved?.();
      return;
    }

    // The queue lives in the agent process; these rows are read from the database. After the
    // agent restarts the two disagree, and the button silently doing nothing is the worst
    // possible version of that. Say what happened.
    setFailure(
      agent.error ??
        "The agent did not accept that decision. Its queue may be from an earlier run.",
    );
  }

  return (
    <div>
      <div className="m-well px-5 py-4">
        <p className="legend text-placard/70">A soft control</p>
        <p className="measure mt-2 text-body text-placard/65">
          This is the agent asking for help, not the thing that stops a payment. A compromised
          agent would simply not use it. The contract is what actually refuses —{" "}
          <span className="text-placard">approving something here does not override a cap</span>,
          and an approved invoice can still be turned down on-chain.
        </p>
      </div>

      {failure && (
        <p
          role="alert"
          className="m-placard-blocked mt-4 px-5 py-3 text-body"
        >
          {failure}
        </p>
      )}

      {items.length === 0 ? (
        <p className="m-well mt-4 px-5 py-8 text-center text-body text-placard/55">
          Nothing has been referred for review.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-px">
          {[...pending, ...settled].map((item) => {
            const isPending = item.status === "pending";
            const working = busy === item.invoiceId;

            return (
              <li key={item.invoiceId} className="m-placard px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-mono text-legend text-ink-soft">{item.invoiceId}</p>
                  <p className="tnum font-mono text-body font-medium text-ink">
                    {formatFixed2(item.amount)}
                  </p>
                </div>

                <p className="mt-1.5 text-body text-ink">
                  {item.vendor}{" "}
                  <span className="font-mono text-ink-soft">{shortenAddress(item.address)}</span>
                </p>

                <p className="measure mt-2 text-body italic text-ink-soft">
                  &ldquo;{item.reason}&rdquo;
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {isPending ? (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={working || agent.online !== true}
                        onClick={() => void resolve(item.invoiceId, true)}
                      >
                        {working ? "Sending…" : "Approve"}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        className="!text-ink"
                        disabled={working || agent.online !== true}
                        onClick={() => void resolve(item.invoiceId, false)}
                      >
                        Reject
                      </Button>
                      {agent.online !== true && (
                        <span className="legend text-ink-soft">
                          Needs the agent — decisions go to it, not the database
                        </span>
                      )}
                    </>
                  ) : (
                    <span
                      className="legend"
                      style={{
                        color:
                          item.status === "approved"
                            ? "var(--color-running-ink)"
                            : "var(--color-estop-ink)",
                      }}
                    >
                      {item.status} · {timeAgo(item.updatedAt)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
