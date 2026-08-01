"use client";

/**
 * The lockout/tagout tag.
 *
 * In a plant, a physical tag on an isolated switch says who stopped the machine and that nobody
 * else may start it. Here it is the same statement: the wallet is frozen and the agent cannot
 * clear it. It appears only while paused, and it stamps rather than swings — one accessory, worn
 * plainly.
 */
export function LockoutTag({ owner }: { owner?: string | null }) {
  return (
    <div
      className="stamp m-placard w-52 px-4 py-3.5"
      style={{ boxShadow: "inset 0 0 0 3px var(--color-estop), 0 12px 30px rgb(0 0 0 / .45)" }}
      role="status"
    >
      <div className="flex items-center gap-2">
        <span className="led led-stopped" aria-hidden="true" />
        <p className="legend" style={{ color: "var(--color-estop-ink)" }}>
          Do not operate
        </p>
      </div>

      <hr className="rule-engraved-light my-2.5" />

      <p className="heading text-lead leading-none text-ink">Agent frozen</p>

      <p className="mt-2 text-legend leading-snug text-ink-soft">
        Every payment reverts with <span className="font-mono">WalletPaused</span> until the owner
        releases it.
      </p>

      {owner && (
        <p className="mt-2.5 font-mono text-legend text-ink-soft">
          by {owner.slice(0, 6)}…{owner.slice(-4)}
        </p>
      )}
    </div>
  );
}
