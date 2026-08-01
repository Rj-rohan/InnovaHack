"use client";

import { useMemo, useState } from "react";
import { isAddress, stringToHex } from "viem";
import { useConsole } from "@/components/console-data";
import { OwnerNotice, WriteStatus } from "@/components/write-status";
import { shortenAddress } from "@/lib/format";
import { useOwnerWrite } from "@/lib/use-owner-write";

const ZERO_TAG = `0x${"0".repeat(64)}` as const;

/**
 * The allowlist.
 *
 * An address is payable only when it carries a category tag AND that category is enabled, so the
 * page is organised by category rather than as a flat list — that is the shape the contract
 * actually checks, and it is what makes "stop paying every vendor" one action instead of ten.
 */
export default function CounterpartiesPage() {
  const { data, freeze } = useConsole();
  const write = useOwnerWrite(data.contracts?.agentWallet);

  const [address, setAddress] = useState("");
  const [tag, setTag] = useState("vendor");
  const [formError, setFormError] = useState<string | null>(null);

  const canWrite = freeze.isOwner;
  const busy = write.status === "signing" || write.status === "pending";

  const groups = useMemo(() => {
    const entries = data.state?.allowlist ?? [];
    const byTag = new Map<string, typeof entries>();
    for (const entry of entries) {
      const list = byTag.get(entry.tag) ?? [];
      list.push(entry);
      byTag.set(entry.tag, list);
    }
    return [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data.state?.allowlist]);

  async function addCounterparty(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const trimmed = address.trim();
    if (!isAddress(trimmed)) {
      setFormError("That isn't a valid address.");
      return;
    }
    if (!tag.trim()) {
      setFormError("Give the counterparty a category.");
      return;
    }
    if (tag.length > 31) {
      setFormError("Category names are limited to 31 characters.");
      return;
    }

    const ok = await write.send(
      "setCounterparty",
      [trimmed, stringToHex(tag.trim(), { size: 32 })],
      "add",
    );
    if (ok) {
      setAddress("");
      data.refresh();
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-9">
      <header>
        <h1 className="heading text-panel text-placard">Counterparties</h1>
        <p className="mt-2 max-w-xl text-body text-placard/65">
          A payment to any address not listed here reverts with{" "}
          <span className="font-mono text-placard/85">CounterpartyNotAllowed</span>, whatever the
          agent believes it is doing.
        </p>
      </header>

      <OwnerNotice connected={freeze.connected} isOwner={freeze.isOwner} owner={data.owner} />

      {groups.length === 0 ? (
        <p className="m-well px-4 py-6 text-center text-body text-placard/60">
          No counterparties yet. Nothing is payable.
        </p>
      ) : (
        groups.map(([groupTag, entries]) => {
          const enabled = entries.some((entry) => entry.enabled);
          const tagHex = stringToHex(groupTag, { size: 32 });

          return (
            <section key={groupTag}>
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
                <h2 className="legend flex items-center gap-2.5 text-placard/80">
                  <span className={`led ${enabled ? "led-running" : "led-stopped"}`} aria-hidden="true" />
                  {groupTag}
                  <span className="text-placard/40">
                    · {entries.length} {entries.length === 1 ? "address" : "addresses"}
                  </span>
                </h2>

                <button
                  type="button"
                  disabled={!canWrite || busy}
                  onClick={() => {
                    void write
                      .send("setTagEnabled", [tagHex, !enabled], `tag:${groupTag}`)
                      .then((ok) => ok && data.refresh());
                  }}
                  className="legend m-panel px-3.5 py-2 text-placard transition-colors enabled:hover:bg-enamel-lo disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {enabled ? `Disable all ${groupTag}` : `Enable all ${groupTag}`}
                </button>
              </div>

              <ul className="flex flex-col gap-px">
                {entries.map((entry) => (
                  <li
                    key={entry.address}
                    className="m-placard flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-body font-medium">{entry.label || "Unlabelled"}</p>
                      <p className="font-mono text-legend text-ink-soft" title={entry.address}>
                        {shortenAddress(entry.address)}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <span
                        className="legend"
                        style={{
                          color: entry.enabled
                            ? "var(--color-running-ink)"
                            : "var(--color-estop-ink)",
                        }}
                      >
                        {entry.enabled ? "Payable" : "Blocked"}
                      </span>

                      <button
                        type="button"
                        disabled={!canWrite || busy}
                        onClick={() => {
                          void write
                            .send("setCounterparty", [entry.address, ZERO_TAG], `rm:${entry.address}`)
                            .then((ok) => ok && data.refresh());
                        }}
                        className="legend underline decoration-ink-soft/40 underline-offset-2 transition-colors enabled:hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ color: "var(--color-estop-ink)" }}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {write.pendingKey?.startsWith(`tag:${groupTag}`) && (
                <div className="mt-3">
                  <WriteStatus
                    status={write.status}
                    error={write.error}
                    txHash={write.txHash}
                    doneLabel="Category updated"
                  />
                </div>
              )}
            </section>
          );
        })
      )}

      {/* --- Add ----------------------------------------------------------- */}
      <section>
        <h2 className="legend text-placard/70">Add a counterparty</h2>

        <form onSubmit={addCounterparty} className="m-panel mt-4 flex flex-col gap-5 px-5 py-5">
          <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
            <div>
              <label htmlFor="cp-address" className="legend text-placard/70">
                Address
              </label>
              <input
                id="cp-address"
                value={address}
                disabled={!canWrite || busy}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="0x…"
                className="m-well mt-2 w-full px-3 py-2.5 font-mono text-body text-placard placeholder:text-placard/25 disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="cp-tag" className="legend text-placard/70">
                Category
              </label>
              <input
                id="cp-tag"
                value={tag}
                disabled={!canWrite || busy}
                onChange={(event) => setTag(event.target.value)}
                placeholder="vendor"
                className="m-well mt-2 w-full px-3 py-2.5 font-mono text-body text-placard placeholder:text-placard/25 disabled:opacity-50"
              />
            </div>
          </div>

          {formError && (
            <p className="legend text-estop" role="alert">
              {formError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={!canWrite || busy}
              className="legend px-5 py-3 text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              style={{ backgroundColor: "var(--color-hazard)" }}
            >
              Add counterparty
            </button>
            {(write.pendingKey === "add" || write.pendingKey?.startsWith("rm:")) && (
              <WriteStatus
                status={write.status}
                error={write.error}
                txHash={write.txHash}
                doneLabel="Allowlist updated"
              />
            )}
          </div>

          <p className="legend text-placard/40">
            A new category starts disabled. Enable it above before the agent can pay anyone in it.
          </p>
        </form>
      </section>
    </div>
  );
}
