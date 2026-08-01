"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The only scroll-driven motion in the app: a 12px rise, once, on first sight.
 *
 * Deliberately not a scroll-linked effect. Panels that track the scrollbar read as decoration;
 * a single settle reads as the page assembling itself. Reduced motion turns it off in CSS, and
 * the observer is disconnected after firing so nothing keeps running behind the scenes.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No IntersectionObserver (or SSR hydration oddity) must never mean invisible content.
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { rootMargin: "0px 0px -12% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      data-shown={shown}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
