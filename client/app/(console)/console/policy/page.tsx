"use client";

import { useState } from "react";
import { useConsole } from "@/components/console-data";
import { Gauge } from "@/components/gauge";
import { OwnerNotice, WriteStatus } from "@/components/write-status";
import { formatFixed6, parseAmount } from "@/lib/format";
import { useOwnerWrite } from "@/lib/use-owner-write";

/**
 * Throttle presets.
 *
 * Basis points are the contract's unit, not the owner's. The control shows percentages and, next
 * to each, the caps that percentage produces — the owner decides on consequences rather than on
 * arithmetic.
 */
const THROTTLES = [
  { bps: 10000, label: "Full", note: "Normal operation" },
  { bps: 5000, label: "50%", note: "Halved while you look into something" },
  { bps: 1000, label: "10%", note: "Small payments only" },
  { bps: 100, label: "1%", note: "Barely moving, but still alive" },
  { bps: 0, label: "0%", note: "Every payment fails the cap check" },
];

export default function PolicyPage() {
  const { data, freeze, paused } = useConsole();
  const write = useOwnerWrite(data.contracts?.agentWallet);
  const state = data.state;

  const [perTx, setPerTx] = useState("");
  const [rolling, setRolling] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const canWrite = freeze.isOwner;
  const busy = write.status === "signing" || write.status === "pending";
  const throttleBps = state?.throttleBps ?? 10000;

  async function submitLimits(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const nextPerTx = parseAmount(perTx);
    const nextRolling = parseAmount(rolling);

    if (nextPerTx === null || nextRolling === null) {
      setFormError("Enter both caps as plain amounts, up to six decimal places.");
      return;
    }
    if (nextPerTx > nextRolling) {
      setFormError("The per-transaction cap cannot exceed the 24-hour cap.");
      return;
    }

    const ok = await write.send("setLimits", [nextPerTx, nextRolling], "limits");
    if (ok) {
      setPerTx("");
      setRolling("");
      data.refresh();
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-9">
      <header>
        <h1 className="heading text-panel text-placard">Policy</h1>
        <p className="mt-2 max-w-xl text-body text-placard/65">
          Caps are stored in the contract and re-read on every payment, including every leg of a
          batch. Changing them here takes effect on the agent&apos;s next attempt.
        </p>
      </header>

      <OwnerNotice connected={freeze.connected} isOwner={freeze.isOwner} owner={data.owner} />

      {state && (
        <section className="m-panel px-6 py-6">
          <Gauge spent={state.spentInWindow} cap={state.rollingCap} paused={paused} />
        </section>
      )}

      {/* --- Throttle ------------------------------------------------------ */}
      <section>
        <h2 className="legend text-placard/70">Throttle</h2>
        <p className="mt-2 max-w-xl text-body text-placard/60">
          Scales both caps without losing their configured values — the middle setting between
          full access and a freeze.
        </p>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {THROTTLES.map((option) => {
            const active = throttleBps === option.bps;
            const effective = state
              ? (BigInt(state.perTxCap) * BigInt(option.bps)) / BigInt(throttleBps || 10000)
              : null;

            return (
              <button
                key={option.bps}
                type="button"
                disabled={!canWrite || busy || active}
                onClick={() => void freeze.throttle(option.bps)}
                className={`m-panel px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed ${
                  active ? "" : "enabled:hover:bg-enamel-lo"
                } ${!canWrite ? "opacity-60" : ""}`}
                style={active ? { boxShadow: "inset 0 0 0 2px var(--color-hazard)" } : undefined}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="heading text-lead leading-none text-placard">
                    {option.label}
                  </span>
                  {active && <span className="legend text-hazard">Current</span>}
                </span>
                <span className="legend mt-2 block text-placard/45">{option.note}</span>
                {effective !== null && (
                  <span className="tnum mt-1.5 block font-mono text-legend text-placard/60">
                    {formatFixed6(effective)} per tx
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <WriteStatus
            status={freeze.status === "done" ? "done" : freeze.status}
            error={freeze.error}
            txHash={freeze.txHash}
            doneLabel="Throttle updated"
          />
        </div>
      </section>

      {/* --- Caps ---------------------------------------------------------- */}
      <section>
        <h2 className="legend text-placard/70">Base caps</h2>
        <p className="mt-2 max-w-xl text-body text-placard/60">
          The unthrottled values. The agent never sees these — it only ever meets the effective
          cap at execution time.
        </p>

        <form onSubmit={submitLimits} className="m-panel mt-5 flex flex-col gap-5 px-5 py-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="per-tx"
              label="Per transaction"
              current={state?.perTxCap}
              value={perTx}
              onChange={setPerTx}
              disabled={!canWrite || busy}
            />
            <Field
              id="rolling"
              label="Rolling 24 hours"
              current={state?.rollingCap}
              value={rolling}
              onChange={setRolling}
              disabled={!canWrite || busy}
            />
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
              Save caps
            </button>
            {write.pendingKey === "limits" || write.status === "error" ? (
              <WriteStatus
                status={write.status}
                error={write.error}
                txHash={write.txHash}
                doneLabel="Caps saved"
              />
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({
  id,
  label,
  current,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  current?: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="legend text-placard/70">
        {label}
      </label>
      <p className="tnum mt-1.5 font-mono text-legend text-placard/45">
        Now {current ? formatFixed6(current) : "—"} mUSDC
      </p>
      <input
        id={id}
        inputMode="decimal"
        placeholder="0.000000"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="m-well mt-2 w-full px-3 py-2.5 font-mono text-body text-placard placeholder:text-placard/25 disabled:opacity-50"
      />
    </div>
  );
}
