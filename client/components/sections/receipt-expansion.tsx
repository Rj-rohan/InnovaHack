"use client";

import { Shell } from "@/components/layout";
import { SectionHeader } from "@/components/section-header";
import { ScrollStage } from "@/components/scroll-stage";

/**
 * T2 — the receipts open out.
 *
 * Not pinned. The pair starts small and centred and grows to the full frame as it scrolls in, so
 * the `leg 1 PaymentBlocked Paused` line ends up large enough to read from across a room. The
 * resting state is the full-size pair; the scrub only animates *to* it.
 */
export function ReceiptExpansion() {
  return (
    <ScrollStage
      pin={false}
      start="top 90%"
      end="top 30%"
      className="border-t border-black/40 py-20 lg:py-28"
      build={(tl, { q }) => {
        tl.from(q("[data-receipts]"), {
          scale: 0.74,
          opacity: 0.35,
          yPercent: 6,
          ease: "power2.out",
        });
      }}
    >
      <Shell>
        <SectionHeader
          eyebrow="Why a frozen batch is visible at all"
          title="One path reverts. One path reports."
          lede="A revert emits nothing. If a multi-step run were simply reverted, the blocked leg would leave no trace and nobody reading the logs could prove the freeze worked. So batches stop and say so instead."
        />
      </Shell>

      <div data-receipts className="mt-12 origin-top">
        <Shell>
          <div className="grid gap-6 lg:grid-cols-2">
            <Receipt
              label="pay() — a single payment"
              note="The hard guarantee: a violating payment has no effect on chain, full stop."
              lines={[
                "tx 0x7f2c…9a1   REVERTED",
                "  SpendLimitExceeded(80000000, 40000000)",
                "",
                "state unchanged — nothing moved",
              ]}
            />
            <Receipt
              label="payBatch() — a run of payments"
              note="Policy is re-checked before every leg. The owner froze the wallet between leg 0 and leg 1, and the receipt says so."
              lines={[
                "tx 0x91c4…7f2   SUCCESS",
                "  leg 0  PaymentExecuted  38.000000",
                "  leg 1  PaymentBlocked   Paused",
                "  leg 2  not attempted",
              ]}
              highlight
            />
          </div>
        </Shell>
      </div>
    </ScrollStage>
  );
}

function Receipt({
  label,
  lines,
  note,
  highlight = false,
}: {
  label: string;
  lines: string[];
  note: string;
  highlight?: boolean;
}) {
  return (
    <div className={highlight ? "m-placard-blocked px-6 py-6" : "m-placard px-6 py-6"}>
      <p className="legend text-ink-soft">{label}</p>
      <hr className="rule-engraved-light my-4" />
      <pre className="overflow-x-auto font-mono text-body leading-relaxed text-ink">
        {lines.join("\n")}
      </pre>
      <p className="measure mt-5 text-body text-ink-soft">{note}</p>
    </div>
  );
}
