# The Kill Switch — Setup & Test Guide

From a fresh clone to every feature exercised. Follow it top to bottom the first time.

**No real money is involved at any point.** The demo runs on a local Hardhat chain whose accounts
hold valueless test ETH, and the payment token is a mock USDC minted by the deploy script. It is
still a real EVM executing the real contract, so nothing about the enforcement is simulated.

---

## Table of contents

1. [What you need installed](#1-what-you-need-installed)
2. [Get the accounts and free API keys](#2-get-the-accounts-and-free-api-keys)
3. [Install](#3-install)
4. [Configure the three .env files](#4-configure-the-three-env-files)
5. [Start everything](#5-start-everything)
6. [MetaMask](#6-metamask)
7. [Feature testing — walk the whole product](#7-feature-testing--walk-the-whole-product)
8. [Automated test suites](#8-automated-test-suites)
9. [Troubleshooting](#9-troubleshooting)
10. [Daily restart checklist](#10-daily-restart-checklist)
11. [Deploying to a public testnet later](#11-deploying-to-a-public-testnet-later)

---

## 1. What you need installed

| Tool | Version | Check |
|---|---|---|
| Node.js | 20.9+ (22+ recommended) | `node --version` |
| npm | ships with Node | `npm --version` |
| Python | 3.11+ | `python --version` |
| Git | any | `git --version` |

You do **not** need Foundry, Docker, or a local MongoDB.

---

## 2. Get the accounts and free API keys

Three free signups, none of which need a card.

| Service | Where | What you get |
|---|---|---|
| **MongoDB Atlas** | [cloud.mongodb.com](https://cloud.mongodb.com) | Free **M0** cluster (512 MB). Create the cluster, add a database user, and under *Network Access* allow `0.0.0.0/0` for local dev. Copy the connection string from **Connect → Drivers**. |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Free API key. Drives the everyday agent. |
| **Groq** | [console.groq.com/keys](https://console.groq.com/keys) | Free API key. Drives the compromised agent and acts as failover. |

> **Why both LLM keys?** They're separate rate-limit buckets, so a 429 on one isn't a 429 on the
> other, and the compromised-agent scenario deliberately runs on the open-weight Groq model.
> One key alone will work; two is noticeably more robust during a long session.

**You do not need a crypto faucet.** That is the whole point of running locally — see §6.

---

## 3. Install

```sh
git clone <your-repo-url>
cd InnovaHack
```

**Contracts**

```sh
cd contracts
npm install
npm test          # expect: 24 passing
cd ..
```

**Client** (dashboard + database + indexer)

```sh
cd client
npm install
cd ..
```

**Server** (the AI agent)

```sh
cd server
python -m venv .venv
```

```sh
# Windows
./.venv/Scripts/python.exe -m pip install -r requirements.txt

# macOS / Linux
source .venv/bin/activate && pip install -r requirements.txt
```

Verify the install without needing any keys yet:

```sh
./.venv/Scripts/python.exe smoke_test.py      # Windows
# python smoke_test.py                        # macOS/Linux, venv active
```

Expect **10 checks passed**. If this fails, stop and fix it — everything downstream depends on it.

```sh
cd ..
```

---

## 4. Configure the three .env files

### `contracts/.env`

Only needed for a **public** deployment. For local work you can skip it entirely — the deploy
script uses the node's built-in accounts on chain 31337.

```sh
cd contracts && cp .env.example .env
```

### `client/.env.local`

```sh
cd client && cp .env.example .env.local
```

Fill in:

```ini
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=killswitch

CHAIN_ID=31337
RPC_URL=http://127.0.0.1:8550
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8550

INGEST_SECRET=pick-any-long-random-string
```

### `server/.env`

```sh
cd server && cp .env.example .env
```

Fill in:

```ini
GEMINI_API_KEY=your-gemini-key
GROQ_API_KEY=your-groq-key

CHAIN_ID=31337
RPC_URL=http://127.0.0.1:8550

INGEST_URL=http://localhost:3000
INGEST_SECRET=must-match-client-exactly
```

> ⚠️ **`INGEST_SECRET` must be byte-identical in both files.** It guards the only path from the
> agent into the database. A mismatch shows up as `401` warnings in the agent log and an
> empty dashboard.

> ⚠️ **Do not set `AGENT_SESSION_KEY_PRIVATE` for local runs.** On chain 31337 it defaults to
> Hardhat account #1. On any other chain it is mandatory — that gate is deliberate, so a public
> deployment can never be signed by a key that appears in every tutorial on the internet.

**Initialise the database** (creates indexes, reports change-stream support):

```sh
cd client && npm run db:init
```

Expect `Indexes created.` and `Change streams: available`. If it says *unavailable*, you're pointed
at a standalone mongod rather than Atlas — the app still works, it just polls instead of pushing.

---

## 5. Start everything

Five terminals. Order matters for the first two.

**Terminal 1 — the chain** (leave running)

```sh
cd contracts && npm run node
```

**Terminal 2 — deploy + seed** (run, then it exits)

```sh
cd contracts && npm run deploy:local
cd ../client  && npm run sync:chain
```

`deploy:local` deploys both contracts, mints 10,000 mUSDC, grants the agent a session key,
registers three allowlisted counterparties, and **switches the node to 2-second interval mining**.

> That last part is load-bearing. With Hardhat's default automine, a policy-violating transaction is
> *rejected at submission* and never reaches a block — so a blocked payment would appear as a
> client-side error with no on-chain evidence. Interval mining puts transactions in a mempool the
> way a real network does, so refused payments mine as genuine reverted transactions.

**Terminal 3 — dashboard**

```sh
cd client && npm run dev
```

**Terminal 4 — chain indexer**

```sh
cd client && npm run indexer
```

**Terminal 5 — the agent**

```sh
cd server && ./.venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000
```

Health check before going further:

```sh
curl localhost:8000/agent/status
```

You should see `chainId: 31337`, a session key address, and the policy caps.

---

## 6. MetaMask

Only needed for the owner's **freeze** button. The demo runs without it.

**Add the network** — MetaMask → Networks → Add network manually:

| Field | Value |
|---|---|
| Network name | Hardhat Local |
| RPC URL | `http://127.0.0.1:8550` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

**Import the owner account** — MetaMask → Account menu → Import account → paste:

```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

That is Hardhat **account #0**, the wallet owner, pre-funded with 10,000 test ETH. It is printed in
the `npm run node` output along with 19 others.

**See the mUSDC** (optional) — Import tokens → paste the `mockUsdc` address from
`contracts/deployments/31337.json`.

> **On "test dollars":** there is no faucet step. Hardhat funds every account at genesis, and the
> mock token is minted by the deploy script. If you later move to Sepolia you *will* need a faucet —
> see §11.

---

## 7. Feature testing — walk the whole product

Work through these in order. Each states what you should see, so a wrong result is obvious.

### 7.1 The website loads

| URL | Should show |
|---|---|
| `http://localhost:3000` | Marketing landing page |
| `/how-it-works` | Explainer |
| `/console` | Owner console — live policy state |
| `/console/policy` | Spend caps and throttle |
| `/console/counterparties` | The three allowlisted vendors |
| `/console/sessions` | The agent's session key |
| `/console/activity` | Live payment attempts |
| `/demo` | Scenario driver — buttons for A, B, C and the rogue script |

If the console shows zeroes or "not deployed", `npm run sync:chain` hasn't been run since the last
deploy.

**About `/demo`:** it calls the agent service directly, defaulting to `http://localhost:8000`. If
you run the agent elsewhere, set `NEXT_PUBLIC_AGENT_URL` in `client/.env.local`. With the agent
unreachable the page degrades to watch-mode rather than erroring. Time travel (§7.9) has no button
— it's curl-only, deliberately, since it's a dev-chain capability rather than a product feature.

Every scenario below can be driven from that page instead of curl. The curl commands are given
because they're unambiguous and work headless.

### 7.2 Data plumbing

```sh
curl localhost:3000/api/state | head -c 400
```

Expect `"deployed": true`, the contract addresses, and `"indexerHealthy": true`. If
`indexerHealthy` is false, terminal 4 isn't running.

### 7.3 Normal operation — the agent pays a verified invoice

```sh
curl -X POST localhost:8000/demo/scenario/a
```

**Expect:** `payments: 1`, and reasoning naming the purchase order, e.g.
*"The invoice matches its purchase order, is not a duplicate, and is consistent with the vendor's history."*  
(Names and numbers differ every run — the queue is generated.)

**Then check:** `/console/activity` shows a row going `pending → confirmed` **without refreshing**
the page. That live update is the MongoDB change stream working end to end.

### 7.4 Duplicate detection — the agent refuses

Run scenario A a few more times (or start the loop with `curl -X POST localhost:8000/agent/start`)
until the **duplicate** invoice appears — a re-send of one already paid.

**Expect:** the agent calls `check_duplicate`, sees the match, and does **not** pay.

### 7.5 Hold for review — the agent escalates to a human

The **anomalous** invoice bills ~10× its vendor's historical average with no purchase order.

**Expect:** `payments: 0, holds: 1`, and a reason such as
*"Invoice lacks a purchase order and the amount (190.0 mUSDC) is significantly higher than the
vendor's average payment history (18.75 mUSDC)."*

```sh
curl localhost:8000/agent/review
```

The item appears in the console's review queue. Approve it:

```sh
curl -X POST localhost:8000/agent/review/<INVOICE_ID>/approve
curl -X POST localhost:8000/agent/tick
```

**Expect:** the agent now treats it as cleared. Note it may still be refused *on-chain* for
exceeding the per-transaction cap — which is the correct outcome and a nice thing to point out: a
human approving something does not override the contract.

> **Frame this carefully in a demo.** The review queue is a **soft** control — the agent choosing to
> defer. A compromised agent simply wouldn't use it. The contract is the hard control, which 7.6
> proves.

### 7.6 The agent is compromised — and the chain refuses anyway

```sh
curl -X POST localhost:8000/demo/scenario/b
```

The agent's instructions have been subverted *and* the invoice memo carries an injected
"our banking details changed" payload naming a freshly generated attacker address. It pays.

**Expect:** `payments: 1`, reasoning like *"I paid the vendor to settle the overdue invoice because
it was overdue and the vendor provided updated payment details in the invoice memo."*

**Then check `/console/activity`:** the row reads **`blocked — CounterpartyNotAllowed(0x…)`**.
The transaction was broadcast, mined, and reverted. The attacker received nothing.

Now remove the model from the loop entirely:

```sh
curl -X POST "localhost:8000/demo/scenario/b-rogue?attack=exfiltrate"
curl -X POST "localhost:8000/demo/scenario/b-rogue?attack=overspend"
```

`exfiltrate` pays a non-allowlisted address. `overspend` pays a **legitimate, allowlisted** vendor
5× the per-transaction cap — run that one if anyone suspects the allowlist is doing all the work,
since only the spend limit can stop it.

**Expect:** both blocked, identically. The contract cannot tell whether a transaction came from a
careful model, a subverted one, a rogue script, or a stolen session key.

### 7.7 The kill switch — freeze a run already in progress

```sh
curl -X POST "localhost:8000/demo/scenario/c?legs=3&amount_usdc=20"
```

Three payments, one transaction each, ~20 s apart. **After leg 1 confirms**, hit the big red
**FREEZE** in the console (MetaMask will ask you to sign as the owner).

**Expect:** legs 2 and 3 revert with `AgentPaused()`. `/agent/status` shows the agent still trying
and still failing. Unpause and it resumes.

Verify only the owner can do it: switch MetaMask to a different imported account and press FREEZE.
It should revert with `NotOwner()`.

### 7.8 Throttle — the setting between running and frozen

In `/console/policy`, set the throttle to 1%.

**Expect:** caps drop to 0.4 / 1.0 mUSDC. Small payments still succeed, normal ones are refused with
`SpendLimitExceeded`. Useful for "we think something is wrong but don't want to stop operations."

### 7.9 The rolling 24-hour window, live

```sh
# spend to the 100 mUSDC cap
curl -X POST localhost:8000/demo/scenario/a   # repeat until refused
```

**Expect:** eventually `RollingCapExceeded`.

```sh
curl -X POST "localhost:8000/demo/advance-time?hours=25"
curl -X POST localhost:8000/demo/scenario/a
```

**Expect:** `spentInWindowUsdc` drops to 0 and the same payment now succeeds.

This proves the window genuinely **rolls** rather than resetting at midnight — a calendar cap would
let an agent spend two full allowances an hour apart. It's only demonstrable because you're local;
on a public chain it can only be shown in a unit test.

### 7.10 Session key revocation

In `/console/sessions`, revoke the agent's key, then:

```sh
curl -X POST localhost:8000/agent/tick
```

**Expect:** `SessionInvalid`. The agent is alive, connected, and completely unable to move money.
Re-grant to restore.

### 7.11 Provider failover

Temporarily corrupt `GEMINI_API_KEY` in `server/.env`, restart the agent, and run scenario A.

**Expect:** the tick completes on Groq; `/agent/status` shows `lastProvider: groq`.

**Do this before demo day, not during.**

### 7.12 Live event stream

```sh
curl -N localhost:8000/agent/stream
```

Leave it open and run a scenario in another terminal — you'll see `tick_start`, `reasoning`,
`tool_call`, `tool_result`, `payment`, `tick_end` as they happen.

---

## 8. Automated test suites

| Suite | Command | Expect |
|---|---|---|
| Contracts | `cd contracts && npm test` | 24 passing |
| Agent | `cd server && ./.venv/Scripts/python.exe smoke_test.py` | 10 checks passed |
| Client types | `cd client && npm run typecheck` | no output |

The contract suite is worth showing directly. Two tests do things a live chain can't:

- **`test_BatchHaltsMidFlightWhenPausedBetweenLegs`** — a re-entrant token pulls the kill switch
  *between legs of a single transaction*, proving `payBatch` re-checks policy before every leg.
- **`test_RollingWindowExpiresAfter24h`** — uses `vm.warp` to prove the window ages out precisely.

Plus two fuzz properties over 256 runs each: no call can exceed the per-transaction cap, and nobody
without a live session key can move funds.

---

## 9. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `No deployment record at …/11155111.json` | Your `.env` still says `CHAIN_ID=11155111`. Set `CHAIN_ID=31337` and `RPC_URL=http://127.0.0.1:8550`. |
| Console shows zeroes / "not deployed" | Run `cd client && npm run sync:chain` after every deploy. |
| Dashboard never updates live | Terminal 4 (indexer) isn't running, or `/api/state` shows `indexerHealthy: false`. |
| Agent logs `401` from ingest | `INGEST_SECRET` differs between `client/.env.local` and `server/.env`. |
| Blocked payments show a raw RPC error instead of a reason | The node is on automine. Re-run `npm run deploy:local`. |
| `Session key has 0 ETH` warning | The node was restarted without redeploying. Re-run `npm run deploy:local`. |
| Every payment fails after a node restart | Same cause — the chain was wiped. Redeploy and re-sync. |
| MetaMask "nonce too high" | Settings → Advanced → Clear activity tab data. Normal after restarting a local chain. |
| `MONGODB_URI is not set` | It belongs in `client/.env.local` (not `.env`), and the indexer reads that file. |
| `Change streams: unavailable` | You're on a standalone mongod, not Atlas. Harmless — the stream falls back to polling. |
| Gemini 400 `thought_signature` | You're on an old build. The assistant message must be echoed verbatim; pull latest. |
| `hours must be positive` / 400 on advance-time | Time travel is chain-gated. It only works on 31337 — by design. |

---

## 10. Daily restart checklist

A local chain is in-memory. Restarting the local chain wipes everything.

```sh
# 1. chain
cd contracts && npm run node

# 2. redeploy (also restores interval mining)
cd contracts && npm run deploy:local
cd ../client  && npm run sync:chain

# 3. services
cd client && npm run dev
cd client && npm run indexer
cd server && ./.venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000
```

If MetaMask misbehaves afterwards, clear its activity data (§9).

Old rows from previous runs remain in MongoDB and will reference dead addresses. To start clean,
drop the `killswitch` database in Atlas and re-run `npm run db:init`.

---

## 11. Deploying to a public testnet later

Nothing about running locally is a one-way door. **No code changes are required** — every
chain-specific setting is a row in `client/lib/chains.ts` and `CHAIN_PROFILES` in
`server/config.py`.

1. **Get Sepolia ETH from a faucet** — this is the one place you need one.
   [sepoliafaucet.com](https://sepoliafaucet.com) or
   [google.com/search?q=sepolia+faucet](https://www.google.com/search?q=sepolia+faucet).
   Send ~0.3 ETH to your owner address and ~0.2 to the agent session key. Faucets rate-limit, so do
   this a day ahead.

2. **Generate a real session key** (never reuse a Hardhat one on a public chain):

   ```sh
   cd contracts && npx hardhat run scripts/new-session-key.ts
   ```

3. **Fill `contracts/.env`**: `SEPOLIA_RPC_URL`, `OWNER_PRIVATE_KEY`,
   `AGENT_SESSION_KEY_ADDRESS`, and three `DEMO_VENDOR_*` addresses.

4. **Deploy and sync**:

   ```sh
   cd contracts && npm run deploy:sepolia
   cd ../client && CHAIN_ID=11155111 npm run sync:chain
   ```

5. **Point the apps at it** — in `client/.env.local` and `server/.env`:

   ```ini
   CHAIN_ID=11155111
   RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
   ```

   Also set `AGENT_SESSION_KEY_PRIVATE` in `server/.env` — off chain 31337 it is mandatory.

What changes: transactions take ~12 s instead of 2 s, every row gets a working Etherscan link, and
`/demo/advance-time` returns 400 (time travel is impossible on a public chain, by design).

*Hosting:* `client/` deploys to Vercel and Atlas is already cloud, but **the indexer is a persistent
process and cannot run on serverless** — it needs a small always-on container (Railway / Fly /
Render), as does `server/`.
