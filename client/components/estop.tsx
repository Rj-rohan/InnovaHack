"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FreezeStatus } from "@/lib/use-freeze";

/**
 * The kill switch itself.
 *
 * Hold to commit, rather than click. Two reasons, both load-bearing:
 *
 *  - A control that halts a running payment system should cost more than a stray click.
 *  - Releasing takes twice as long as freezing (1.2s vs 0.6s). That asymmetry is the product's
 *    thesis expressed as an interaction: stopping is instant, resuming is deliberate.
 *
 * Keyboard behaves identically — hold Space or Enter. The hold is the affordance, not the mouse.
 */

const FREEZE_HOLD_MS = 600;
const RELEASE_HOLD_MS = 1200;

export type EstopVariant = "hero" | "bar";

export interface EstopProps {
  paused: boolean;
  status: FreezeStatus;
  connected: boolean;
  onFreeze: () => void | Promise<void>;
  onRelease: () => void | Promise<void>;
  variant?: EstopVariant;
  className?: string;
}

export function Estop({
  paused,
  status,
  connected,
  onFreeze,
  onRelease,
  variant = "hero",
  className = "",
}: EstopProps) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<number | null>(null);
  const keyHeldRef = useRef(false);

  const busy = status === "signing" || status === "pending";
  const holdMs = paused ? RELEASE_HOLD_MS : FREEZE_HOLD_MS;

  // Disabled only while a transaction is in flight. A disconnected visitor still gets a working,
  // full-strength switch — holding it opens the wallet, which is the honest next step rather than
  // a greyed-out control explaining why it cannot help.
  const disabled = busy;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const abort = useCallback(() => {
    keyHeldRef.current = false;
    clearTimer();
    setHolding(false);
  }, [clearTimer]);

  const begin = useCallback(() => {
    if (disabled || timerRef.current !== null) return;

    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      void (paused ? onRelease() : onFreeze());
    }, holdMs);
  }, [disabled, holdMs, paused, onFreeze, onRelease]);

  // Releasing the pointer outside the button still has to cancel: otherwise dragging off-target
  // leaves the switch armed and it fires anyway.
  useEffect(() => {
    if (!holding) return;
    window.addEventListener("pointerup", abort);
    window.addEventListener("pointercancel", abort);
    return () => {
      window.removeEventListener("pointerup", abort);
      window.removeEventListener("pointercancel", abort);
    };
  }, [holding, abort]);

  useEffect(() => clearTimer, [clearTimer]);

  const action = connected
    ? paused
      ? "Release the agent"
      : "Freeze the agent"
    : "Connect the owner wallet to freeze the agent";

  return (
    <button
      type="button"
      className={`estop ${className}`}
      data-variant={variant}
      data-paused={paused}
      data-holding={holding}
      data-busy={busy}
      disabled={disabled}
      aria-pressed={paused}
      aria-label={`${action}. Press and hold for ${holdMs / 1000} seconds.`}
      style={
        holding
          ? ({ "--estop-fill": "100%", "--estop-hold": `${holdMs}ms` } as React.CSSProperties)
          : undefined
      }
      onPointerDown={(event) => {
        event.preventDefault();
        begin();
      }}
      onPointerUp={abort}
      onPointerLeave={abort}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault(); // Space would scroll the page.
        if (keyHeldRef.current) return; // Ignore auto-repeat.
        keyHeldRef.current = true;
        begin();
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") abort();
      }}
      onBlur={abort}
    >
      <span className="estop-ring" aria-hidden="true" />
      <span className="estop-shoulder" aria-hidden="true">
        <span className="estop-cap">
          <span className="estop-cap-text legend">{paused ? "Release" : "Stop"}</span>
        </span>
      </span>
    </button>
  );
}

/**
 * The words under the button.
 *
 * Split out because the console bar shows the button alone. An action keeps the same name
 * everywhere it appears: the control says Freeze, and what follows says Frozen.
 */
export function EstopCaption({
  paused,
  status,
  connected,
  isOwner,
  error,
}: {
  paused: boolean;
  status: FreezeStatus;
  connected: boolean;
  isOwner: boolean;
  error: string | null;
}) {
  if (!connected) {
    return <p className="legend text-placard/70">Hold to connect the owner wallet</p>;
  }

  if (status === "signing") {
    return <p className="legend text-hazard">Confirm in your wallet</p>;
  }

  if (status === "pending") {
    return <p className="legend text-hazard">Sending to Sepolia…</p>;
  }

  if (status === "error" && error) {
    return (
      <p className="legend text-estop" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <p className="legend">{paused ? "Hold 1.2s to release" : "Hold 0.6s to freeze"}</p>
      {!isOwner && (
        // Left enabled on purpose. A non-owner press reverts with NotOwner(), which demonstrates
        // the guarantee far better than a greyed-out button describing it.
        <p className="legend text-hazard/90">Not the owner — this reverts with NotOwner()</p>
      )}
    </div>
  );
}
