"use client";

/**
 * A machine marking: tiny engraved legend, large value.
 *
 * Deliberately not a "KPI card" — no sparkline, no percentage-change chip. These are instrument
 * readings, and an instrument that editorialises about its own trend is harder to read.
 */
export function Stat({
  legend,
  value,
  note,
  tone = "normal",
}: {
  legend: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: "normal" | "caution" | "stopped";
}) {
  const color =
    tone === "stopped"
      ? "var(--color-estop)"
      : tone === "caution"
        ? "var(--color-hazard)"
        : undefined;

  return (
    <div className="m-panel px-4 py-4">
      <p className="legend text-placard/55">{legend}</p>
      <p className="heading mt-2.5 text-lead leading-none" style={color ? { color } : undefined}>
        {value}
      </p>
      {note && <p className="legend mt-2 text-placard/45">{note}</p>}
    </div>
  );
}
