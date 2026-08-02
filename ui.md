# UI spec — what's built, what's wired, what's missing

Data and routes only — no animation or styling direction, since that part is yours. Every field
listed below already exists and is live; nothing here requires new backend work except where noted.

## 1. What exists today

| Route | Shows | Fed by |
|---|---|---|
| `/` (marketing) | Landing hero, live switch demo | `useKillSwitch`, `useFreeze` (`hero.tsx`) |
| `/how-it-works` | Static explainer | — |
| `/sign-in` | Owner wallet connect, owner check | `useWalletConnection`, `useFreeze`, `useKillSwitch` |
| `/demo` | Judge-facing staged demo | `useKillSwitch`, `useFreeze` (`demo-stage.tsx`) |
| `/console` | Overview: gauge, ticker, payments rail | `useConsole` → `useKillSwitch` + `useFreeze` |
| `/console/policy` | Per-tx/rolling caps, throttle, pause | same |
| `/console/counterparties` | Allowlist | `state.allowlist` |
| `/console/sessions` | Agent session key + owner key separation | `agentSessionKey` |
| `/console/review` | Held invoices, approve/reject | `reviewItems`, `useAgent` |
| `/console/activity` | Tx attempts + policy events | `attempts`, `events` |

The freeze control lives in `console-shell.tsx`'s header, on every console route — not its own
page. `ConsoleDataProvider` (`components/console-data.tsx`) mounts `useKillSwitch` and `useFreeze`
once and shares them via `useConsole()`, so no page should call either hook directly.

## 2. Available but unrendered data

Everything below is already returned by `useKillSwitch()` (`client/lib/use-kill-switch.ts`) and
pushed live over `/api/stream` (SSE events: `tx`, `policy`, `decision`, `review`, `state`, `notice`).
None of it requires a new endpoint — only a UI to read it.

**`decisions: Decision[]`** — one row per agent tick, whether or not it paid anything:
```ts
{ runId, tick, mode, provider, model, reasoning, toolCalls: ToolCallRecord[], createdAt }
```
`provider`/`model` show which LLM served the tick (failover visibility). `toolCalls` is the ordered
list of tools the agent invoked before deciding — this is the "agent live trace."

**`reviewItems: ReviewItem[]`** — invoices held for a human:
```ts
{ runId, invoiceId, vendor, address, amount, reason, status: "pending"|"approved"|"rejected", createdAt, updatedAt }
```
Already rendered at `/console/review` via `components/agent/review-queue.tsx`, including the
required soft-control framing copy and a visible failure alert if a decision doesn't reach the
agent. Nothing further needed here except linking it into section 2 below.

**`attempts: TxAttempt[]`** — every on-chain leg:
```ts
{ runId, tick, txHash, legIndex, from, to, vendor, amount, status, /* decoded block reason */ }
```

**Join key for everything above: `runId` + `tick`.** A `Decision` at tick N and the `TxAttempt`(s)
it produced share both fields — this is what makes "agent decided X, chain did Y" renderable as one
row instead of two unrelated tables.

**Agent service** (`server/main.py`, base `http://localhost:8000`, consumed via a small `useAgent`
hook — check `client/lib/use-agent.ts` for the current wrapper):

- `GET /agent/status` — `{ running, mode, tick, providers, sessionKey, sessionKeyEth, wallet, chainId, policy: { paused, throttleBps, perTxCapUsdc, rollingCapUsdc, spentUsdc, remainingUsdc, balanceUsdc } }`
- `GET /agent/stream` — SSE of live agent events as they happen (separate connection from `/api/stream`; that one is the Mongo-backed dashboard feed, this one is the agent process itself)
- `POST /agent/start` / `POST /agent/stop` / `POST /agent/mode` — control
- `GET /agent/review`, `POST /agent/review/{invoiceId}/approve|reject` — same queue as `reviewItems`, but decisions go here, not to Mongo (the queue is authoritative in the agent process's memory)
- `GET /agent/threat`, `GET /agent/watchdog` — status of the compromised-prompt / rogue-script demo paths, if you want to surface which attack variant is armed

## 3. Sections to add

Priority order — highest leverage first.

### 3.1 Agent live trace
**Serves:** Requirement 4 ("agent running unsupervised"). **Why it matters:** right now the site
shows a wallet refusing transactions, not an agent being refused — this is the fix.
**Data:** `decisions[]`, most recent first; `provider`/`model` badge; `reasoning` as prose;
`toolCalls[]` as an ordered list.
**States:** empty (agent hasn't run this session), loading, offline (`/agent/status` unreachable —
distinct from `indexerStale`, which is a Mongo problem, not an agent problem).
**One sentence a judge should think:** "this is a model actually reasoning turn by turn, not a
script."

### 3.2 Decision → outcome pairing
**Serves:** Enforcement layer, attack resistance — the single most persuasive view the product can
show, and it doesn't exist yet.
**Data:** join `decisions[]` (by `runId`+`tick`) against `attempts[]` filtered to the same key.
A tick with no matching attempt means the agent decided not to pay (held for review, or declined
outright) — pair it with the matching `reviewItems` row by `invoiceId` if one exists.
**States:** a tick can have zero, one, or several attempts (a `payBatch` tick has multiple legs
under one `runId`+`tick`, distinguished by `legIndex`).
**One sentence:** "the agent decided to pay `0xBAD…`; the chain refused it."

### 3.3 Agent status strip
**Serves:** Requirement 4, kill-switch reliability. **Why:** "unsupervised" has to be visibly true,
and provider failover (a real reliability feature) is currently invisible.
**Data:** `running`, `mode`, `tick`, `providers` (which LLM is active/available), `sessionKeyEth`
(is the agent's signer funded?), start/stop buttons wired to `/agent/start` / `/agent/stop`.
**States:** agent process unreachable (different from "not started" — surface both distinctly).

### 3.4 Review queue framing
**Status:** built (`components/agent/review-queue.tsx`), rendered at `/console/review`. Nothing to
add — listed here only so the soft-control language requirement is documented in one place: this
must never read as the safety mechanism. A compromised agent simply would not use it; an approved
invoice can still be refused on-chain.

### 3.5 Invoice queue
**Serves:** real-world plausibility — makes the AP workflow legible.
**Data:** whatever the agent is currently working from (check `/agent/status` or a dedicated
invoice-listing endpoint if one exists — not confirmed as separately exposed; `reviewItems` only
covers invoices that were *held*, not the full queue the agent is processing).

### 3.6 Honest degraded states
**Serves:** polish. **Data:** `deployed` (no contract found), `indexerStale` (Mongo indexer quiet),
agent-service unreachable (distinct from both). Three different failure modes, three different
messages — don't collapse them into one generic "offline."

### 3.7 Scenario C trigger — freeze mid-flight
**Serves:** Requirement 3 + bonus (in-flight revocation), made demoable through the UI instead of
only the API. **Status:** implemented server-side, not yet wired to any button.
**Endpoint:** `POST /demo/scenario/c` (`server/main.py:339-402`), body `{ legs?: number }` (default
3). Fires sequential on-chain payments roughly 20s apart and returns immediately with a note to hit
freeze on the dashboard while it's running — the remaining legs then revert.
**Data to show:** a running/idle state for the scenario, which leg it's on, and a live count of
legs-completed vs. legs-remaining so freezing mid-run has a visible "before" and "after."
**One sentence:** "I can stop this while it's still running — not before it starts, not after it
finishes."

---

**Standing framing note:** the review queue and the agent's own caution are soft controls and must
never be presented as the safety mechanism. If a judge leaves believing the agent's good judgement
is what protects the money, the demo has failed — the contract is the control, and section 3.2 is
what makes that legible.
