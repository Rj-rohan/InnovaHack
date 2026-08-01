# The Kill Switch — Runbook

A policy-enforcing smart contract wallet for autonomous AI agents. Spend limits, an allowlist, and
a freeze live in **contract storage**, not in a prompt — so a buggy, prompt-injected, or fully
compromised agent physically cannot move funds outside policy, and the owner can stop a payment run
that is already underway.

```
contracts/   Solidity + Hardhat. AgentWallet.sol is where every rule is enforced.
client/      Next.js 16. Dashboard, MongoDB access, and the chain indexer.
server/      Python FastAPI. The AI agent — Gemini + Groq, both free tier.
```

Only `client/` opens a database connection. The Python service holds no Mongo driver; it writes
through two authenticated API routes so all persistence stays in one place.

---

## One-time setup

### 1. Contracts

```sh
cd contracts
npm install
npm test                    # 24 tests — do this before anything else
```

Generate the agent's session key. It can only propose payments — it cannot pause, unpause, change
limits, edit the allowlist, or withdraw:

```sh
npx hardhat run scripts/new-session-key.ts
```

Copy `.env.example` → `.env` and fill in:

| Variable | Where it comes from |
|---|---|
| `SEPOLIA_RPC_URL` | Any free provider (PublicNode needs no signup) |
| `OWNER_PRIVATE_KEY` | Your owner wallet. **Never** goes in `server/.env` |
| `AGENT_SESSION_KEY_ADDRESS` | Address printed by the script above |
| `DEMO_VENDOR_1/2`, `DEMO_GAS_REFILL` | Any three addresses; they only receive mUSDC |

**Fund from a faucet before demo day — faucets rate-limit.** Owner ≈ 0.3 ETH, session key ≈ 0.2 ETH.
The payment token is `MockUSDC`, which you mint yourself, so no token faucet is needed.

```sh
npm run deploy:sepolia
```

This writes `contracts/deployments/11155111.json` — addresses **and** ABIs, read by both `client/`
and `server/`. Nothing else needs an address pasted into it.

### 2. Database

Create a free MongoDB Atlas **M0** cluster (512 MB, no card). Then:

```sh
cd client
npm install
cp .env.example .env.local     # fill in MONGODB_URI and INGEST_SECRET
npm run db:init
```

`db:init` creates the indexes and tells you whether **change streams** are available. They are what
make the dashboard push in real time instead of polling; Atlas M0 supports them, a local standalone
`mongod` does not. If they are unavailable the app still works — `/api/stream` detects it and falls
back to polling.

### 3. Agent

```sh
cd server
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt  # macOS/Linux
./.venv/Scripts/python.exe smoke_test.py                        # offline, no keys needed
cp .env.example .env
```

Get both free API keys — [Gemini](https://aistudio.google.com/apikey),
[Groq](https://console.groq.com/keys) — and set `INGEST_SECRET` to the **same value** as
`client/.env.local`.

---

## Running

Three terminals:

```sh
cd client   && npm run dev        # dashboard        :3000
cd client   && npm run indexer    # chain indexer    (no port)
cd server   && ./.venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000
```

The indexer is a separate process because a Next.js route handler cannot hold a long-lived watcher
open. It shares `client/lib/mongodb.ts`, so database access still lives entirely in `client/`.

---

## The three demo scenarios

### A — normal operation

```sh
curl -X POST localhost:8000/demo/scenario/a
```

Gemini reviews the invoice queue and pays an allowlisted vendor 25 mUSDC. The dashboard row goes
`pending → confirmed`; the Etherscan link resolves.

### B — attack

```sh
curl -X POST localhost:8000/demo/scenario/b
```

A **poisoned invoice** tells the agent the vendor's banking details changed and to remit to
`0xBAD…`. The malicious instruction is in the *data the agent reads with a tool*, not in its own
prompt — nobody told this agent to misbehave; an invoice lied to it. It runs on the Groq
open-weight model, which is less injection-hardened, so it follows the instruction. The transaction
broadcasts, and the **contract reverts it**. The indexer replays the revert and the row reads
`blocked — CounterpartyNotAllowed(0xBAD…)`.

If the model declines the injection, the response says so. Then:

```sh
curl -X POST "localhost:8000/demo/scenario/b-rogue?attack=exfiltrate"
curl -X POST "localhost:8000/demo/scenario/b-rogue?attack=overspend"
```

Same attack with **the model removed entirely** — thirty lines that sign and broadcast directly.
This is the stronger version of the argument, not a fallback: the contract cannot tell whether a
transaction came from a careful model, a jailbroken one, a rogue script, or an attacker holding the
leaked session key. It refuses all four identically, because it never asks.

`overspend` is the one to run if a judge suspects the allowlist is doing all the work — it pays a
*legitimate, allowlisted* vendor 5× the per-transaction cap, so the only thing stopping it is the
limit itself.

### C — freeze mid-flight

```sh
curl -X POST "localhost:8000/demo/scenario/c?legs=3&amount_usdc=20"
```

Starts a 3-leg payment run, one transaction per leg, ~20s apart. After leg 1 confirms, hit
**FREEZE** in the dashboard (MetaMask, owner signature). Legs 2 and 3 revert with `AgentPaused()`.
`/agent/status` shows the agent still trying and still failing. Then unpause and watch it resume.

Separate transactions rather than one `payBatch`, because on Sepolia's ~12s blocks the owner needs a
real window to land `pause()`. The *intra-transaction* per-leg check is proven by
`test_BatchHaltsMidFlightWhenPausedBetweenLegs` in the contract suite — the right place for
something a 12-second chain cannot demonstrate live.

---

## Verification checklist

| Check | Command / expectation |
|---|---|
| Contracts | `cd contracts && npm test` → 24 passing |
| Deployment | `cast call $WALLET "paused()(bool)"` → `false`; verified on Sepolia Etherscan |
| Indexes | restart the indexer twice → **zero** duplicate `policy_events` |
| Change streams | insert a `tx_attempt` → dashboard updates with no refresh |
| Agent SDKs | `./.venv/Scripts/python.exe smoke_test.py` → 6 checks pass |
| Provider failover | set a bad `GEMINI_API_KEY`, run scenario A → completes on Groq, `/agent/status` shows the switch |

Run the failover check **before** demo day, not during.

---

## Design decisions judges tend to probe

**"Is the agent just choosing not to overspend?"** No. `server/chain/client.py::send_payment`
performs zero validation and says so in a comment — it signs and broadcasts whatever the model
asked for. `simulate_payment` exists so the agent can *observe* policy, never enforce it; the
contract re-derives the answer from storage regardless of whether it was called.

**"Why does a blocked payment show up at all, if it reverted?"** A revert emits no logs, so the
indexer replays the transaction via `eth_call` against the state one block earlier and decodes the
custom error. That is how `CounterpartyNotAllowed(0xBAD…)` reaches the screen. `payBatch` takes the
opposite approach — it emits `PaymentBlocked` and stops instead of reverting, so already-completed
legs persist and the block is visible in the receipt.

**"Can the owner be locked out?"** No. `ownerWithdraw` bypasses every check including `paused`. The
policy constrains the *agent*; a freeze that also locked the owner out of their own money would be
a bug, not a safety feature.

**"What if the agent runs 33 payments in a day?"** The rolling window is a 32-slot ring buffer. If
all 32 slots are still inside the window it reverts with `SpendHistoryFull()` rather than
overwriting a live entry, because overwriting would under-count the window and let spend drift past
the cap. It fails closed.

**"Could the agent unfreeze itself?"** The owner key is not in the agent process, and
`ChainClient.__init__` refuses to start if the session key address equals the wallet owner.

---

## Known constraints

- **Sepolia caps are demo-sized, not realistic** — 40 mUSDC per transaction, 100 mUSDC rolling.
  Sized so the third payment in a run trips the rolling cap on stage. Sepolia has no time travel,
  so the 24h expiry is proven in the test suite (`vm.warp`) rather than live.
- **The rolling window supersedes a calendar "daily cap"** — it is the strictly stronger guarantee;
  a midnight-reset cap lets an agent spend two full allowances an hour apart.
- **Single-token wallet.** `pay(to, amount)` on one immutable ERC-20, no arbitrary calldata.
  Arbitrary-call wallets must parse calldata to enforce anything, which is where policy wallets get
  exploited.
- **Foundry → Hardhat.** Foundry needs a Rust toolchain to install on Windows. Hardhat 3 runs
  Solidity tests with forge-std cheatcodes, so `vm.warp` and custom-error `expectRevert` work
  unchanged with no Foundry binary.
- **If Sepolia degrades on demo day**, `anvil --fork-url $SEPOLIA_RPC_URL` runs identical bytecode
  with 1-second blocks. Point the three `.env` files at `http://localhost:8545` and redeploy.
