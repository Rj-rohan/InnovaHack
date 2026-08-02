# New Features — The Kill Switch

All features added beyond the original codebase, in implementation order.

---

## Batch 1 — Core Enforcement Upgrades

### 1. Auto-Freeze on Blocked Streak (Contract)
**File:** `contracts/src/AgentWallet.sol`

The contract now tracks consecutive blocked payment attempts. After 3 consecutive blocks, it pauses itself automatically without any human intervention.

- Added `blockedStreak` counter (uint8, public)
- Added `AUTO_PAUSE_THRESHOLD = 3` constant
- `pay()` and `payBatch()` call `_recordBlock()` on any policy violation
- Successful payment resets `blockedStreak = 0`
- Emits `AutoPaused(streak)` event when self-pausing
- Owner can reset the streak with `resetBlockedStreak()`

**Why:** Answers "what if the owner is asleep?" — the contract detects an attack pattern and stops itself.

---

### 2. Per-Counterparty Spend Cap (Contract)
**File:** `contracts/src/AgentWallet.sol`

Each allowlisted vendor can now have its own rolling 24h spend limit, independent of the global cap.

- Added `counterpartyCap` mapping (address → uint256)
- Added 4-slot per-counterparty ring buffer (`_counterpartySpends`, `_counterpartySpendIdx`)
- Added `CounterpartyCapExceeded` to `BlockReason` enum
- Added `setCounterpartyCap(address, uint256)` owner function (0 = no individual cap)
- Added `counterpartySpent24h(address)` view function
- `_record()` now writes to both the global and per-counterparty ring buffers
- New custom error: `CounterpartyCapExceeded(address to, uint256 attempted, uint256 remaining)`

**Why:** Prevents a compromised agent from draining everything to one allowlisted address.

---

### 3. Threat Snapshot (Contract)
**File:** `contracts/src/AgentWallet.sol`

New view function returning threat state in one RPC call.

```solidity
function threatSnapshot() external view returns (uint8 streak, uint8 threshold, bool autoTriggered)
```

---

### 4. Velocity Attack (Server)
**File:** `server/agent/rogue.py`

New rogue attack mode that sends 5 payments of 19 mUSDC each — each under the 40 mUSDC per-tx cap, but together exceeding the 100 mUSDC rolling cap.

```sh
curl -X POST "localhost:8000/demo/scenario/b-rogue?attack=velocity"
```

**Why:** Proves the rolling window cap is real, not just a per-tx check. Catches drip attacks.

---

### 5. Webhook Alert (Server)
**File:** `server/ingest.py`

`send_alert()` fires a POST to `ALERT_WEBHOOK_URL` when attacks are blocked or the agent goes overdue. Works with Slack incoming webhooks, Discord webhooks, or any HTTP endpoint.

Set in `server/.env`:
```ini
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
```

Triggered by:
- Rogue attack blocked
- Agent watchdog detecting overdue ticks

---

### 6. Threat Monitor Panel (Dashboard)
**File:** `client/app/(console)/console/page.tsx`

Live threat panel on the console overview page, polling `GET /agent/threat` every 5 seconds.

Shows:
- Blocked streak with progress bar (green → amber → red)
- Auto-pause status: **Armed** or **Triggered** (contract self-paused)
- Remaining daily spend + amount spent

---

### 7. Threat Status Endpoint (Server)
**File:** `server/main.py`

```
GET /agent/threat
```

Returns:
```json
{
  "blockedStreak": 1,
  "autoPauseThreshold": 3,
  "autoTriggered": false,
  "paused": false,
  "remainingUsdc": 81.0,
  "spentUsdc": 19.0
}
```

---

### 8. Policy Vocabulary Updates (Client)
**Files:** `client/lib/policy.ts`, `client/scripts/indexer.ts`

- Added `CounterpartyCapExceeded` to `BLOCK_REASONS` array (must match contract enum order)
- Added `CounterpartyCapExceeded` to indexer `ERROR_TO_REASON` map so it decodes correctly in the activity log

---

## Batch 2 — UI, UX and Real-World Plausibility

### 9. Session Key Expiry UI (`/console/sessions`)
**File:** `client/app/(console)/console/sessions/page.tsx`

- Reads `sessions(address)` directly from chain every 10s via `useReadContract`
- Shows **Active / Inactive** status with live expiry countdown
- Expiry label turns amber when < 24h remaining, shows "Expired" when past
- **Grant / Renew session** with duration picker: 1h / 24h / 7d / 30d
- Calls `grantSession(key, expiresAt)` on contract via MetaMask
- Revoke flow unchanged

**Why:** Forces periodic re-authorization. A leaked session key auto-expires. Real-world wallets do this.

---

### 10. Per-Counterparty Cap UI (`/console/counterparties`)
**File:** `client/app/(console)/console/counterparties/page.tsx`

Each vendor row now shows:
- Individual 24h cap (if set)
- Amount spent against that cap in the last 24h
- **Set cap / Edit** inline button — calls `setCounterpartyCap(address, amount)` on contract
- Pass 0 to remove the individual cap

Reads `counterpartyCap` and `counterpartySpent24h` live from chain via `useReadContract`.

---

### 11. Audit Log Export (`/console/activity`)
**Files:** `client/app/api/audit/route.ts`, `client/app/(console)/console/activity/page.tsx`

New API route and download buttons on the activity page.

```
GET /api/audit          → JSON (all tx attempts + policy events)
GET /api/audit?fmt=csv  → CSV download
```

Buttons added to `/console/activity` header:
- **Export CSV** — downloads `killswitch-audit-{timestamp}.csv`
- **Export JSON** — opens full audit record in new tab

**Why:** Real finance systems need tamper-evident audit trails.

---

### 12. Agent Watchdog (`GET /agent/watchdog`)
**File:** `server/main.py`

Detects silent agent crashes without waiting for a missed payment.

```
GET /agent/watchdog
```

Returns:
```json
{
  "running": true,
  "lastTickAt": "2024-01-01T12:00:00Z",
  "secondsSinceTick": 12.3,
  "expectedIntervalSeconds": 8,
  "overdue": false,
  "lastError": null
}
```

- `overdue: true` when running but hasn't ticked in 3× the expected interval
- Fires webhook alert when overdue
- `lastTickAt` tracked in `AgentState` and updated after every tick

---

### 13. Scenario F — Session Key Expiry Mid-Run
**Files:** `server/main.py`, `client/components/demo-stage.tsx`

```sh
curl -X POST localhost:8000/demo/scenario/f
```

- Grants a **15-second session key** on the current agent address
- Starts a 3-leg payment run (15 mUSDC each, 2s between legs)
- After leg 1 succeeds, advances chain clock 20 seconds past the key expiry
- Legs 2-3 revert with `SessionInvalid` — from **natural expiry**, not manual revocation
- Added as **Scenario F** card on `/demo` page

**Why:** Proves in-flight revocation works via expiry, not just manual `revokeSession`. Directly hits the PS bonus metric.

---

### 14. Wallet ABI + Owner Write Hook Updates
**Files:** `client/lib/wallet-abi.ts`, `client/lib/use-owner-write.ts`

New entries added to the browser-side ABI slice:
- `setCounterpartyCap(address, uint256)`
- `resetBlockedStreak()`
- `sessions(address)` → `(bool active, uint48 expiresAt)`
- `counterpartyCap(address)` → `uint256`
- `counterpartySpent24h(address)` → `uint256`
- `blockedStreak()` → `uint8`
- `CounterpartyCapExceeded` custom error

New function names added to `OwnerFunction` type:
- `setCounterpartyCap`
- `resetBlockedStreak`

---

## New Endpoints Summary

| Endpoint | Method | What it does |
|---|---|---|
| `GET /agent/threat` | GET | Live threat state: streak, threshold, auto-triggered |
| `GET /agent/watchdog` | GET | Agent health: last tick time, overdue detection |
| `POST /demo/scenario/b-rogue?attack=velocity` | POST | Velocity drain attack (5 × 19 mUSDC) |
| `POST /demo/scenario/f` | POST | Session key expiry mid-run demo |
| `GET /api/audit` | GET | Full audit log as JSON |
| `GET /api/audit?fmt=csv` | GET | Full audit log as CSV download |

---

## PS Evaluation Metric Coverage

| Metric | Features addressing it |
|---|---|
| Enforcement layer | Per-counterparty cap (#2), velocity attack blocked by rolling cap (#4) |
| Kill-switch reliability | Auto-freeze on streak (#1), session expiry UI (#9), watchdog (#12) |
| Attack resistance | Auto-freeze (#1), velocity attack (#4), per-counterparty cap (#2) |
| In-flight revocation (bonus) | Scenario F — natural key expiry mid-run (#13) |
| Real-world plausibility | Audit log export (#11), webhook alerts (#5), session expiry (#9) |
