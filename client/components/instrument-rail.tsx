"use client";

import { Gauge } from "@/components/gauge";
import type { KillSwitchData } from "@/lib/use-kill-switch";
import { formatFixed2, shortenAddress } from "@/lib/format";

/**
 * The readings, beside the switch.
 *
 * Fills the right of the hero with the thing the page is actually claiming: these are not
 * marketing figures, they are contract storage read back a second ago. A visitor can check the
 * cap here and watch a payment get refused against it further down the page.
 *
 * Sits inside `.desat`, so a freeze drains the colour out of the readings while the E-stop stays
 * vivid — the instrument panel goes dead, the control does not.
 */
export function InstrumentRail({ data, paused }: { data: KillSwitchData; paused: boolean }) {
  const state = data.state;

  if (!data.deployed || !state) {
    return (
      <div className="m-panel px-5 py-5">
        <p className="legend text-hazard">No readings</p>
        <p className="mt-2 text-body text-placard/65">
          Deploy the contracts and start the indexer; this panel fills itself in.
        </p>
      </div>
    );
  }

  const throttled = state.throttleBps < 10000;
  const payable = state.allowlist.filter((entry) => entry.enabled).length;

  const status = paused ? "Frozen" : throttled ? "Throttled" : "Running";
  const lamp = paused ? "led-stopped" : throttled ? "led-caution" : "led-running";
  const statusNote = paused
    ? "Every payment reverts"
    : throttled
      ? `${(state.throttleBps / 100).toFixed(0)}% of full limits`
      : "Operating within policy";

  return (
    <div className="m-panel px-5 py-5">
      <div className="flex items-center gap-2.5">
        <span className={`led ${lamp}`} aria-hidden="true" />
        <p className="heading text-lead leading-none text-placard">{status}</p>
      </div>
      <p className="legend mt-2 text-placard/45">{statusNote}</p>

      <hr className="rule-engraved my-5" />

      <Gauge spent={state.spentInWindow} cap={state.rollingCap} paused={paused} />

      <hr className="rule-engraved my-5" />

      <dl className="flex flex-col gap-2.5">
        <Reading label="Per transaction" value={formatFixed2(state.perTxCap)} />
        <Reading label="Balance" value={formatFixed2(state.balance)} />
        <Reading label="Payable parties" value={`${payable} of ${state.allowlist.length}`} />
        {data.agentSessionKey && (
          <Reading label="Agent key" value={shortenAddress(data.agentSessionKey)} />
        )}
      </dl>
    </div>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="legend text-placard/45">{label}</dt>
      <dd className="tnum font-mono text-legend text-placard/85">{value}</dd>
    </div>
  );
}
