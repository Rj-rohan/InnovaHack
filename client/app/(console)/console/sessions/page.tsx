"use client";

import { useState } from "react";
import { useConsole } from "@/components/console-data";
import { OwnerNotice, WriteStatus } from "@/components/write-status";
import { shortenAddress, timeAgo } from "@/lib/format";
import { useOwnerWrite } from "@/lib/use-owner-write";

/**
 * The agent's session key.
 *
 * This is the page that explains the architecture in one screen: the agent holds a key that can
 * only propose payments, the owner holds the key that can revoke it, and they are never the same
 * key. Revoking takes effect at the agent's next policy check — which `payBatch` performs before
 * every leg, so a run already in progress stops partway.
 */
export default function SessionsPage() {
  const { data, freeze } = useConsole();
  const write = useOwnerWrite(data.contracts?.agentWallet);
  const [confirming, setConfirming] = useState(false);

  const canWrite = freeze.isOwner;
  const busy = write.status === "signing" || write.status === "pending";
  const sessionKey = data.agentSessionKey;

  const sessionEvents = data.events.filter(
    (event) => event.event === "SessionGranted" || event.event === "SessionRevoked",
  );
  const latest = sessionEvents[0];
  const revoked = latest?.event === "SessionRevoked";

  async function revoke() {
    if (!sessionKey) return;
    const ok = await write.send("revokeSession", [sessionKey], "revoke");
    if (ok) {
      setConfirming(false);
      data.refresh();
    }
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
            <p className="mt-2 break-all font-mono text-body text-placard">
              {sessionKey ?? "—"}
            </p>
            {latest && (
              <p className="legend mt-3 flex items-center gap-2 text-placard/50">
                <span className={`led ${revoked ? "led-stopped" : "led-running"}`} aria-hidden="true" />
                {revoked ? "Revoked" : "Granted"} {timeAgo(latest.createdAt)}
              </p>
            )}
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
            <p className="legend" style={{ color: "var(--color-estop)" }}>
              Revoke this session key?
            </p>
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
          <p className="m-well mt-4 px-4 py-6 text-center text-body text-placard/60">
            No session events yet.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-px">
            {sessionEvents.map((event) => (
              <li
                key={`${event.txHash}-${event.logIndex}`}
                className="m-placard flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <span
                  className="legend"
                  style={{
                    color:
                      event.event === "SessionRevoked"
                        ? "var(--color-estop-ink)"
                        : "var(--color-running-ink)",
                  }}
                >
                  {event.event}
                </span>
                <span className="font-mono text-legend text-ink-soft">
                  {String(event.args.key ?? "")
                    ? shortenAddress(String(event.args.key))
                    : ""}
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
