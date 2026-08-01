"use client";

import { Shell } from "@/components/layout";
import { SectionHeader } from "@/components/section-header";
import { ScrollStage } from "@/components/scroll-stage";

/**
 * The page's closing argument: prompt versus contract storage.
 *
 * The two panels converge from opposite sides as the section scrolls up. Deliberately *not* a
 * reveal — nothing is hidden and then uncovered. Both halves are fully legible from the moment
 * they enter, and the motion is pure displacement: the comparison is the point, so the reader
 * should be able to make it at any scroll position, including a deep link landing mid-section.
 *
 * (This replaced a spotlight-mask reveal that covered the section in black until you scrolled it
 * open. Good effect, wrong section — it withheld the one comparison the page is built around.)
 */
export function StorageContrast() {
  return (
    <ScrollStage
      pin={false}
      start="top 85%"
      end="center 55%"
      className="border-t border-black/40 bg-enamel-lo py-20 lg:py-28"
      build={(tl, { q }) => {
        // Opacity is untouched on purpose. Transform only, so nothing is ever unreadable.
        tl.from(q("[data-panel='prompt']"), { xPercent: -9, ease: "power2.out" }, 0).from(
          q("[data-panel='storage']"),
          { xPercent: 9, ease: "power2.out" },
          0,
        );
      }}
    >
      <Shell>
        <SectionHeader
          eyebrow="The whole argument"
          title="The difference is where the rule is written"
          lede="One of these is a rule the agent has to choose to follow. The other is a rule it cannot reach. Only the second survives the agent being compromised."
        />
      </Shell>

      <Shell className="mt-12">
        <div className="grid gap-6 lg:grid-cols-2">
          <div data-panel="prompt" className="m-well h-full px-7 py-8">
            <p className="legend text-placard/45">In the prompt</p>
            <p className="mt-5 font-mono text-body leading-relaxed text-placard/35 line-through decoration-estop/70 decoration-2">
              You may spend up to 40 mUSDC per payment. Only pay approved vendors. Stop if the
              owner asks you to.
            </p>
            <hr className="rule-engraved my-7" />
            <p className="measure text-body text-placard/60">
              A rule the agent has to choose to follow. Prompt injection, a bad tool response or an
              ordinary reasoning slip all route around it, and nothing on chain notices.
            </p>
          </div>

          <div data-panel="storage" className="m-panel h-full px-7 py-8">
            <p className="legend text-hazard">In contract storage</p>
            <p className="mt-5 font-mono text-body leading-relaxed text-placard/90">
              if (amount &gt; txCap)
              <br />
              &nbsp;&nbsp;return (BlockReason.PerTxCapExceeded, txCap);
            </p>
            <hr className="rule-engraved my-7" />
            <p className="measure text-body text-placard/70">
              A rule the agent cannot reach. The check runs at execution time, in the same
              transaction, against storage the agent has no authority to write. Being compromised
              does not help it.
            </p>
          </div>
        </div>
      </Shell>
    </ScrollStage>
  );
}
