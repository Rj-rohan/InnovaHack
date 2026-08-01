"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ConnectButton } from "@/components/connect-button";
import { useConsole } from "@/components/console-data";
import { Estop, EstopCaption } from "@/components/estop";
import { InstrumentRail } from "@/components/instrument-rail";
import { LockoutTag } from "@/components/lockout-tag";
import { formatBlockNumber, shortenAddress } from "@/lib/format";

/**
 * The hero is the mechanism, not a description of it.
 *
 * The page opens on an agent that is already spending, and the first thing within reach is the
 * switch that stops it. A visitor can perform the product's entire promise before reading a
 * sentence — which is a stronger claim than any headline making the same point in words.
 */
export function Hero() {
  // Shared with the rail below and anything else on the page: one subscription, not one per
  // component. `useKillSwitch` opens its own EventSource on every call.
  const { data, freeze, paused, toggleFreeze, connectError } = useConsole();
  const videoRef = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLElement>(null);

  /**
   * One coordinated entrance, ~850ms.
   *
   * This replaced seven separate CSS animations running `1ms steps(1, end)` at staggered delays —
   * which is a binary flip, not a transition, so the hero opened as seven discrete flashes and
   * read as a rendering fault.
   *
   * `gsap.from()` throughout: the resting state lives in the CSS, so if JS never runs the hero is
   * simply visible. The old version put `opacity: 0` in a keyframe, which was only safe because
   * the animation was CSS too.
   */
  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const q = gsap.utils.selector(root);
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

        tl.from(q("[data-hero='strip']"), { y: -8, opacity: 0, duration: 0.5 }, 0)
          .from(q("[data-hero='word']"), { y: 24, opacity: 0, duration: 0.6, stagger: 0.07 }, 0.1)
          .from(q("[data-hero='copy']"), { y: 14, opacity: 0, duration: 0.5, stagger: 0.06 }, 0.3)
          // The switch keeps a mechanical overshoot — it is hardware seating, not text arriving.
          .from(
            q("[data-hero='switch']"),
            { scale: 0.92, opacity: 0, duration: 0.5, ease: "back.out(1.6)" },
            0.34,
          )
          .from(q("[data-hero='rail']"), { y: 16, opacity: 0, duration: 0.5 }, 0.42);
      });

      return () => mm.revert();
    },
    { scope: root },
  );

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

  // Drives the page-wide desaturation. A stopped machine loses its colour.
  useEffect(() => {
    document.documentElement.dataset.frozen = String(paused);
    return () => {
      delete document.documentElement.dataset.frozen;
    };
  }, [paused]);

  const state = data.state;

  return (
    <section ref={root} className="relative isolate flex min-h-svh flex-col overflow-hidden">
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
      <header data-hero="strip" className="relative z-10 mx-auto flex w-full max-w-384 flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-10 xl:px-16">
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
      <div className="relative z-10 mx-auto grid w-full max-w-384 flex-1 grid-cols-1 items-center gap-x-16 gap-y-14 px-6 py-10 sm:px-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:py-16 xl:grid-cols-[minmax(0,1.05fr)_auto_20rem] xl:px-16">
        <div className="max-w-xl">
          <h1 className="display text-display text-placard">
            <span data-hero="word" className="block">
              The
            </span>
            <span data-hero="word" className="block">
              Kill
            </span>
            <span data-hero="word" className="block">
              Switch
            </span>
          </h1>

          <p
            data-hero="copy"
            className="mt-7 max-w-md text-lead text-placard"
          >
            Spend limits your agent cannot argue with.
          </p>

          <p
            data-hero="copy"
            className="mt-3 max-w-md text-body text-placard/75"
          >
            Every cap, every allowlisted counterparty and the freeze itself live in contract
            storage. A compromised agent does not get to skip the check, because nothing here asks
            the agent whether it should be allowed.
          </p>

          {/* Standby state. Deliberately free of setup instructions — this is a product surface,
              and shell commands belong in SETUP.md, not in front of a visitor. */}
          {!data.loading && !data.deployed && (
            <div className="m-panel mt-8 max-w-md px-4 py-3.5">
              <p className="legend text-hazard">Standby</p>
              <p className="mt-1.5 text-body text-placard/70">
                No wallet is under management right now. Live spend limits, the approved
                counterparty list and every payment attempt appear here the moment one is.
              </p>
            </div>
          )}
        </div>

        {/* --- The switch. Outside .desat: the control stays vivid while the plant greys out. --- */}
        <div
          data-hero="switch"
          className="flex flex-col items-center gap-5 justify-self-center lg:justify-self-end"
        >
          <div className="estop-mount">
            <Estop
              paused={paused}
              status={freeze.status}
              connected={freeze.connected}
              onFreeze={toggleFreeze}
              onRelease={toggleFreeze}
            />
          </div>
          <EstopCaption
            paused={paused}
            status={freeze.status}
            connected={freeze.connected}
            isOwner={freeze.isOwner}
            // A failed wallet open has to surface here too, or holding the switch with no
            // extension installed looks like the switch itself is broken.
            error={freeze.error ?? connectError}
          />
          {paused && <LockoutTag owner={freeze.owner ?? data.owner} />}
        </div>

        {/* --- The readings. Third zone: what the switch is governing. --- */}
        <div
          data-hero="rail"
          className="desat w-full max-w-sm justify-self-center xl:max-w-none xl:justify-self-stretch"
        >
          <InstrumentRail data={data} paused={paused} />
        </div>
      </div>

    </section>
  );
}
