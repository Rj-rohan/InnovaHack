import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/reveal";

export const metadata: Metadata = {
  title: "How enforcement works",
  description:
    "Why pay() reverts but payBatch() reports, why simulate() cannot be gamed, and why the owner can withdraw from a frozen wallet.",
};

/**
 * The explainer.
 *
 * Written for the judge who wants to check the claim rather than take it on faith, so it leads
 * with the three questions that get asked — including the awkward one about the owner bypassing
 * the freeze. Pre-empting that is worth more than hoping nobody looks.
 */
export default function HowItWorksPage() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-black/40 px-6 py-8 sm:px-10 xl:px-16">
        <div className="mx-auto max-w-384">
          <Link href="/" className="legend text-placard/60 transition-colors hover:text-placard">
            ← Kill Switch
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-384 px-6 py-16 sm:px-10 lg:py-24 xl:px-16">
        <Reveal>
          <p className="legend text-placard/55">Contract behaviour</p>
          <h1 className="display mt-3 text-panel text-placard sm:text-display sm:leading-[0.9]">
            How enforcement works
          </h1>
          <p className="measure mt-6 text-lead text-placard/80">
            Three things about <span className="font-mono text-placard">AgentWallet.sol</span> that
            are worth checking rather than believing.
          </p>
        </Reveal>

        {/* --- 1 ---------------------------------------------------------- */}
        <Reveal className="mt-20">
          <Section
            eyebrow="One reverts, one reports"
            title="Why a blocked batch leg is visible at all"
          >
            <p>
              <Code>pay()</Code> reverts with a typed error. That is the hard guarantee: a
              violating payment has no effect on chain, full stop. But a revert emits no logs, so
              if a multi-step run were simply reverted, the blocked leg would leave no trace and
              nobody reading the chain could prove the freeze did anything.
            </p>
            <p>
              So <Code>payBatch()</Code> re-checks policy before every leg and, on the first
              violation, emits <Code>PaymentBlocked</Code> and stops instead of reverting. Legs
              that already executed stay executed. The receipt reads: leg 0 paid, leg 1 blocked
              because <Code>Paused</Code>.
            </p>
            <p>
              Both paths call the same <Code>_check()</Code>, so the reverting and the reporting
              behaviour can never drift apart.
            </p>
          </Section>
        </Reveal>

        <Reveal className="mt-10">
          <div className="grid gap-4 lg:grid-cols-2">
            <Receipt
              label="pay() — one payment"
              lines={[
                "tx 0x7f2c…9a1   REVERTED",
                "  SpendLimitExceeded(80000000, 40000000)",
                "",
                "state unchanged — nothing moved",
              ]}
            />
            <Receipt
              label="payBatch() — a run"
              lines={[
                "tx 0x91c4…7f2   SUCCESS",
                "  leg 0  PaymentExecuted  38.000000",
                "  leg 1  PaymentBlocked   Paused",
                "  leg 2  not attempted",
              ]}
            />
          </div>
        </Reveal>

        {/* --- 2 ---------------------------------------------------------- */}
        <Reveal className="mt-20">
          <Section
            eyebrow="Observation, not permission"
            title="Why the agent cannot game simulate()"
          >
            <p>
              The contract exposes <Code>simulate()</Code> so the agent can look before it leaps.
              It is a convenience, never an authority — a dry run that returns a{" "}
              <Code>BlockReason</Code> and changes nothing.
            </p>
            <p>
              An agent that skips it gains nothing. An agent that calls it and lies about the
              result gains nothing either, because <Code>pay()</Code> re-derives the same answer
              from storage at execution time, in the same transaction. There is no path where the
              agent&apos;s belief about policy is what gets enforced.
            </p>
          </Section>
        </Reveal>

        {/* --- 3 ---------------------------------------------------------- */}
        <Reveal className="mt-20">
          <Section
            eyebrow="The awkward one"
            title="Why the owner can still withdraw from a frozen wallet"
          >
            <p>
              <Code>ownerWithdraw()</Code> deliberately bypasses every check, including{" "}
              <Code>paused</Code>. That looks like a hole until you ask who the policy is for.
            </p>
            <p>
              The policy constrains the <em>agent</em>, not the owner. It is the owner&apos;s
              money, and a freeze that also locked the owner out of their own funds would be a bug
              dressed up as a safety feature — the first thing anyone would want after stopping a
              misbehaving agent is to move the money somewhere it cannot be reached.
            </p>
            <p>
              The security property being claimed is narrow and precise:{" "}
              <strong className="text-placard">
                a compromised agent cannot move funds outside policy
              </strong>
              . It is not &ldquo;nobody can move these funds&rdquo;, and it was never meant to be.
            </p>
          </Section>
        </Reveal>

        {/* --- 4 ---------------------------------------------------------- */}
        <Reveal className="mt-20">
          <Section eyebrow="Also worth knowing" title="Two smaller decisions">
            <p>
              <strong className="text-placard">The window really rolls.</strong>{" "}
              <Code>rolling24h()</Code> sums a ring buffer of timestamped spends over the trailing
              24 hours, rather than resetting at midnight. A calendar day would let an agent spend
              two full allowances an hour apart.
            </p>
            <p>
              <strong className="text-placard">One token, no calldata.</strong> The wallet only
              ever transfers a single ERC-20. A wallet that accepts arbitrary calldata has to parse
              that calldata to enforce anything, and calldata parsing is where policy wallets get
              exploited. Restricting the surface to &ldquo;transfer this one token&rdquo; makes the
              policy total.
            </p>
          </Section>
        </Reveal>

        <Reveal className="mt-20">
          <div className="m-panel px-6 py-6">
            <p className="text-body text-placard/75">
              Every claim here is checkable against the deployed source. The console links each
              transaction to Etherscan, and the contract is verified.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="legend px-5 py-3 text-ink transition-opacity hover:opacity-90"
                style={{ backgroundColor: "var(--color-hazard)" }}
              >
                Watch it refuse something
              </Link>
              <Link
                href="/console"
                className="legend m-panel px-5 py-3 text-placard transition-colors hover:bg-enamel-lo"
              >
                Open the console
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </main>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="legend text-placard/50">{eyebrow}</p>
      <h2 className="heading mt-3 max-w-[24ch] text-panel text-placard">{title}</h2>
      <div className="measure mt-5 flex flex-col gap-4 text-body text-placard/70">{children}</div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-placard/95">{children}</span>;
}

function Receipt({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="m-placard px-5 py-5">
      <p className="legend text-ink-soft">{label}</p>
      <hr className="rule-engraved-light my-3" />
      <pre className="overflow-x-auto font-mono text-legend leading-relaxed text-ink">
        {lines.join("\n")}
      </pre>
    </div>
  );
}
