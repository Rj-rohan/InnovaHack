"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/connect-button";
import { useConsole } from "@/components/console-data";
import { Estop } from "@/components/estop";
import { formatBlockNumber } from "@/lib/format";

type Led = "running" | "caution" | "stopped" | "off";

/**
 * The console chassis.
 *
 * The freeze lives in the top strip on every route, not on a page of its own. A kill switch you
 * have to navigate to is not a kill switch.
 *
 * Rail LEDs report real state rather than decorating the navigation: sage for normal, hazard for
 * something the owner should look at, red for stopped.
 */

const SECTIONS = [
  { href: "/console", label: "Overview" },
  { href: "/console/policy", label: "Policy" },
  { href: "/console/counterparties", label: "Counterparties" },
  { href: "/console/sessions", label: "Sessions" },
  { href: "/console/review", label: "Review" },
  { href: "/console/activity", label: "Activity" },
] as const;

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const { data, freeze, paused, toggleFreeze } = useConsole();
  const pathname = usePathname();

  const state = data.state;

  // Most recent session event decides the session lamp. Events arrive newest-first.
  const lastSessionEvent = data.events.find(
    (e) => e.event === "SessionGranted" || e.event === "SessionRevoked",
  );

  const leds: Record<string, Led> = {
    "/console": paused ? "stopped" : data.indexerStale ? "caution" : "running",
    "/console/policy": paused
      ? "stopped"
      : state && state.throttleBps < 10000
        ? "caution"
        : "running",
    "/console/counterparties": state?.allowlist.some((entry) => !entry.enabled)
      ? "caution"
      : state
        ? "running"
        : "off",
    "/console/sessions": !lastSessionEvent
      ? "off"
      : lastSessionEvent.event === "SessionRevoked"
        ? "stopped"
        : "running",
    "/console/activity":
      data.attempts[0]?.status === "blocked" || data.attempts[0]?.status === "reverted"
        ? "stopped"
        : data.attempts.length > 0
          ? "running"
          : "off",
    // Amber only while something is actually waiting on the owner — a lamp that is always lit
    // stops being a signal.
    "/console/review": data.reviewItems.some((item) => item.status === "pending")
      ? "caution"
      : data.reviewItems.length > 0
        ? "running"
        : "off",
  };

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      {/* --- Rail. Sticky, never fixed: an ancestor filter would break `fixed`, and the
              freeze desaturation uses one. --- */}
      <nav
        className="sticky top-0 z-30 shrink-0 border-b border-black/45 bg-enamel-lo lg:h-svh lg:w-56 lg:border-b-0 lg:border-r"
        aria-label="Console sections"
      >
        <div className="hidden px-5 py-6 lg:block">
          <Link href="/" className="legend text-placard/80 transition-colors hover:text-placard">
            ← Kill Switch
          </Link>
        </div>

        <ul className="flex overflow-x-auto lg:flex-col lg:overflow-visible">
          {SECTIONS.map((section) => {
            const active = pathname === section.href;
            return (
              <li key={section.href} className="shrink-0">
                <Link
                  href={section.href}
                  aria-current={active ? "page" : undefined}
                  className={`legend flex items-center gap-2.5 whitespace-nowrap px-5 py-3.5 transition-colors lg:py-3 ${
                    active
                      ? "bg-enamel text-placard"
                      : "text-placard/55 hover:bg-enamel/60 hover:text-placard/85"
                  }`}
                >
                  <span className={`led led-${leds[section.href]}`} aria-hidden="true" />
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* --- Top strip. The freeze is here on every route. --- */}
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-black/45 bg-enamel px-5 py-3 pr-6 lg:top-0 lg:pr-8">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <span className="legend text-placard/75">Sepolia</span>
            {state && (
              <span className="tnum font-mono text-legend text-placard/45">
                Block {formatBlockNumber(state.lastIndexedBlock)}
              </span>
            )}
            <span className="flex items-center gap-2">
              <span
                className={`led ${data.connected ? "led-running" : "led-off"}`}
                aria-hidden="true"
              />
              <span className="legend text-placard/45">{data.connected ? "Live" : "Offline"}</span>
            </span>
            {data.indexerStale && (
              <span className="legend text-hazard">Indexer quiet — figures may be stale</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <ConnectButton />
            <div className="flex items-center gap-2.5">
              {/* Must agree with the cap face. Saying "Hold to freeze" beside a switch that will
                  open a wallet is the same defect as labelling the cap "Stop" when disconnected. */}
              <span className="legend hidden text-placard/60 sm:inline">
                {!freeze.connected
                  ? "Hold to connect"
                  : paused
                    ? "Hold to release"
                    : "Hold to freeze"}
              </span>
              <Estop
                variant="bar"
                paused={paused}
                status={freeze.status}
                connected={freeze.connected}
                onFreeze={toggleFreeze}
                onRelease={toggleFreeze}
              />
            </div>
          </div>
        </header>

        {/* Keyed on the route so the settle replays on navigation. One entrance per page and then
            nothing — a dashboard whose figures keep moving while you read them is hostile, so the
            console gets this and none of the scroll-scrubbed motion the landing page uses. */}
        <main className="desat flex-1 px-5 py-8 lg:px-8 lg:py-10">
          <div key={pathname} className="settle">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
