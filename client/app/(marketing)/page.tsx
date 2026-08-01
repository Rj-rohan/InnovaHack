import type { Metadata } from "next";
import Link from "next/link";
import { ConsoleDataProvider } from "@/components/console-data";
import { Hero } from "@/components/hero";
import { Shell } from "@/components/layout";
import { Reveal } from "@/components/reveal";
import { ScrollRefresh } from "@/components/scroll-stage";
import { ChecksExploded } from "@/components/sections/checks-exploded";
import { PaymentsRail } from "@/components/sections/payments-rail";
import { ReceiptExpansion } from "@/components/sections/receipt-expansion";
import { SpotlightContrast } from "@/components/sections/spotlight-contrast";
import { OrbitingStack } from "@/components/ui/orbiting-circles";

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

      {/* --- T4 rest. The orbit has its own slow rotation; nothing is coupled to scroll. --- */}
      <section className="overflow-hidden border-t border-black/40 bg-enamel-lo pt-20 lg:pt-28">
        <Shell>
          <Reveal>
            <p className="legend text-placard/55">Built on</p>
            <h2 className="heading mt-3 max-w-[24ch] text-panel text-placard">
              Four moving parts, one of which cannot be argued with
            </h2>
            <p className="measure mt-4 text-body text-placard/65">
              The policy is Solidity on Ethereum, tested and deployed with Hardhat. The console is
              Next.js and React, reading chain state through viem. The agent is Python, and its
              decision trace lands in MongoDB. Only the first of those can stop a payment.
            </p>
          </Reveal>
        </Shell>

        <Reveal className="mt-4">
          <OrbitingStack />
        </Reveal>
      </section>

      <ReceiptExpansion />

      <SpotlightContrast />

      {/* --- T4 rest. --- */}
      <section className="border-t border-black/40 py-20 lg:py-28">
        <Shell>
          <Reveal>
            <h2 className="heading max-w-[20ch] text-panel text-placard">
              Watch it refuse something
            </h2>
            <p className="measure mt-4 text-body text-placard/65">
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
