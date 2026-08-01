"use client";

import type { WriteStatus as Status } from "@/lib/use-owner-write";
import { shortenHash } from "@/lib/format";

/** Progress and outcome for an owner write. Every state says what happened, not just that it did. */
export function WriteStatus({
  status,
  error,
  txHash,
  doneLabel = "Saved",
}: {
  status: Status;
  error: string | null;
  txHash: `0x${string}` | null;
  doneLabel?: string;
}) {
  if (status === "idle") return null;

  if (status === "error") {
    return (
      <p className="legend text-estop" role="alert">
        {error}
      </p>
    );
  }

  const label =
    status === "signing"
      ? "Confirm in your wallet"
      : status === "pending"
        ? "Sending to Sepolia…"
        : doneLabel;

  return (
    <p
      className={`legend flex flex-wrap items-center gap-2 ${status === "done" ? "text-running" : "text-hazard"}`}
      role="status"
    >
      <span className={`led ${status === "done" ? "led-running" : "led-caution"}`} aria-hidden="true" />
      {label}
      {txHash && (
        <a
          href={`https://sepolia.etherscan.io/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono underline decoration-current/40 underline-offset-2"
        >
          {shortenHash(txHash)}
        </a>
      )}
    </p>
  );
}

/** Shown above owner-only forms when the connected wallet cannot sign for them. */
export function OwnerNotice({
  connected,
  isOwner,
  owner,
}: {
  connected: boolean;
  isOwner: boolean;
  owner?: string | null;
}) {
  if (isOwner) return null;

  return (
    <div className="m-well px-4 py-3">
      <p className="text-body text-placard/75">
        {!connected
          ? "Connect the owner wallet to change policy. Everything below is live and readable without it."
          : `This wallet isn't the owner. You can watch, not change.${owner ? ` Owner: ${owner.slice(0, 6)}…${owner.slice(-4)}` : ""}`}
      </p>
    </div>
  );
}
