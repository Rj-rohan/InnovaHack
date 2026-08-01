# UI — what exists, and what still needs building

A build spec at the level of **sections and the data behind them**. No styling or animation
direction — that's yours. Every data source listed here already exists; nothing on the backend needs
building to render any of it.

---

## The one-sentence framing

The site currently proves **the wallet refuses bad payments**. It does not show **an agent being
refused**. Requirement 4 of the problem statement is *"a demo showing the agent running
unsupervised, attempting to exceed its policy, and being blocked"* — the site delivers the second
half of that sentence and not the first.

Everything below is in service of closing that.

---

## 1. What exists today

| Route | Shows | Fed by |
|---|---|---|
| `/` | Hero, live spend gauge, E-stop | `useConsole()` → `useKillSwitch()` |
| `/how-it-works` | Static explainer | — |
| `/demo` | Judge stage: scenario A/B/C buttons, trace, E-stop | `DemoStage` → agent service directly |
| `/console` | Overview: policy state, recent attempts | `useConsole()` |
| `/console/policy` | Caps, throttle, owner writes | `useConsole()` + `useOwnerWrite()` |
| `/console/counterparties` | Allowlist, add/remove | same |
| `/console/sessions` | Session key, grant/revoke | same |
| `/console/activity` | Payment attempts feed | same |

Shared components: `Estop`, `Gauge`, `Ticker`, `LockoutTag`, `ConnectButton`, `WriteStatus`,
`Reveal`, `ConsoleData` (context provider).

---

## 2. Data that already exists and is rendered nowhere

This is the gap. All of it is live right now.

### From `useKillSwitch()` — already in the hook, already in `/api/state`

```ts
decisions: Decision[]      // NOT RENDERED ANYWHERE
reviewItems: ReviewItem[]  // NOT RENDERED ANYWHERE
```

```ts
interface Decision {
  runId: string;
  tick: number;
  mode: "normal" | "injected" | "rogue";
  provider: string | null;   // "gemini" | "groq" — which model served this tick
  model: string | null;      // e.g. "gemini-2.5-flash"
  reasoning: string;         // the agent's own words, 2-3 sentences
  toolCalls: {
    name: string;            // get_wallet_state | list_pending_invoices | match_purchase_order
                             // check_duplicate | get_vendor_history | simulate_payment
                             // send_payment | hold_for_review
    args: Record<string, unknown>;
    result: string;          // JSON string, truncated to 1000 chars
  }[];
  createdAt: Date;
}

interface ReviewItem {
  runId: string;
  invoiceId: string;
  vendor: string;
  address: string;
  amount: string;            // base units, 6dp — use formatFixed6()
  reason: string;            // the agent's plain-language explanation
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}
```

`TxAttempt` (already rendered in `Ticker`) carries `runId` and `tick` — **that is the join key to
`Decision`.** Section 4 depends on it.

### Live events — `GET /api/stream` (SSE, already wired)

Event names: `snapshot`, `tx`, `policy`, `decision`, `review`, `state`, `notice`.
`useKillSwitch()` already subscribes; `decisions` and `reviewItems` update live.

### From the agent service (`NEXT_PUBLIC_AGENT_URL`, default `http://localhost:8000`)

| Endpoint | Use |
|---|---|
| `GET /agent/status` | `running`, `mode`, `tick`, `lastProvider`, `lastError`, `sessionKey`, `sessionKeyEth`, `policy{...}` |
| `POST /agent/start` · `/agent/stop` | Run control |
| `POST /agent/mode` | `{"mode": "normal" \| "injected" \| "rogue"}` |
| `GET /agent/stream` | SSE of the agent thinking — see below |
| `GET /agent/review` | Current review queue |
| `POST /agent/review/{invoiceId}/approve` \| `/reject` | Owner decision |

**`GET /agent/stream` events** (sub-second, ephemeral — the live trace):

`tick_start` · `world_generated` · `injection_armed` · `reasoning` · `tool_call` · `tool_result` ·
`payment` · `hold` · `review_resolved` · `provider_failover` · `time_travel` · `rogue` · `error` ·
`tick_end`

Each arrives as `{ event, data, at }`.

> The dashboard's `/api/stream` carries **persisted chain state**. The agent's `/agent/stream`
> carries **the agent thinking out loud** and is deliberately not stored. Use the second for the
> live trace, the first for history.

---

## 3. Agent live trace — **highest priority**

**Serves:** Requirement 4. **Why:** the single biggest gap. Turns "a wallet" into "an agent being
governed".

**Data:** `GET /agent/stream` for live, `decisions[]` for history on load.

**Must show, per tick:**
- Tick number and mode (`normal` / `injected` / `rogue`)
- Which provider and model served it — this is where provider failover becomes visible
- The agent's `reasoning` verbatim
- The ordered `toolCalls`: name, key arguments, and the salient part of the result

**Tool-call rendering matters more than it sounds.** Showing that the agent called
`match_purchase_order` → `check_duplicate` → `get_vendor_history` → `hold_for_review` *in that
order* is what makes it legible as an agent rather than a random payment generator. A collapsed
one-line-per-call list with the result expandable is enough.

**States:** loading · empty ("agent has not run yet") · agent offline (fall back to `decisions[]`
from the database and say the live feed is unavailable).

**Watch for:** `reasoning` is sometimes empty — the model occasionally calls tools without
narrating. Render the tool calls anyway rather than an empty card.

---

## 4. Decision → outcome pairing — **highest impact**

**Serves:** enforcement layer, attack resistance. **Why:** the most persuasive view the product can
show, and it does not exist anywhere today.

**Data:** join `decisions[]` and `attempts[]` on `runId` + `tick`.

**Must render, adjacent:**

```
AGENT DECIDED          →   CHAIN RULED
"Pay 38.00 mUSDC           REVERTED
 to 0x7a3f… for            CounterpartyNotAllowed(0x7a3f…)
 INV-9902, overdue"        Block 4,102
```

The two halves must be visually simultaneous. This is the entire thesis of the project in one row:
the agent's intent and the chain's independent verdict, side by side, with the verdict clearly not
coming from the agent.

Use `explainReason()` from `lib/format.ts` — it already returns strings phrased as
*"Blocked on-chain — recipient is not on the allowlist"*, which puts the location of the decision in
the sentence.

**Empty state:** before anything is blocked, show the successful pairs. A confirmed payment next to
`PaymentExecuted` still demonstrates the mechanism.

---

## 5. Agent status strip

**Serves:** Requirement 4, kill-switch reliability. **Why:** "unsupervised" has to be visibly true;
right now there is no way to see the agent is even alive.

**Data:** `GET /agent/status`, polled every ~3s. Live updates via `/agent/stream`.

**Must show:** running / stopped · mode · current tick · provider serving · session-key address and
its ETH balance · `lastError` when present.

**Controls:** start · stop · mode switch.

**Two details worth surfacing:**
- **Session-key ETH at zero** means every payment will fail for a boring reason. Say so explicitly.
- **`lastProvider` changing** is provider failover happening live. Judges find that impressive
  rather than embarrassing — don't hide it.

---

## 6. Review queue

**Serves:** real-world plausibility. **Why:** the entire AP workflow is currently invisible.

**Data:** `reviewItems[]` (live via `/api/stream` `review` events).
**Actions:** `POST {AGENT_URL}/agent/review/{invoiceId}/approve` | `/reject`.

**Must show:** invoice id · vendor · amount (`formatFixed6`) · the agent's `reason` verbatim ·
status · approve/reject for pending items.

> **Framing requirement — this one is not cosmetic.** The review queue is a **soft** control: it is
> the agent choosing to defer, and a compromised agent simply would not use it. It must be visually
> and verbally distinct from the contract's controls. If a judge leaves believing the agent's own
> caution is what protects the money, the demo has failed. A one-line caption saying the contract is
> what actually stops a payment, and this is only the agent asking for help, is enough.

**After approval:** the agent settles it on its next tick — but it may still be refused on-chain if
it exceeds a cap. That is correct and worth showing: a human approving something does not override
the contract.

---

## 7. Invoice queue

**Serves:** plausibility. **Why:** cheap, and it makes the AP workflow legible.

**Data:** from `list_pending_invoices` tool results inside `decisions[].toolCalls`, or add a small
read endpoint if you'd rather not parse tool output.

**Must show:** invoice id · vendor · amount · purchase-order reference · status
(`pending` / `paid` / `held` / `approved`).

**Worth a caption:** the queue is generated fresh by an LLM each run — vendors, amounts, invoice
numbers and memo text. Run the demo twice and it is a different book of business. That is a claim
worth making explicitly on screen, because it pre-empts "is this staged?".

---

## 8. Degraded states

**Serves:** polish. **Why:** replaces the operator instructions that were removed from `hero.tsx`
and the console.

Three cases, each needing an honest, non-technical line:

| Case | Detect with | Tone |
|---|---|---|
| No deployment | `data.deployed === false` | "No wallet under management." Never a shell command. |
| Indexer stale | `data.indexerStale === true` | Say the figures may be behind. A dashboard silently showing stale *safety limits* is worse than one that admits it. |
| Agent offline | `GET {AGENT_URL}/health` fails | The chain view still works; say the live trace is unavailable rather than showing an empty panel. |

---

## Suggested placement

Sections 3–5 are the demo. They belong where a judge lands: `/demo`, or a new `/console/agent`
linked prominently. Sections 6–7 fit the console. Section 8 is everywhere.

If you only build one thing, build **section 4**. It is the project's argument in a single row.

---

## Copy that must not appear anywhere user-facing

Shell commands, file paths, `npm run …`, environment variable names, "deploy the contracts",
"start the indexer". All of that belongs in `SETUP.md`. It was removed from `hero.tsx`,
`app/(console)/console/page.tsx` and `app/api/state/route.ts` — please don't let it back in.
