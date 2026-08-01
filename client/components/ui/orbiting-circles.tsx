"use client";

import type React from "react";
import { ParticleSphere } from "@/components/ui/particle-sphere";

/**
 * The stack this actually runs on, in orbit around a point-cloud sphere.
 *
 * Every mark is inline SVG in a single cream tone. Two reasons: the demo has to work on a bad
 * network with no external image host to wait on, and eight brand colours orbiting a page with a
 * six-colour semantic palette would read as confetti — on this page red already means "the
 * contract refused something", and it cannot also mean "Solidity".
 */

type OrbitIcon = { label: string; angle: number; glyph: React.ReactNode };

/**
 * Rings are centred rather than rising out of the bottom edge, so every mark is on screen at
 * every moment. The bottom-anchored version this was adapted from hides roughly half its icons
 * below the fold at any time, which is fine for ambience and useless for a diagram whose job is
 * to name the four things the system is built from.
 */
const ORBITS: { size: string; duration: number; icons: OrbitIcon[] }[] = [
  {
    // Inner: what enforcement is written in.
    size: "h-56 w-56 md:h-64 md:w-64",
    duration: 64,
    icons: [
      { label: "Solidity", angle: -60, glyph: <SolidityMark /> },
      { label: "Ethereum", angle: 60, glyph: <EthereumMark /> },
      { label: "Hardhat", angle: 180, glyph: <HardhatMark /> },
    ],
  },
  {
    // Middle: what the owner sees.
    size: "h-80 w-80 md:h-96 md:w-96",
    duration: 82,
    icons: [
      { label: "Next.js", angle: 0, glyph: <NextMark /> },
      { label: "React", angle: -120, glyph: <ReactMark /> },
      { label: "viem", angle: 120, glyph: <ViemMark /> },
    ],
  },
  {
    // Outer: what the agent runs on.
    size: "h-104 w-104 md:h-128 md:w-128",
    duration: 104,
    icons: [
      { label: "Python", angle: -45, glyph: <PythonMark /> },
      { label: "MongoDB", angle: 135, glyph: <MongoMark /> },
    ],
  },
];

export function OrbitingStack() {
  return (
    <div
      // Sized to sit in a column beside the copy rather than as a full-width band. The outer ring
      // is 32rem, so the stage is 34rem — just enough clearance for the chip labels.
      className="orbit-stage relative mx-auto h-108 w-full max-w-136 scale-90 sm:scale-100 md:h-136"
      aria-hidden="true"
    >
      {/* Kept clear of the inner ring's chip labels — at w-40 the SOLIDITY and ETHEREUM captions
          ran over the sphere's edge. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 aspect-square w-24 -translate-x-1/2 -translate-y-1/2 md:w-32">
        <ParticleSphere className="h-full w-full" />
      </div>

      {ORBITS.map((orbit, index) => {
        const clockwise = index % 2 === 0;
        const orbitAnim = clockwise ? "orbit-cw" : "orbit-ccw";
        const counterAnim = clockwise ? "counter-cw" : "counter-ccw";

        return (
          <div
            key={orbit.size}
            className={`orbit-ring absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${orbit.size}`}
          >
            {orbit.icons.map((icon) => (
              <div
                key={icon.label}
                className="absolute left-1/2 top-0 -ml-7 flex h-1/2 w-14 origin-bottom flex-col items-center"
                style={
                  {
                    "--start-angle": `${icon.angle}deg`,
                    animation: `${orbitAnim} ${orbit.duration}s linear infinite`,
                  } as React.CSSProperties
                }
              >
                {/* Counter-rotates so the marks stay upright as the ring turns. */}
                <div
                  className="relative z-10 -mt-6 flex flex-col items-center gap-2"
                  style={
                    {
                      "--counter-offset": `${-icon.angle}deg`,
                      animation: `${counterAnim} ${orbit.duration}s linear infinite`,
                    } as React.CSSProperties
                  }
                >
                  <span className="orbit-bezel">{icon.glyph}</span>
                  <span className="legend whitespace-nowrap text-placard/60">{icon.label}</span>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Marks. Monochrome, currentColor, 24x24 box.
   --------------------------------------------------------------------------- */

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 md:h-6 md:w-6" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

function EthereumMark() {
  return (
    <Svg>
      <path d="M12 2 5.5 12.3 12 16.1l6.5-3.8L12 2Z" fill="currentColor" opacity=".55" />
      <path d="M12 17.4 5.5 13.6 12 22.2l6.5-8.6-6.5 3.8Z" fill="currentColor" />
    </Svg>
  );
}

function SolidityMark() {
  return (
    <Svg>
      <path d="M8.6 2h6.8l-2.4 4.2H6.2L8.6 2Z" fill="currentColor" opacity=".5" />
      <path d="M6.2 6.2h6.8L15.4 2l2.4 4.2-2.4 4.2H8.6L6.2 6.2Z" fill="currentColor" opacity=".8" />
      <path d="M15.4 22H8.6l2.4-4.2h6.8L15.4 22Z" fill="currentColor" opacity=".5" />
      <path d="M17.8 17.8H11l-2.4 4.2-2.4-4.2 2.4-4.2h6.8l2.4 4.2Z" fill="currentColor" opacity=".8" />
    </Svg>
  );
}

function HardhatMark() {
  return (
    <Svg>
      <path
        d="M5 15a7 7 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M10 8.6V6.2h4v2.4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path
        d="M2.8 15.2h18.4a1 1 0 0 1 1 1v1.2H1.8v-1.2a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
    </Svg>
  );
}

function NextMark() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 16.2V8.2l7.4 9.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15.2 8.2v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  );
}

function ReactMark() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="2.05" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.1" fill="none">
        <ellipse cx="12" cy="12" rx="10.4" ry="4" />
        <ellipse cx="12" cy="12" rx="10.4" ry="4" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="10.4" ry="4" transform="rotate(120 12 12)" />
      </g>
    </Svg>
  );
}

function PythonMark() {
  return (
    <Svg>
      <path
        d="M11.9 2c-2.6 0-4.4.9-4.4 2.9v2.2h4.6v.8H5.6C3.5 7.9 2 9.3 2 12s1.4 4 3.5 4h1.6v-2.6c0-2.1 1.7-3.6 3.8-3.6h3.6c1.8 0 3.2-1.4 3.2-3.1V4.9C17.7 3 16 2 13.8 2h-1.9Zm-2.5 1.7a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z"
        fill="currentColor"
        opacity=".85"
      />
      <path
        d="M12.1 22c2.6 0 4.4-.9 4.4-2.9v-2.2h-4.6v-.8h6.5c2.1 0 3.6-1.4 3.6-4.1s-1.4-4-3.5-4h-1.6v2.6c0 2.1-1.7 3.6-3.8 3.6H9.5c-1.8 0-3.2 1.4-3.2 3.1v2.8c0 1.9 1.7 2.9 3.9 2.9h1.9Zm2.5-1.7a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z"
        fill="currentColor"
        opacity=".55"
      />
    </Svg>
  );
}

function MongoMark() {
  return (
    <Svg>
      <path
        d="M12 1.8c1.6 2.4 4.6 5.1 4.6 9.3 0 3.6-2 6.4-4.2 7.6l-.4 3.5-.4-3.5C9.4 17.5 7.4 14.7 7.4 11.1c0-4.2 3-6.9 4.6-9.3Z"
        fill="currentColor"
        opacity=".65"
      />
      <path d="M12 4.6v13.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  );
}

function ViemMark() {
  return (
    <Svg>
      <path
        d="M3.2 5.4h4.3l4.5 10.4 4.5-10.4h4.3L14.1 20h-4.2L3.2 5.4Z"
        fill="currentColor"
        opacity=".8"
      />
    </Svg>
  );
}
