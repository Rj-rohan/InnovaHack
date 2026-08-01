"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";

/**
 * The section header, everywhere: eyebrow across the top, then heading and lede side by side.
 *
 * Stacked, this block stranded roughly two-thirds of a 1536px row — a 24ch heading above a 62ch
 * paragraph, both hard left, with a large empty field to their right. Widening the paragraph was
 * the wrong answer; past ~75ch it stops being readable. So the two run in parallel instead: each
 * stays inside a comfortable measure and together they span the frame.
 *
 * The three parts rise in sequence on first sight. Played once rather than scrubbed: text that
 * tracks the scrollbar is hard to read while it moves, and a heading you have to hold still to
 * finish reading is a bad trade for a bit of parallax.
 *
 * Collapses to stacked below `lg`, where there is no width to spend.
 */
export function SectionHeader({
  eyebrow,
  title,
  lede,
  children,
  className = "",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  /** Rendered under the lede, in the right column. */
  children?: React.ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const node = root.current;
      if (!node) return;

      gsap.registerPlugin(ScrollTrigger);

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(gsap.utils.selector(node)("[data-line]"), {
          y: 18,
          opacity: 0,
          duration: 0.55,
          ease: "power2.out",
          stagger: 0.08,
          scrollTrigger: { trigger: node, start: "top 88%", once: true },
        });
      });

      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className={className}>
      {eyebrow && (
        <p data-line className="legend text-placard/55">
          {eyebrow}
        </p>
      )}

      <div
        className={`grid gap-x-16 gap-y-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start ${
          eyebrow ? "mt-4" : ""
        }`}
      >
        <h2 data-line className="heading max-w-[20ch] text-panel text-placard">
          {title}
        </h2>

        {(lede || children) && (
          <div data-line className="lg:pt-1.5">
            {lede && <p className="max-w-[56ch] text-body text-placard/65">{lede}</p>}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
