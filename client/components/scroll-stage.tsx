"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";

/**
 * Shared scaffolding for the three scroll showpieces.
 *
 * Every timeline goes through here so the four things that are easy to get wrong are only written
 * once: plugin registration stays off the server, cleanup runs on unmount, reduced motion means
 * *never built* rather than built-and-disabled, and pin distances get re-measured after late
 * layout shifts.
 *
 * Sections must be authored resting-state-first. GSAP animates *to* the CSS that is already there,
 * so with JS off, reduced motion on, or a deep link landing mid-page, the section is still whole.
 */

export interface StageContext {
  /** The pinned wrapper. Query descendants from here rather than from `document`. */
  root: HTMLDivElement;
  /** `gsap.utils.selector(root)` — scoped, so two stages on a page never grab each other's nodes. */
  q: ReturnType<typeof gsap.utils.selector>;
}

export function ScrollStage({
  children,
  build,
  // Defaults off. Pinning makes a section `position: fixed`, which shares screen space with its
  // neighbours and fights them for paint order — it rendered two sections on top of each other
  // here. Opt in only with an opaque stage and nothing absolutely-positioned nearby.
  pin = false,
  scrub = 1,
  start = "top top",
  end = "+=180%",
  media = "(min-width: 1024px)",
  className = "",
  id,
}: {
  children: React.ReactNode;
  /** Compose the timeline. Called only when motion is allowed. */
  build: (tl: gsap.core.Timeline, ctx: StageContext) => void;
  /** Off by default — see the note on the parameter. */
  pin?: boolean;
  scrub?: number | boolean;
  start?: string;
  end?: string;
  /**
   * Extra gate on top of reduced-motion. Pinned stages need vertical room they do not have on a
   * phone, where pinning a section taller than the viewport traps the reader.
   */
  media?: string;
  className?: string;
  id?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const node = root.current;
      if (!node) return;

      // Registered here, not at module scope: this file is a client component but Next still
      // evaluates it on the server during SSR, and plugin registration has no business running there.
      gsap.registerPlugin(ScrollTrigger);

      const mm = gsap.matchMedia();

      const query = media
        ? `(prefers-reduced-motion: no-preference) and ${media}`
        : "(prefers-reduced-motion: no-preference)";

      mm.add(query, () => {
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: node,
            start,
            end,
            scrub,
            pin: pin ? node : false,
            // Prevents the one-frame jump when a pin engages at speed.
            anticipatePin: pin ? 1 : 0,
            invalidateOnRefresh: true,
          },
        });

        build(tl, { root: node, q: gsap.utils.selector(node) });
      });

      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div
      ref={root}
      id={id}
      // A pinned stage becomes `position: fixed`, so a transparent one lets the following section
      // scroll straight through it. Defaulted opaque here rather than left to each caller to
      // remember — `className` still wins if a stage wants a different surface.
      className={`${pin ? "bg-enamel" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Re-measures every trigger after the things that land late.
 *
 * ScrollTrigger computes pin distances when a trigger is created. The hero video is ~19MB and its
 * metadata can arrive well after first paint; when it does, everything below shifts and every pin
 * on the page is out by hundreds of pixels. Fonts do the same on a cold cache. Mount this once per
 * page that uses stages.
 */
export function ScrollRefresh() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    // rAF-deferred so the refresh runs after the browser has actually reflowed.
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => ScrollTrigger.refresh());
    };

    window.addEventListener("load", refresh);
    document.fonts?.ready.then(refresh).catch(() => {});

    const videos = Array.from(document.querySelectorAll("video"));
    for (const video of videos) video.addEventListener("loadedmetadata", refresh);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("load", refresh);
      for (const video of videos) video.removeEventListener("loadedmetadata", refresh);
    };
  }, []);

  return null;
}
