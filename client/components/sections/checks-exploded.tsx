"use client";

import { Shell } from "@/components/layout";
import { ScrollStage } from "@/components/scroll-stage";

/**
 * T3 showpiece — the exploded assembly.
 *
 * `_check()` genuinely is a stack of six plates a payment falls through in order, so the exploded
 * view is not decoration here: it is the mechanism drawn accurately. The plates fan apart, a
 * payment descends through them, plate 3 refuses it, and the plates lock into the ordered list
 * that stays on screen.
 *
 * Resting state is that list, with the refusal already marked. Nothing here is reachable only
 * mid-animation.
 */

type Check = {
  check: string;
  error: string;
  detail: string;
  /** The one the worked example stops at. Exactly one entry carries this. */
  blocks?: boolean;
};

const CHECKS: Check[] = [
  {
    check: "Is the wallet frozen?",
    error: "WalletPaused",
    detail:
      "The owner's kill switch, read before anything else — and re-read before every leg of a batch, so a freeze lands between two payments of a run already underway.",
  },
  {
    check: "Is the agent's session key live?",
    error: "SessionInvalid",
    detail:
      "The agent holds a revocable session key, never the owner key. Revoking stops it at the next leg.",
  },
  {
    check: "Is the recipient allowlisted?",
    error: "CounterpartyNotAllowed",
    detail:
      "Payable only when the address carries a category tag and that whole category is enabled.",
    blocks: true,
  },
  {
    check: "Is it within the per-transaction cap?",
    error: "SpendLimitExceeded",
    detail: "Scaled live by the throttle, so the agent can be cut to 1% without being frozen.",
  },
  {
    check: "Is it within the rolling 24-hour cap?",
    error: "RollingLimitExceeded",
    detail:
      "A true trailing window, not a calendar day that resets at midnight and grants two allowances an hour apart.",
  },
  {
    check: "Is there a balance to pay it from?",
    error: "InsufficientBalance",
    detail: "Last, because it is the only one of the six that is not a policy decision.",
  },
];

export function ChecksExploded() {
  return (
    <ScrollStage
      id="checks"
      // Not pinned, deliberately. Pinning makes a section `position: fixed`, which puts it in the
      // same screen space as its neighbours and loses the paint-order fight with the orbit
      // diagram's absolutely-positioned rings further down the page — the two sections render on
      // top of each other. The scrub survives without the pin; only the hold is given up.
      pin={false}
      start="top 78%"
      end="top 18%"
      className="border-t border-black/40"
      build={(tl, { q }) => {
        const rows = q("[data-plate]");
        const token = q("[data-token]")[0];
        const verdict = q("[data-verdict]")[0];

        // 1. Plates fan in from an exploded arrangement and lock into the list.
        tl.from(rows, {
          yPercent: (i: number) => (i - 2.5) * 26,
          xPercent: (i: number) => (i % 2 === 0 ? -14 : 14),
          rotateX: -32,
          scale: 0.86,
          opacity: 0,
          stagger: 0.06,
          ease: "power2.out",
          duration: 1.1,
        });

        // 2. The payment descends the rail and halts at plate 3.
        if (token) {
          tl.from(
            token,
            {
              y: () => {
                const first = rows[0] as HTMLElement;
                const stop = token.closest("[data-plate]") as HTMLElement | null;
                if (!first || !stop) return -160;
                return first.offsetTop - stop.offsetTop;
              },
              ease: "none",
              duration: 0.8,
            },
            ">-0.15",
          );
        }

        // 3. The refusal lands.
        if (verdict) {
          tl.from(verdict, { opacity: 0, scale: 0.94, duration: 0.25, ease: "power2.out" }, "<0.55");
        }
      }}
    >
      <div className="flex flex-col justify-center py-20 lg:py-28">
        <Shell>
          <p className="legend text-placard/55">Evaluated in this order, every time</p>
          <h2 className="heading mt-3 max-w-[22ch] text-panel text-placard">
            Six questions the contract asks before it moves a cent
          </h2>
          <p className="measure mt-4 text-body text-placard/65">
            The order is not presentation. It is the order{" "}
            <span className="font-mono text-placard/85">_check()</span> runs in — cheapest and most
            severe first — so when a payment breaks several rules at once, the reason you see is the
            highest one here.
          </p>

          {/* `perspective` on the container is what makes the fan-in read as depth rather than
              as a flat slide. */}
          <ol className="mt-10 perspective-[1400px]">
            {CHECKS.map((rule, index) => (
              <li
                key={rule.error}
                data-plate
                className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-5 gap-y-2 border-t border-black/35 py-5 lg:grid-cols-[2.75rem_minmax(0,1fr)_minmax(0,1.1fr)_15rem]"
              >
                <span className="relative">
                  <span className="display text-lead leading-none text-placard/30" aria-hidden="true">
                    {index + 1}
                  </span>

                  {/* The payment. Lives inside the plate that stops it, so its resting position
                      is correct with no JS. */}
                  {rule.blocks && (
                    <span
                      data-token
                      className="absolute -left-1 top-8 flex h-6 w-6 items-center justify-center rounded-full lg:-left-2"
                      style={{ backgroundColor: "var(--color-estop)" }}
                      aria-hidden="true"
                    >
                      <span className="block h-2 w-2 rounded-full bg-placard/90" />
                    </span>
                  )}
                </span>

                <h3 className="text-lead text-placard">{rule.check}</h3>

                <p className="col-start-2 text-body text-placard/60 lg:col-start-3">
                  {rule.detail}
                </p>

                <div className="col-start-2 lg:col-start-4 lg:text-right">
                  <p className="font-mono text-legend text-estop">{rule.error}</p>
                  {rule.blocks && (
                    <p
                      data-verdict
                      className="legend mt-1.5 inline-block px-2 py-1 text-ink"
                      style={{ backgroundColor: "var(--color-estop)", color: "#fff" }}
                    >
                      80.000000 refused here
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Shell>
      </div>
    </ScrollStage>
  );
}
