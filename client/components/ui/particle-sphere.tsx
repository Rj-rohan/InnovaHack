"use client";

import { useEffect, useRef } from "react";

/**
 * A rotating point-cloud sphere, in plain Canvas 2D.
 *
 * The original of this component reached for three.js loaded from a CDN at runtime. That is
 * ~600KB and a network dependency for a decorative element, on a page whose whole job is to be
 * demonstrated live in a room with unreliable wifi. Canvas 2D gets the same picture in a couple
 * of kilobytes and cannot fail to load.
 *
 * Points are placed with a Fibonacci lattice, which distributes them evenly over the sphere —
 * naive random spherical coordinates bunch visibly at the poles.
 */

const POINTS = 620;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function ParticleSphere({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Unit sphere, generated once.
    const points = Array.from({ length: POINTS }, (_, i) => {
      const y = 1 - (i / (POINTS - 1)) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN_ANGLE * i;
      return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
    });

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

    let frame = 0;
    let angle = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const delta = Math.min(now - last, 64) / 1000;
      last = now;
      if (!reduceMotion) angle += delta * 0.22;

      context.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.42;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);

      for (const point of points) {
        // Spin about the vertical axis, then tilt slightly so the poles are never dead-on.
        const x = point.x * cos - point.z * sin;
        const z = point.x * sin + point.z * cos;
        const y = point.y * 0.94 - z * 0.12;

        const depth = (z + 1) / 2; // 0 back, 1 front
        const screenX = cx + x * radius;
        const screenY = cy + y * radius;

        const size = 0.6 + depth * 1.7;
        const alpha = 0.16 + depth * 0.84;

        // A few points glow hazard yellow — enough to read as instrumentation rather than as a
        // generic particle field, not enough to become a second accent colour.
        const warm = (point.x + point.y) > 1.35;
        context.fillStyle = warm
          ? `rgba(242, 183, 5, ${alpha * 0.85})`
          : `rgba(232, 228, 217, ${alpha})`;

        context.beginPath();
        context.arc(screenX, screenY, size, 0, Math.PI * 2);
        context.fill();
      }

      if (!reduceMotion) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
