"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { useWalletConnection } from "@/lib/use-wallet-connection";
import { Estop, EstopCaption } from "@/components/estop";
import { Gauge } from "@/components/gauge";
import { LockoutTag } from "@/components/lockout-tag";
import { Ticker } from "@/components/ticker";
import { ConnectButton } from "@/components/connect-button";
import { useFreeze } from "@/lib/use-freeze";
import { useKillSwitch } from "@/lib/use-kill-switch";
import { formatBlockNumber, shortenAddress } from "@/lib/format";

/**
 * The hero is the mechanism, not a description of it.
 *
 * The page opens on an agent that is already spending, and the first thing within reach is the
 * switch that stops it. A visitor can perform the product's entire promise before reading a
 * sentence — which is a stronger claim than any headline making the same point in words.
 */
export function Hero() {
  const data = useKillSwitch();
  const freeze = useFreeze(data.contracts?.agentWallet);
  const wallet = useWalletConnection();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Reduced motion holds the footage on its first frame rather than removing it. The frame is
  // still the right backdrop; it is the movement the visitor asked not to have.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    const apply = () => {
      if (media.matches) {
        video.pause();
        video.currentTime = 0;
      } else {
        // Autoplay can be refused (low power mode, browser policy). Nothing breaks if it is —
        // the first frame stays on screen and the wash still reads.
        void video.play().catch(() => {});
      }
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  // The contract is the authority; the indexer is a cache of it. Prefer the direct read.
  const paused = freeze.paused ?? data.state?.paused ?? false;

  // Holding the switch while disconnected opens the wallet rather than doing nothing. One
  // gesture, and it always advances the visitor toward the thing they reached for.
  const armAndRun = useCallback(
    (run: () => void | Promise<void>) => () => {
      if (!freeze.connected) {
        wallet.openWallet();
        return;
      }
      void run();
    },
    [freeze.connected, wallet],
  );

  // Drives the page-wide desaturation. A stopped machine loses its colour.
  useEffect(() => {
    document.documentElement.dataset.frozen = String(paused);
    return () => {
      delete document.documentElement.dataset.frozen;
    };
  }, [paused]);

  const state = data.state;

  return (
    <section className="relative isolate flex min-h-svh flex-col overflow-hidden">
      {/* --- Backplate. Treated until it reads as the same material as the chassis. --- */}
      <div className="hero-plate desat grain" aria-hidden="true">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src="/hero/hero.mp4"
          autoPlay
          muted
          loop
          playsInline
          // Decorative: the page says everything the footage does, so it is hidden from assistive
          // tech and never carries information of its own.
          aria-hidden="true"
          tabIndex={-1}
          preload="auto"
        />
        <div className="hero-wash" />
      </div>

      {/* --- Instrument strip --- */}
      <header className="relay relative z-10 mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="legend text-placard/70">Kill Switch</span>
          <span className="flex items-center gap-2">
            <span
              className={`led ${data.connected ? "led-running" : "led-off"}`}
              aria-hidden="true"
            />
            <span className="legend text-placard/70">{data.connected ? "Live" : "Offline"}</span>
          </span>
          {state && (
            <span className="tnum font-mono text-legend text-placard/50">
              Block {formatBlockNumber(state.lastIndexedBlock)}
            </span>
          )}
          {data.contracts?.agentWallet && (
            <span className="font-mono text-legend text-placard/50">
              {shortenAddress(data.contracts.agentWallet)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/console"
            className="legend px-3 py-2 text-placard/80 transition-colors hover:text-placard"
          >
            Console
          </Link>
          <ConnectButton />
        </div>
      </header>

      {/* --- The thesis --- */}
      <div className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 items-center gap-14 px-6 py-10 sm:px-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-24 lg:py-16">
        <div className="max-w-xl">
          <h1 className="display text-display text-placard">
            <span className="relay block" style={{ animationDelay: "90ms" }}>
              The
            </span>
            <span className="relay block" style={{ animationDelay: "180ms" }}>
              Kill
            </span>
            <span className="relay block" style={{ animationDelay: "270ms" }}>
              Switch
            </span>
          </h1>

          <p
            className="relay mt-7 max-w-md text-lead text-placard"
            style={{ animationDelay: "400ms" }}
          >
            Spend limits your agent cannot argue with.
          </p>

          <p
            className="relay mt-3 max-w-md text-body text-placard/75"
            style={{ animationDelay: "440ms" }}
          >
            Every cap, every allowlisted counterparty and the freeze itself live in contract
            storage. A compromised agent does not get to skip the check, because nothing here asks
            the agent whether it should be allowed.
          </p>

          {state && (
            <div
              className="relay desat mt-9 max-w-sm"
              style={{ animationDelay: "560ms" }}
            >
              <Gauge spent={state.spentInWindow} cap={state.rollingCap} paused={paused} />
            </div>
          )}

          {!data.loading && !data.deployed && (
            <div className="m-panel mt-8 max-w-md px-4 py-3.5">
              <p className="legend text-hazard">Nothing deployed yet</p>
              <p className="mt-1.5 text-body text-placard/70">
                Run <span className="font-mono text-placard">npm run deploy:sepolia</span> in{" "}
                <span className="font-mono text-placard">contracts/</span>, then start the indexer.
                Everything below goes live on its own.
              </p>
            </div>
          )}
        </div>

        {/* --- The switch. Outside .desat: the control stays vivid while the plant greys out. --- */}
        <div
          className="seat flex flex-col items-center gap-5 justify-self-center lg:justify-self-end"
          style={{ animationDelay: "480ms" }}
        >
          <div className="estop-mount">
            <Estop
              paused={paused}
              status={freeze.status}
              connected={freeze.connected}
              onFreeze={armAndRun(freeze.freeze)}
              onRelease={armAndRun(freeze.unfreeze)}
            />
          </div>
          <EstopCaption
            paused={paused}
            status={freeze.status}
            connected={freeze.connected}
            isOwner={freeze.isOwner}
            // A failed wallet open has to surface here too, or holding the switch with no
            // extension installed looks like the switch itself is broken.
            error={freeze.error ?? wallet.error}
          />
          {paused && <LockoutTag owner={freeze.owner ?? data.owner} />}
        </div>
      </div>

      {/* --- What the agent is actually doing --- */}
      <div
        className="relay desat relative z-10 mx-auto w-full max-w-7xl px-6 pb-12 sm:px-10"
        style={{ animationDelay: "640ms" }}
      >
        <div className="flex items-baseline justify-between gap-4 pb-2.5">
          <p className="legend text-placard/70">Live payments</p>
          <Link
            href="/console/activity"
            className="legend text-placard/50 underline decoration-placard/25 underline-offset-4 transition-colors hover:text-placard"
          >
            Full log
          </Link>
        </div>
        <div className="max-w-3xl">
          <Ticker attempts={data.attempts} limit={4} />
        </div>
      </div>
    </section>
  );
}
