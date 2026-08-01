import type { Metadata } from "next";
import Link from "next/link";
import { Hero } from "@/components/hero";
import { Reveal } from "@/components/reveal";
import { OrbitingStack } from "@/components/ui/orbiting-circles";

export const metadata: Metadata = {
  description:
    "A policy-enforcing wallet for autonomous AI agents. Spend caps, an allowlist and the freeze all live in contract storage — so a compromised agent cannot spend its way around them.",
};

/**
 * The six checks, in the order `_check()` actually runs them in AgentWallet.sol.
 *
 * These are numbered because the order carries information: the checks run cheapest-and-most-
 * severe first, so when a payment would break several rules at once, the one reported is the one
 * highest in this list. Nothing else on the page is numbered.
 */
const RULES = [
  {
    check: "Is the wallet frozen?",
    error: "WalletPaused",
    detail:
      "The owner's kill switch, checked before anything else. Re-read before every leg of a batch, so a freeze lands between two payments of a run already underway.",
  },
  {
    check: "Is the agent's session key live?",
    error: "SessionInvalid",
    detail:
      "The agent holds a revocable session key, never the owner key. Revoking it stops the agent at its next payment, including mid-batch.",
  },
  {
    check: "Is the recipient allowlisted?",
    error: "CounterpartyNotAllowed",
    detail:
      "An address is payable only when it carries a category tag and that whole category is enabled. Turning off 'vendor' stops every vendor in one transaction.",
  },
  {
    check: "Is it within the per-transaction cap?",
    error: "SpendLimitExceeded",
    detail:
      "Scaled live by the throttle, so the owner can drop the agent to 1% of its allowance without freezing it outright.",
  },
  {
    check: "Is it within the rolling 24-hour cap?",
    error: "RollingLimitExceeded",
    detail:
      "A true trailing window, not a calendar day that resets at midnight and lets an agent spend two full allowances an hour apart.",
  },
  {
    check: "Is there a balance to pay it from?",
    error: "InsufficientBalance",
    detail: "Last, because it is the only one of the six that is not a policy decision.",
  },
];

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />

      {/* ---------------------------------------------------------------- */}
      {/* The rules                                                         */}
      {/* ---------------------------------------------------------------- */}
      <section className="border-t border-black/40 px-6 py-20 sm:px-10 lg:py-28">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <p className="legend text-placard/55">Evaluated in this order, every time</p>
            <h2 className="heading mt-3 max-w-2xl text-panel text-placard">
              Six questions the contract asks before it moves a cent
            </h2>
            <p className="mt-4 max-w-xl text-body text-placard/65">
              The order is not presentation. It is the order{" "}
              <span className="font-mono text-placard/85">_check()</span> runs in — cheapest and
              most severe first — so when a payment breaks several rules at once, the reason you
              see is the highest one here.
            </p>
          </Reveal>

          <ol className="mt-12 flex flex-col">
            {RULES.map((rule, index) => (
              <Reveal key={rule.error} delay={index * 60}>
                <li className="grid grid-cols-[2.5rem_1fr] gap-x-4 gap-y-2 border-t border-black/35 py-6 sm:grid-cols-[3rem_1fr_16rem] sm:gap-x-8">
                  <span
                    className="display text-lead leading-none text-placard/30"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>

                  <div>
                    <h3 className="text-lead text-placard">{rule.check}</h3>
                    <p className="mt-2 max-w-lg text-body text-placard/60">{rule.detail}</p>
                  </div>

                  <p className="col-start-2 font-mono text-legend text-estop sm:col-start-3 sm:text-right">
                    {rule.error}
                  </p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Where enforcement lives                                           */}
      {/* ---------------------------------------------------------------- */}
      <section className="border-t border-black/40 bg-enamel-lo px-6 py-20 sm:px-10 lg:py-28">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className="heading max-w-2xl text-panel text-placard">
              The difference is where the rule is written
            </h2>
          </Reveal>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <Reveal>
              <div className="m-well h-full px-6 py-7">
                <p className="legend text-placard/45">In the prompt</p>
                <p className="mt-4 font-mono text-body leading-relaxed text-placard/35 line-through decoration-estop/70 decoration-2">
                  You may spend up to 40 mUSDC per payment. Only pay approved vendors. Stop if the
                  owner asks you to.
                </p>
                <hr className="rule-engraved my-6" />
                <p className="text-body text-placard/60">
                  A rule the agent has to choose to follow. Prompt injection, a bad tool response
                  or an ordinary reasoning slip all route around it, and nothing on chain notices.
                </p>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <div className="m-panel h-full px-6 py-7">
                <p className="legend text-hazard">In contract storage</p>
                <p className="mt-4 font-mono text-body leading-relaxed text-placard/90">
                  if (amount &gt; txCap)
                  <br />
                  &nbsp;&nbsp;return (BlockReason.PerTxCapExceeded, txCap);
                </p>
                <hr className="rule-engraved my-6" />
                <p className="text-body text-placard/70">
                  A rule the agent cannot reach. The check runs at execution time, in the same
                  transaction, against storage the agent has no authority to write. Being
                  compromised does not help it.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Two failure styles                                                */}
      {/* ---------------------------------------------------------------- */}
      <section className="border-t border-black/40 px-6 py-20 sm:px-10 lg:py-28">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <p className="legend text-placard/55">Why a frozen batch is visible at all</p>
            <h2 className="heading mt-3 max-w-2xl text-panel text-placard">
              One path reverts. One path reports.
            </h2>
            <p className="mt-4 max-w-xl text-body text-placard/65">
              A revert emits nothing. If a multi-step run were simply reverted, the blocked leg
              would leave no trace and nobody reading the logs could prove the freeze worked. So
              batches stop and say so instead.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <Reveal>
              <div className="m-placard px-5 py-5">
                <p className="legend text-ink-soft">pay() — single payment</p>
                <hr className="rule-engraved-light my-3" />
                <pre className="overflow-x-auto font-mono text-legend leading-relaxed text-ink">
                  {`tx 0x7f2c…9a1   REVERTED
  SpendLimitExceeded(80000000, 40000000)

state unchanged — nothing moved`}
                </pre>
                <p className="mt-4 text-body text-ink-soft">
                  The hard guarantee: a violating payment has no effect on chain, full stop.
                </p>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <div className="m-placard px-5 py-5">
                <p className="legend text-ink-soft">payBatch() — a run of payments</p>
                <hr className="rule-engraved-light my-3" />
                <pre className="overflow-x-auto font-mono text-legend leading-relaxed text-ink">
                  {`tx 0x91c4…7f2   SUCCESS
  leg 0  PaymentExecuted  38.000000
  leg 1  PaymentBlocked   Paused
  leg 2  not attempted`}
                </pre>
                <p className="mt-4 text-body text-ink-soft">
                  Policy is re-checked before every leg. The owner froze the wallet between leg 0
                  and leg 1, and the receipt says so.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* What it runs on                                                   */}
      {/* ---------------------------------------------------------------- */}
      <section
        id="stack"
        className="overflow-hidden border-t border-black/40 bg-enamel-lo px-6 pt-20 sm:px-10 lg:pt-28"
      >
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <p className="legend text-placard/55">Built on</p>
            <h2 className="heading mt-3 max-w-2xl text-panel text-placard">
              Four moving parts, one of which cannot be argued with
            </h2>
            <p className="mt-4 max-w-xl text-body text-placard/65">
              The policy is Solidity on Ethereum, tested and deployed with Hardhat. The console is
              Next.js and React, reading chain state through viem. The agent is Python, and its
              decision trace lands in MongoDB. Only the first of those can stop a payment.
            </p>
          </Reveal>
        </div>

        <Reveal className="mt-4">
          <OrbitingStack />
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="border-t border-black/40 px-6 py-20 sm:px-10 lg:py-24">
        <Reveal className="mx-auto max-w-5xl">
          <h2 className="heading max-w-xl text-panel text-placard">
            Watch it refuse something
          </h2>
          <p className="mt-4 max-w-lg text-body text-placard/65">
            The console shows live policy state and every payment attempt. The demo stage runs the
            three scenarios end to end: a normal payment, an attack, and a freeze mid-flight.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/console"
              className="legend px-5 py-3 text-ink transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--color-hazard)" }}
            >
              Open the console
            </Link>
            <Link
              href="/demo"
              className="legend m-panel px-5 py-3 text-placard transition-colors hover:bg-enamel-lo"
            >
              Run the demo
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-black/40 px-6 py-8 sm:px-10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <p className="legend text-placard/40">Sepolia testnet · mUSDC</p>
          <Link
            href="/how-it-works"
            className="legend text-placard/55 underline decoration-placard/25 underline-offset-4 transition-colors hover:text-placard"
          >
            How enforcement works
          </Link>
        </div>
      </footer>
    </main>
  );
}
