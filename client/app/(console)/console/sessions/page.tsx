"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useConsole } from "@/components/console-data";
import { OwnerNotice, WriteStatus } from "@/components/write-status";
import { Button } from "@/components/ui/button";
import { shortenAddress, timeAgo } from "@/lib/format";
import { useOwnerWrite } from "@/lib/use-owner-write";
import { walletControlAbi } from "@/lib/wallet-abi";

const DURATIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86400 },
  { label: "7 days", seconds: 7 * 86400 },
  { label: "30 days", seconds: 30 * 86400 },
];

function sessionExpiryLabel(expiresAt: number): { text: string; urgent: boolean } {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return { text: "Expired", urgent: true };
  if (diff < 3600) return { text: `Expires in ${Math.floor(diff / 60)}m`, urgent: true };
  if (diff < 86400) return { text: `Expires in ${Math.floor(diff / 3600)}h`, urgent: true };
  const days = Math.floor(diff / 86400);
  return { text: `Expires in ${days}d`, urgent: false };
}

export default function SessionsPage() {
  const { data, freeze } = useConsole();
  const write = useOwnerWrite(data.contracts?.agentWallet);
  const { address } = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [grantDuration, setGrantDuration] = useState(86400);

  const canWrite = freeze.isOwner;
  const busy = write.status === "signing" || write.status === "pending";
  const sessionKey = data.agentSessionKey;
  const walletAddress = data.contracts?.agentWallet as `0x${string}` | undefined;

  // Read session expiry directly from chain
  const sessionQuery = useReadContract({
    address: walletAddress,
    abi: walletControlAbi,
    functionName: "sessions",
    args: sessionKey ? [sessionKey as `0x${string}`] : undefined,
    query: { enabled: Boolean(walletAddress && sessionKey), refetchInterval: 10000 },
  });

  const sessionData = sessionQuery.data as [boolean, number] | undefined;
  const sessionActive = sessionData?.[0] ?? false;
  const sessionExpiresAt = sessionData?.[1] ? Number(sessionData[1]) : null;
  const expiry = sessionExpiresAt ? sessionExpiryLabel(sessionExpiresAt) : null;

  const sessionEvents = data.events.filter(
    (event) => event.event === "SessionGranted" || event.event === "SessionRevoked",
  );
  const latest = sessionEvents[0];
  const revoked = !sessionActive && latest?.event === "SessionRevoked";

  async function revoke() {
    if (!sessionKey) return;
    const ok = await write.send("revokeSession", [sessionKey], "revoke");
    if (ok) { setConfirming(false); data.refresh(); void sessionQuery.refetch(); }
  }

  async function grantSession() {
    if (!sessionKey) return;
    const expiresAt = Math.floor(Date.now() / 1000) + grantDuration;
    const ok = await write.send("grantSession", [sessionKey, expiresAt], "grant");
    if (ok) { data.refresh(); void sessionQuery.refetch(); }
  }

  return (
    <div className="mx-auto flex max-w-384 flex-col gap-9">
      <header>
        <h1 className="heading text-panel text-placard">Sessions</h1>
        <p className="measure mt-2 text-body text-placard/65">
          The agent signs with a session key, never with the owner key. That is what makes the
          freeze meaningful — the process running the agent has no way to unfreeze itself.
        </p>
      </header>

      <OwnerNotice connected={freeze.connected} isOwner={freeze.isOwner} owner={data.owner} />

      <section className="m-panel px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="legend text-placard/55">Agent session key</p>
            <p className="mt-2 break-all font-mono text-body text-placard">{sessionKey ?? "—"}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className={`led ${sessionActive ? "led-running" : "led-stopped"}`} aria-hidden="true" />
              <span className="legend text-placard/50">{sessionActive ? "Active" : "Inactive"}</span>
              {expiry && (
                <span
                  className="legend"
                  style={{ color: expiry.urgent ? "var(--color-hazard)" : "var(--color-placard/50)" }}
                >
                  · {expiry.text}
                </span>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <p className="legend text-placard/55">Owner key</p>
            <p className="mt-2 font-mono text-body text-placard/80">
              {data.owner ? shortenAddress(data.owner) : "—"}
            </p>
            <p className="legend mt-3 text-placard/40">Holds the kill switch</p>
          </div>
        </div>

        <hr className="rule-engraved my-6" />

        {/* --- Grant new session ----------------------------------------- */}
        <div className="mb-6">
          <p className="legend text-placard/70">Grant / renew session</p>
          <p className="legend mt-1 text-placard/40">Sets a new expiry on the current session key.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {DURATIONS.map((d) => (
              <button
                key={d.seconds}
                type="button"
                onClick={() => setGrantDuration(d.seconds)}
                className={`legend px-3.5 py-2 transition-colors ${
                  grantDuration === d.seconds ? "bg-placard text-ink" : "m-panel text-placard/70 hover:text-placard"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Button variant="secondary" disabled={!canWrite || busy || !sessionKey} onClick={() => void grantSession()}>
              Grant {DURATIONS.find((d) => d.seconds === grantDuration)?.label}
            </Button>
          </div>
          {write.pendingKey === "grant" && (
            <div className="mt-3">
              <WriteStatus status={write.status} error={write.error} txHash={write.txHash} doneLabel="Session granted" />
            </div>
          )}
        </div>

        <hr className="rule-engraved mb-6" />

        {/* --- Revoke ---------------------------------------------------- */}
        {!confirming ? (
          <button
            type="button"
            disabled={!canWrite || busy || !sessionKey || revoked}
            onClick={() => setConfirming(true)}
            className="legend px-5 py-3 text-placard transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            style={{ boxShadow: "inset 0 0 0 2px var(--color-estop)" }}
          >
            {revoked ? "Already revoked" : "Revoke session key"}
          </button>
        ) : (
          <div className="m-well px-4 py-4">
            <p className="legend" style={{ color: "var(--color-estop)" }}>Revoke this session key?</p>
            <p className="mt-2 max-w-lg text-body text-placard/75">
              The agent stops at its next payment leg, including one already in progress. It cannot
              grant itself a new key — only the owner can, and that is a separate transaction.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void revoke()}
                className="legend px-5 py-3 text-placard transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "var(--color-estop)" }}
              >
                Revoke
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="legend px-4 py-3 text-placard/60 transition-colors hover:text-placard"
              >
                Keep it
              </button>
            </div>
          </div>
        )}

        <div className="mt-4">
          <WriteStatus
            status={write.pendingKey === "revoke" || write.status === "error" ? write.status : "idle"}
            error={write.error}
            txHash={write.txHash}
            doneLabel="Session revoked"
          />
        </div>
      </section>

      <section>
        <h2 className="legend text-placard/70">Session history</h2>
        {sessionEvents.length === 0 ? (
          <p className="m-well mt-4 px-4 py-6 text-center text-body text-placard/60">No session events yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-px">
            {sessionEvents.map((event) => (
              <li
                key={`${event.txHash}-${event.logIndex}`}
                className="m-placard flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="legend" style={{ color: event.event === "SessionRevoked" ? "var(--color-estop-ink)" : "var(--color-running-ink)" }}>
                  {event.event}
                </span>
                <span className="font-mono text-legend text-ink-soft">
                  {String(event.args.key ?? "") ? shortenAddress(String(event.args.key)) : ""}
                </span>
                <span className="legend text-ink-soft">{timeAgo(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
