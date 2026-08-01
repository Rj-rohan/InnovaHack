"use client";

import { Shell } from "@/components/layout";
import { ScrollStage } from "@/components/scroll-stage";

/**
 * T3 showpiece — the inspection lamp.
 *
 * An engineer's torch swept across a dark cabinet, which is the industrial reading of a spotlight
 * mask rather than the generic dark-mode one. The lamp finds the contract-storage panel first and
 * lingers there; the prompt panel stays at the edge of the beam longest. The mask is making the
 * argument, not decorating it.
 *
 * The cover is a separate absolutely-positioned layer, so with JS off it is simply never darkened
 * and both panels read normally.
 */
export function SpotlightContrast() {
  return (
    <ScrollStage
      end="+=170%"
      className="relative border-t border-black/40 bg-enamel-lo"
      build={(tl, { q }) => {
        const cover = q("[data-cover]")[0];
        if (!cover) return;

        // `--spot` is the radius of the hole. Closed to nothing, then swept wide open. The centre
        // sits over the contract-storage panel, so the lamp finds it first and the prompt panel
        // stays at the edge of the beam longest.
        tl.fromTo(
          cover,
          { "--spot": "0%" },
          { "--spot": "150%", ease: "power1.inOut", duration: 1 },
        );
      }}
    >
      <div className="relative flex min-h-svh flex-col justify-center py-20 lg:py-24">
        <Shell>
          <p className="legend text-placard/55">The whole argument</p>
          <h2 className="heading mt-3 max-w-[20ch] text-panel text-placard">
            The difference is where the rule is written
          </h2>
        </Shell>

        <Shell className="mt-12">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="m-well h-full px-7 py-8">
              <p className="legend text-placard/45">In the prompt</p>
              <p className="mt-5 font-mono text-body leading-relaxed text-placard/35 line-through decoration-estop/70 decoration-2">
                You may spend up to 40 mUSDC per payment. Only pay approved vendors. Stop if the
                owner asks you to.
              </p>
              <hr className="rule-engraved my-7" />
              <p className="measure text-body text-placard/60">
                A rule the agent has to choose to follow. Prompt injection, a bad tool response or
                an ordinary reasoning slip all route around it, and nothing on chain notices.
              </p>
            </div>

            <div className="m-panel h-full px-7 py-8">
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
      </div>

      {/* The cover. Rests fully open (see `--spot`'s initial value), and never eats a click even
          mid-sweep. */}
      <div
        data-cover
        aria-hidden="true"
        className="spotlight-cover pointer-events-none absolute inset-0 z-20"
      />
    </ScrollStage>
  );
}
