# The Kill Switch — Feature Acceptance Pipeline

An end-to-end walkthrough that proves **every feature works**, mapped one-to-one onto the
requirements in [kill_switch_features.txt](kill_switch_features.txt). Work top to bottom and tick
as you go; each check states what you should see, so a wrong result is obvious.

**How this differs from the other two documents** — they overlap deliberately, so use the right one:

| Document | Use it for |
|---|---|
| [SETUP.md](SETUP.md) | Installing, API keys, the three `.env` files, troubleshooting. Read it **first, once**. |
| [RUNBOOK.md](RUNBOOK.md) | How each demo scenario works internally, and design decisions judges probe. |
| **features.md** (this) | Proving each requirement is met, and what to click. The pre-demo pass. |

---

## Part 0 — Cold start

Five terminals. Full detail in [SETUP.md §3–5](SETUP.md); this is the short form for a machine
that is already configured.

```sh
# 1  chain
cd contracts && npm run node

# 2  contracts → writes deployments/31337.json
cd contracts && npm run deploy:local

# 3  copy addresses + ABI into the app, then start it
cd client && npm run sync:chain && npm run db:init && npm run dev

# 4  indexer — follows chain events into Mongo
cd client && npm run indexer

# 5  agent
cd server && uvicorn main:app --reload --port 8000
```

- [ ] `http://localhost:3000` loads
- [ ] `curl localhost:8000/health` → `{"ok": true}`

**Order matters in one place only:** `sync:chain` must run *after* `deploy:local`, or the app is
pointed at a contract that no longer exists.

---

## Part 1 — Is everything talking?

| # | Check | Expected |
|---|---|---|
| 1.1 | `curl localhost:3000/api/state` | `"deployed": true`, real contract addresses |
| 1.2 | Same response | `"historyAvailable": true` — Mongo reachable |
| 1.3 | Same response | `"indexerHealthy": true` — terminal 4 is running |
| 1.4 | `curl localhost:8000/agent/status` | `"running"`, `"tick"`, `"sessionKey"`, a non-zero `sessionKeyEth` |

- [ ] All four pass

> **1.4 matters more than it looks.** A session key with **zero ETH** makes every payment fail
> before policy is ever consulted — which looks exactly like the contract refusing something, and
> will mislead you for twenty minutes. The console says so explicitly if it happens.

---

## Part 2 — Requirement 1: policy enforced by the contract

*"Spend limits written into the contract, not the agent's prompt."*

| # | Do | Expect |
|---|---|---|
| 2.1 | Open `/console/policy` | Per-tx cap **40.000000**, rolling cap **100.000000** — read from chain, not config |
| 2.2 | Connect the owner wallet, change the per-tx cap to `25`, save | MetaMask prompts; the figure updates after confirmation |
| 2.3 | Set it back to `40` | Same |
| 2.4 | Run scenario A twice on `/demo` (each ~38 mUSDC) | Second one refused with `RollingCapExceeded` once the 100 cap is crossed |

- [ ] The cap is enforced by the chain, not by the agent choosing to respect it

**Proof it isn't the agent deciding:** the refusal in 2.4 appears as a reverted transaction on
chain, with a typed error. Nothing in the agent's code chose that outcome.

---

## Part 3 — Requirement 2: allowlisted counterparties

| # | Do | Expect |
|---|---|---|
| 3.1 | `/console/counterparties` | Three vendors, grouped by category (`vendor`, `gas`) |
| 3.2 | Press **Disable all vendor** | Whole category flips to Blocked in one transaction |
| 3.3 | Run scenario A | Refused — `CounterpartyNotAllowed` |
| 3.4 | Re-enable the category, run A again | Succeeds |
| 3.5 | Add any address with a new category name | Arrives **disabled** — a new category is not payable until enabled |

- [ ] Address-level and category-level blocking both work

3.2 and 3.5 are the bonus from the feature plan: approve or revoke a *group*, not one address at
a time.

---

## Part 4 — Requirement 3: the owner kill switch

| # | Do | Expect |
|---|---|---|
| 4.1 | On `/` with no wallet connected, look at the switch | Cap reads **Connect**, collar desaturated — it names what holding it does |
| 4.2 | Hold it | The wallet opens |
| 4.3 | Once connected | Cap reads **Stop** |
| 4.4 | Hold 0.6s | MetaMask prompts `pause()`; on confirmation the page drains of colour and a lockout tag appears |
| 4.5 | Run any scenario while frozen | Refused — `WalletPaused` |
| 4.6 | Hold the switch again (1.2s this time) | Releases. Freezing is instant; resuming is deliberate |
| 4.7 | Connect a **non-owner** wallet and hold | Reverts with `NotOwner()` — the caption warns you first |

- [ ] Only the owner can freeze, and the freeze actually blocks payments

**4.7 is worth doing.** It demonstrates that the button is not what enforces ownership — the
contract is.

### Throttle — the setting between running and frozen

| # | Do | Expect |
|---|---|---|
| 4.8 | `/console/policy` → set throttle to **1%** | Effective cap drops to 0.400000; the agent keeps running |
| 4.9 | Run scenario A | Refused on the per-tx cap while still alive |
| 4.10 | Return to **Full** | Normal operation resumes |

- [ ] Throttle works without a full stop

---

## Part 5 — Requirement 4: an agent running unsupervised

This is the half that is easy to under-demonstrate. The point is not that a wallet refuses
payments — it is that **an agent is being refused**.

| # | Do | Expect |
|---|---|---|
| 5.1 | `/demo` → **Start agent** | Status goes Running; tick counter climbs on its own |
| 5.2 | Watch **Reasoning** | Per tick: the agent's own words, then its ordered tool calls |
| 5.3 | Expand a tool call | The result JSON. The *order* — `match_purchase_order → check_duplicate → get_vendor_history` — is what makes it an agent rather than a payment generator |
| 5.4 | Watch **Decided, then ruled on** | Agent's intent on the left, chain's verdict on the right, side by side |

- [ ] The agent runs with nobody touching it
- [ ] Its reasoning and tool calls are visible
- [ ] Its intent and the chain's verdict appear together

### The three scenarios

| # | Scenario | Expect |
|---|---|---|
| 5.5 | **A — normal** | Pays an allowlisted vendor. `PaymentExecuted` |
| 5.6 | **B — attack** | A poisoned invoice aims the agent at an unapproved address. Reverted, `CounterpartyNotAllowed`. Attacker balance stays zero |
| 5.7 | **B, model declines** | If the model refuses the injection, the page automatically runs the rogue variant — same refusal, no model in the loop at all |
| 5.8 | **C — freeze mid-flight** | Start it, then hold the switch between legs. Earlier legs stay paid; the rest never happen |

- [ ] All three behave as described

**5.7 is the strongest answer to "did you just prompt it to fail?"** — the rogue path removes the
model entirely and the contract's answer is identical.

---

## Part 6 — Bonus: in-flight revocation

| # | Do | Expect |
|---|---|---|
| 6.1 | Start scenario C | A multi-leg run begins |
| 6.2 | Mid-run, `/console/sessions` → **Revoke session key** | Confirm dialog states the consequence |
| 6.3 | Watch the run | Stops at the next leg — `SessionInvalid` |

- [ ] Permission can be pulled from a run already underway

The per-leg check inside a single `payBatch` transaction is proven by the contract test suite
(Part 9) — a 12-second chain cannot show it live, which is the honest reason it is tested there.

---

## Part 7 — The review queue (a soft control)

| # | Do | Expect |
|---|---|---|
| 7.1 | Let the agent hit an anomalous invoice | It ends `held`, zero payments, with a readable reason |
| 7.2 | `/console/review` | The item, the agent's own explanation, Approve / Reject. Rail lamp turns amber |
| 7.3 | Approve it | Settles on the agent's next tick |
| 7.4 | Set the cap below the invoice amount, then approve another | **Still refused on chain** |

- [ ] 7.4 passes

> **Say this out loud in the demo.** The review queue is the agent *choosing* to defer — a
> compromised agent would simply not use it. Approving something here does not override a cap.
> The page says so; make sure a judge hears it too.

---

## Part 8 — Degraded states

Robustness is a feature here, because the demo runs on someone else's wifi.

| # | Kill | Expect |
|---|---|---|
| 8.1 | Stop the agent (terminal 5) | `/demo` says the agent is unreachable; chain history still renders; the trace replays recorded runs |
| 8.2 | Stop the indexer (terminal 4) | Console warns figures may be behind — it does not silently show stale caps |
| 8.3 | Stop Mongo | Site still loads, **and the kill switch still works** |
| 8.4 | Open `/` with no wallet extension | Switch reads Connect, header offers "Install a wallet" |

- [ ] All four degrade honestly

> **8.3 is the important one.** The owner's ability to freeze must never depend on the database.
> The contract address comes from the deployment file, not from Mongo.

---

## Part 9 — Automated suites

```sh
cd contracts && npm test                       # 24 passing
cd server && python smoke_test.py              # 10 checks
cd client && npm run typecheck && npm run lint && npm run build
```

- [ ] Contracts green
- [ ] Agent smoke green
- [ ] Client types, lint and build clean

Restart the indexer twice and confirm **zero** duplicate `policy_events` — the unique
`(txHash, logIndex)` index is what prevents double-counted refusals.

---

## Part 10 — Every screen

| Route | Shows |
|---|---|
| `/` | Landing: live switch, instrument readings, the six checks, contrast |
| `/how-it-works` | Why `pay()` reverts but `payBatch()` reports; why the owner bypasses the freeze |
| `/sign-in` | Owner access — wallet is the credential, no accounts |
| `/demo` | Agent status, scenarios, reasoning, decision/verdict pairs |
| `/console` | Policy state, freeze, recent attempts |
| `/console/policy` | Caps and throttle |
| `/console/counterparties` | Allowlist and categories |
| `/console/sessions` | Session key, revoke |
| `/console/review` | Held invoices |
| `/console/activity` | Full log, filterable by `BlockReason` |

- [ ] All ten load; the freeze is reachable from every console route

---

## Part 11 — Three minutes before you present

The short version. If only this passes, you can still demo.

1. [ ] All five terminals up; `/api/state` shows `deployed`, `historyAvailable`, `indexerHealthy`
2. [ ] Session key has ETH
3. [ ] Owner wallet connected in MetaMask, on the right network
4. [ ] Caps at 40 / 100, all counterparties enabled, wallet **not** paused, throttle Full
5. [ ] Scenario A succeeds
6. [ ] Scenario B is refused
7. [ ] Freeze and release both work from `/`
8. [ ] `/demo` shows at least one decision/verdict pair

**If something breaks mid-demo:** every claim survives without the agent. Chain history, the
console and the freeze all keep working — fall back to `/console/activity` and walk the recorded
refusals.

---

## What is deliberately not built

Named so nobody goes looking:

- **Invoice queue** — the pending-invoice list is visible inside tool-call results on `/demo`, but
  has no page of its own. Parsing tool output for it was the most fragile part of the spec for the
  least argument.
- **Time travel** has no button. It is curl-only and guarded to chain 31337, because advancing the
  clock is a dev-chain capability, not a product feature.
- **Multisig owner.** The contract takes a single owner address. A Safe would work unchanged, but
  it is not wired up.
