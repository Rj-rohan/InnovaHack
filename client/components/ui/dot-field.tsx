"use client";

import { useEffect, useRef } from "react";

/**
 * The dot-grid reveal, in Canvas 2D.
 *
 * A port of the WebGL version this screen was adapted from: a lattice of square dots that sweeps
 * outward from the centre on load, then twinkles slowly. The original pulled three.js r128 off a
 * CDN at runtime to draw it; this is the same picture without the dependency or the network call.
 *
 * Cells change state on a 5-second cycle, so there is nothing to gain from redrawing at 60fps —
 * it runs at 20 and costs almost nothing.
 */

const SPACING = 20;
const DOT = 6;
const FREQUENCY = 5;
const REVEAL_SPEED = 3;
const OPACITIES = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1];
const FRAME_MS = 50;

/** Deterministic per-cell noise. Stable across frames, unlike Math.random(). */
function noise(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function DotField({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const start = performance.now();
    let frame = 0;
    let lastDraw = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - lastDraw < FRAME_MS) return;
      lastDraw = now;

      // Reduced motion gets the settled state: fully revealed, no twinkle.
      const elapsed = reduceMotion ? 999 : (now - start) / 1000;

      context.clearRect(0, 0, width, height);

      const cols = Math.ceil(width / SPACING);
      const rows = Math.ceil(height / SPACING);
      const centerCol = cols / 2;
      const centerRow = rows / 2;

      for (let col = 0; col <= cols; col++) {
        for (let row = 0; row <= rows; row++) {
          const showOffset = noise(col, row);

          // Sweep outward from the middle, with a little jitter so the edge is not a clean ring.
          const distance = Math.hypot(col - centerCol, row - centerRow);
          const revealAt = distance * 0.045 + showOffset * 0.15;
          if (elapsed * REVEAL_SPEED < revealAt) continue;

          const cycle = Math.floor(elapsed / FREQUENCY + showOffset + FREQUENCY);
          const alpha = OPACITIES[Math.floor(noise(col * cycle, row * cycle) * OPACITIES.length)];

          // A tenth of the field glows hazard; the rest is cream. Enough to feel like
          // instrumentation, not enough to become a second accent.
          context.fillStyle =
            showOffset > 0.9
              ? `rgba(242, 183, 5, ${alpha * 0.75})`
              : `rgba(232, 228, 217, ${alpha * 0.3})`;

          context.fillRect(col * SPACING, row * SPACING, DOT, DOT);
        }
      }

      if (reduceMotion) cancelAnimationFrame(frame);
    };

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
