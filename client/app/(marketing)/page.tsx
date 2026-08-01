import type { Metadata } from "next";
import Link from "next/link";
import { ConsoleDataProvider } from "@/components/console-data";
import { Hero } from "@/components/hero";
import { Shell } from "@/components/layout";
import { SectionHeader } from "@/components/section-header";
import { Reveal } from "@/components/reveal";
import { ScrollRefresh } from "@/components/scroll-stage";
import { ChecksExploded } from "@/components/sections/checks-exploded";
import { PaymentsRail } from "@/components/sections/payments-rail";
import { ReceiptExpansion } from "@/components/sections/receipt-expansion";
import { StorageContrast } from "@/components/sections/storage-contrast";
import { OrbitingStack } from "@/components/ui/orbiting-circles";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  description:
    "A policy-enforcing wallet for autonomous AI agents. Spend caps, an allowlist and the freeze all live in contract storage — so a compromised agent cannot spend its way around them.",
};

/**
 * Motion rhythm down the page: settle → smooth → showpiece → rest, repeating.
 *
 *   1 Hero              T1  entry sequence
 *   2 Live rail         T2  scroll-linked drift
 *   3 Six checks        T3  pinned exploded assembly
 *   4 Built on          T4  ambient rotation only
 *   5 Receipts          T2  scroll-linked expansion
 *   6 Prompt vs storage T3  pinned spotlight
 *   7 Close             T4  static
 *
 * Never two showpieces in a row, and every showpiece is followed by a rest. That contrast is the
 * whole mechanism — a page where everything is a showpiece has none.
 *
 * One `ConsoleDataProvider` wraps the live sections so the hero and the rail share a single SSE
 * subscription rather than opening one each.
 */
export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col">
      <ScrollRefresh />

      <ConsoleDataProvider>
        <Hero />
        <PaymentsRail />
      </ConsoleDataProvider>

      <ChecksExploded />

      {/* --- T4 rest. The orbit has its own slow rotation; nothing is coupled to scroll.
              Text and diagram sit side by side: stacked, the copy left a large void to its right
              and the section ran to nearly two screens for four sentences. --- */}
      <section className="overflow-hidden border-t border-black/40 bg-enamel-lo py-20 lg:py-28">
        <Shell>
          <div className="grid items-center gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <Reveal>
              <p className="legend text-placard/55">Built on</p>
              <h2 className="heading mt-3 max-w-[20ch] text-panel text-placard">
                Four moving parts, one of which cannot be argued with
              </h2>
              <p className="measure mt-5 text-body text-placard/65">
                The policy is Solidity on Ethereum, tested and deployed with Hardhat. The console is
                Next.js and React, reading chain state through viem. The agent is Python, and its
                decision trace lands in MongoDB.
              </p>
              <p className="mt-4 max-w-md text-body text-placard">
                Only the first of those can stop a payment.
              </p>
            </Reveal>

            <Reveal delay={80}>
              <OrbitingStack />
            </Reveal>
          </div>
        </Shell>
      </section>

      <ReceiptExpansion />

      <StorageContrast />

      {/* --- T4 rest. --- */}
      <section className="border-t border-black/40 py-20 lg:py-28">
        <Shell>
          <Reveal>
            <SectionHeader
              title="Watch it refuse something"
              lede="The console shows live policy state and every payment attempt. The demo stage runs the three scenarios end to end: a normal payment, an attack, and a freeze mid-flight."
            />
            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink href="/console" variant="primary">
                Open the console
              </ButtonLink>
              <ButtonLink href="/demo" variant="secondary">
                Run the demo
              </ButtonLink>
            </div>
          </Reveal>
        </Shell>
      </section>

      <footer className="border-t border-black/40 py-8">
        <Shell className="flex flex-wrap items-center justify-between gap-4">
          <p className="legend text-placard/40">Sepolia testnet · mUSDC</p>
          <Link
            href="/how-it-works"
            className="legend text-placard/55 underline decoration-placard/25 underline-offset-4 transition-colors hover:text-placard"
          >
            How enforcement works
          </Link>
        </Shell>
      </footer>
    </main>
  );
}
