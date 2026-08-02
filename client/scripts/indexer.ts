import "dotenv/config";
import {
  createPublicClient,
  decodeErrorResult,
  http,
  type Abi,
  type Address,
  type Log,
  type PublicClient,
} from "viem";
import { BLOCK_REASONS, collections, ensureIndexes } from "../lib/collections";
import { CHAIN_ID, getChainProfile, rpcUrl } from "../lib/chains";
import { loadDeployment } from "../lib/deployment";
import { getClient, getDb } from "../lib/mongodb";

/**
 * Chain indexer.
 *
 * Runs as its own process alongside `next dev` because a Next.js route handler cannot hold a
 * long-lived watcher open. It shares `lib/mongodb.ts` with the app, so all database access still
 * lives inside client/.
 *
 * Two jobs:
 *   1. Mirror AgentWallet events into `policy_events` and refresh the cached `chain_state`.
 *   2. Reconcile `pending` transaction attempts — and, crucially, recover WHY a reverted one
 *      failed. A revert emits no logs, so the reason has to be replayed out of the chain.
 *
 * Deliberately uses `getLogs` polling from a persisted cursor rather than a websocket
 * subscription. Free Sepolia RPCs drop websockets routinely, and a subscription-only indexer
 * silently misses every event during the gap without ever erroring. A cursor survives both RPC
 * flakiness and process restarts.
 */

// Every chain-specific number comes from the profile, not from constants here. A 100k block range
// and zero confirmations are right on a local node and would be rejected (or unsafe on reorg) on a
// public one — which is exactly the kind of thing that silently breaks a later deployment.
const profile = getChainProfile(CHAIN_ID);
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? profile.pollMs);
const MAX_BLOCK_RANGE = profile.maxBlockRange;
const CONFIRMATIONS = profile.confirmations;

const deployment = loadDeployment(CHAIN_ID);
const walletAddress = deployment.contracts.agentWallet;
const walletAbi = deployment.abi.agentWallet as Abi;

const publicClient: PublicClient = createPublicClient({
  chain: profile.viemChain,
  transport: http(rpcUrl(), { retryCount: 3, timeout: 20_000 }),
});

/** Maps a Solidity custom error name onto the same vocabulary `PaymentBlocked` uses. */
const ERROR_TO_REASON: Record<string, string> = {
  WalletPaused: "Paused",
  SessionInvalid: "SessionInvalid",
  CounterpartyNotAllowed: "CounterpartyNotAllowed",
  SpendLimitExceeded: "PerTxCapExceeded",
  RollingLimitExceeded: "RollingCapExceeded",
  InsufficientBalance: "InsufficientBalance",
  CounterpartyCapExceeded: "CounterpartyCapExceeded",
  SpendHistoryFull: "SpendHistoryFull",
  NotOwner: "NotOwner",
  EmptyBatch: "EmptyBatch",
};

/** BigInts are not JSON-serialisable and Mongo has no native bigint — store decimal strings. */
function serializeArgs(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (typeof value === "bigint") out[key] = value.toString();
    else if (Array.isArray(value)) out[key] = value.map((v) => (typeof v === "bigint" ? v.toString() : v));
    else out[key] = value;
  }
  return out;
}

/**
 * Walks a viem error chain looking for raw revert data.
 *
 * viem wraps the RPC error several layers deep and the exact shape varies by transport and by
 * provider, so this reaches for any `data` that looks like an ABI-encoded error rather than
 * pattern-matching one specific error class.
 */
function extractRevertData(error: unknown): `0x${string}` | null {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = (current as { data?: unknown }).data;

    if (typeof candidate === "string" && candidate.startsWith("0x") && candidate.length >= 10) {
      return candidate as `0x${string}`;
    }
    if (candidate && typeof candidate === "object") {
      const nested = (candidate as { data?: unknown }).data;
      if (typeof nested === "string" && nested.startsWith("0x") && nested.length >= 10) {
        return nested as `0x${string}`;
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Replays a reverted transaction against the state just before it ran, to recover the custom
 * error it reverted with. This is what turns "status: reverted" on Etherscan into
 * "CounterpartyNotAllowed(0xBAD…)" on the dashboard.
 */
async function recoverRevertReason(txHash: `0x${string}`, blockNumber: bigint): Promise<string> {
  try {
    const tx = await publicClient.getTransaction({ hash: txHash });
    await publicClient.call({
      account: tx.from,
      to: tx.to ?? undefined,
      data: tx.input,
      value: tx.value,
      // The state *before* this transaction executed.
      blockNumber: blockNumber - 1n,
    });
    // The replay succeeded, so the failure was environmental (gas, nonce) rather than policy.
    return "RevertedWithoutReason";
  } catch (error) {
    const data = extractRevertData(error);
    if (!data) return "RevertedWithoutReason";

    try {
      const decoded = decodeErrorResult({ abi: walletAbi, data });
      return ERROR_TO_REASON[decoded.errorName] ?? decoded.errorName;
    } catch {
      return "RevertedWithoutReason";
    }
  }
}

async function readChainState() {
  const [snapshot, ownerAddress] = await Promise.all([
    publicClient.readContract({
      address: walletAddress,
      abi: walletAbi,
      functionName: "policySnapshot",
    }) as Promise<readonly [boolean, number, bigint, bigint, bigint, bigint, bigint]>,
    publicClient.readContract({
      address: walletAddress,
      abi: walletAbi,
      functionName: "owner",
    }) as Promise<Address>,
  ]);

  const [isPaused, throttle, txCap, dayCap, spent, remaining, balance] = snapshot;

  // Re-read allowlist membership from chain rather than trusting the deploy record — the owner
  // may have added or disabled counterparties since deployment.
  const allowlist = await Promise.all(
    deployment.counterparties.map(async (party) => {
      const enabled = (await publicClient.readContract({
        address: walletAddress,
        abi: walletAbi,
        functionName: "isAllowed",
        args: [party.address],
      })) as boolean;
      return { address: party.address, tag: party.tag, label: party.label, enabled };
    }),
  );

  return {
    paused: isPaused,
    throttleBps: Number(throttle),
    perTxCap: txCap.toString(),
    rollingCap: dayCap.toString(),
    spentInWindow: spent.toString(),
    remaining: remaining.toString(),
    balance: balance.toString(),
    allowlist,
    owner: ownerAddress,
  };
}

async function indexLogs(logs: Log[]) {
  const c = await collections();

  for (const log of logs) {
    const decoded = log as Log & { eventName?: string; args?: unknown };
    const eventName = decoded.eventName;
    if (!eventName || !log.transactionHash || log.logIndex === null) continue;

    const args = serializeArgs(decoded.args);

    // Unique on (txHash, logIndex): re-reading a block range after a restart must not duplicate.
    await c.policyEvents.updateOne(
      { txHash: log.transactionHash, logIndex: log.logIndex },
      {
        $setOnInsert: {
          event: eventName,
          args,
          blockNumber: (log.blockNumber ?? 0n).toString(),
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    // A blocked leg inside a batch is reported by the contract as an event, not a revert.
    if (eventName === "PaymentBlocked") {
      const reasonIndex = Number((args as { reason?: unknown }).reason ?? 0);
      const reason = BLOCK_REASONS[reasonIndex] ?? "Unknown";
      const legIndex = Number((args as { index?: unknown }).index ?? 0);

      await c.txAttempts.updateOne(
        { txHash: log.transactionHash, legIndex },
        {
          $set: {
            status: "blocked",
            reason,
            blockNumber: (log.blockNumber ?? 0n).toString(),
            updatedAt: new Date(),
          },
        },
      );
    }

    if (eventName === "PaymentExecuted") {
      await c.txAttempts.updateMany(
        { txHash: log.transactionHash, status: "pending" },
        {
          $set: {
            status: "confirmed",
            blockNumber: (log.blockNumber ?? 0n).toString(),
            updatedAt: new Date(),
          },
        },
      );
    }
  }
}

/** Flips `pending` rows to their final state, decoding the revert reason where there is one. */
async function reconcilePending() {
  const c = await collections();
  const pending = await c.txAttempts
    .find({ status: "pending", txHash: { $type: "string" } })
    .limit(25)
    .toArray();

  for (const attempt of pending) {
    if (!attempt.txHash) continue;
    const hash = attempt.txHash as `0x${string}`;

    let receipt;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash });
    } catch {
      continue; // not mined yet
    }

    if (receipt.status === "success") {
      await c.txAttempts.updateOne(
        { txHash: hash, legIndex: attempt.legIndex },
        {
          $set: {
            status: "confirmed",
            blockNumber: receipt.blockNumber.toString(),
            updatedAt: new Date(),
          },
        },
      );
      continue;
    }

    const reason = await recoverRevertReason(hash, receipt.blockNumber);
    await c.txAttempts.updateOne(
      { txHash: hash, legIndex: attempt.legIndex },
      {
        $set: {
          status: "reverted",
          reason,
          blockNumber: receipt.blockNumber.toString(),
          updatedAt: new Date(),
        },
      },
    );
    console.log(`  reverted ${hash.slice(0, 12)}… -> ${reason}`);
  }
}

async function tick() {
  const c = await collections();

  const stored = await c.chainState.findOne({ _id: "singleton" });
  const head = await publicClient.getBlockNumber();
  const safeHead = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;

  const cursor = stored?.lastIndexedBlock
    ? BigInt(stored.lastIndexedBlock)
    : BigInt(deployment.deployBlock);

  if (safeHead > cursor) {
    const fromBlock = cursor + 1n;
    const toBlock = safeHead - fromBlock > MAX_BLOCK_RANGE ? fromBlock + MAX_BLOCK_RANGE : safeHead;

    const logs = await publicClient.getContractEvents({
      address: walletAddress,
      abi: walletAbi,
      fromBlock,
      toBlock,
    });

    if (logs.length > 0) {
      console.log(`blocks ${fromBlock}-${toBlock}: ${logs.length} event(s)`);
      await indexLogs(logs as Log[]);
    }

    const state = await readChainState();
    // Advance the cursor only after the writes above succeeded. If this process dies mid-range
    // the next start re-reads it, which the unique index makes harmless.
    await c.chainState.updateOne(
      { _id: "singleton" },
      { $set: { ...state, lastIndexedBlock: toBlock.toString(), updatedAt: new Date() } },
      { upsert: true },
    );
  } else {
    // No new blocks, but policy could still have changed via a tx we already indexed; keep the
    // snapshot fresh so the dashboard's caps and balance do not go stale.
    const state = await readChainState();
    await c.chainState.updateOne(
      { _id: "singleton" },
      {
        $set: { ...state, updatedAt: new Date() },
        $setOnInsert: { lastIndexedBlock: cursor.toString() },
      },
      { upsert: true },
    );
  }

  await reconcilePending();
}

async function main() {
  console.log("Kill Switch indexer");
  console.log(`  chain    ${deployment.chainId}`);
  console.log(`  wallet   ${walletAddress}`);
  console.log(`  poll     ${POLL_MS}ms\n`);

  await ensureIndexes(await getDb());

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\nshutting down…");
    const client = await getClient();
    await client.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  for (;;) {
    try {
      await tick();
    } catch (error) {
      // Never let a transient RPC failure kill the indexer — it is the only thing writing the
      // dashboard's chain view, and dying quietly mid-demo is the worst possible failure.
      console.error("tick failed:", error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

void main();
