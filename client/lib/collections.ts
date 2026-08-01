import type { Collection, Db } from "mongodb";
import { getDb } from "./mongodb";

/**
 * All amounts are stored as decimal STRINGS in base units (6dp for mUSDC), never as JS numbers.
 * `Number` silently loses precision above 2^53 and these are token amounts — a rounding error in
 * a wallet dashboard is not a cosmetic bug.
 */

export type TxStatus = "pending" | "confirmed" | "reverted" | "blocked";
export type AgentMode = "normal" | "injected" | "rogue";

/** Mirrors AgentWallet.BlockReason. Index 0 (`None`) never reaches the database. */
export const BLOCK_REASONS = [
  "None",
  "Paused",
  "SessionInvalid",
  "CounterpartyNotAllowed",
  "PerTxCapExceeded",
  "RollingCapExceeded",
  "InsufficientBalance",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export interface AgentRun {
  runId: string;
  mode: AgentMode;
  status: "running" | "stopped";
  startedAt: Date;
  endedAt: Date | null;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface Decision {
  runId: string;
  tick: number;
  mode: AgentMode;
  /** Which LLM actually served this tick — surfaced in the UI so provider failover is visible. */
  provider: string | null;
  model: string | null;
  reasoning: string;
  toolCalls: ToolCallRecord[];
  createdAt: Date;
}

export interface TxAttempt {
  runId: string;
  tick: number;
  /** Null when the agent decided on a payment that was never broadcast. */
  txHash: string | null;
  /**
   * Position within a `payBatch` transaction; 0 for a single `pay`. One batch transaction
   * produces several payment legs under a single hash, so the hash alone is not a unique key.
   */
  legIndex: number;
  from: string;
  to: string;
  vendor: string | null;
  amount: string;
  status: TxStatus;
  /** Decoded custom error / BlockReason. The whole point of the dashboard. */
  reason: BlockReason | string | null;
  blockNumber: string | null;
  mode: AgentMode;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyEvent {
  event: string;
  args: Record<string, unknown>;
  blockNumber: string;
  txHash: string;
  logIndex: number;
  createdAt: Date;
}

export interface AllowlistEntry {
  address: string;
  tag: string;
  label: string;
  enabled: boolean;
}

export interface ChainState {
  _id: "singleton";
  lastIndexedBlock: string;
  paused: boolean;
  throttleBps: number;
  perTxCap: string;
  rollingCap: string;
  spentInWindow: string;
  remaining: string;
  balance: string;
  allowlist: AllowlistEntry[];
  updatedAt: Date;
}

export async function collections(db?: Db) {
  const database = db ?? (await getDb());
  return {
    runs: database.collection<AgentRun>("agent_runs"),
    decisions: database.collection<Decision>("decisions"),
    txAttempts: database.collection<TxAttempt>("tx_attempts"),
    policyEvents: database.collection<PolicyEvent>("policy_events"),
    chainState: database.collection<ChainState>("chain_state"),
  };
}

export type Collections = Awaited<ReturnType<typeof collections>>;

/**
 * Idempotent — safe to call on every boot.
 *
 * The unique `(txHash, logIndex)` index is the load-bearing one. The indexer re-reads a block
 * range whenever it restarts or an RPC hiccups, so without it every restart silently duplicates
 * event history and the dashboard double-counts blocked payments.
 */
export async function ensureIndexes(db?: Db): Promise<void> {
  const c = await collections(db);

  await c.policyEvents.createIndex({ txHash: 1, logIndex: 1 }, { unique: true });
  await c.policyEvents.createIndex({ blockNumber: -1 });

  // Keyed on (hash, leg) rather than hash alone: a single `payBatch` transaction carries several
  // legs under one hash, and each leg is its own row.
  await c.txAttempts.createIndex(
    { txHash: 1, legIndex: 1 },
    { unique: true, partialFilterExpression: { txHash: { $type: "string" } } },
  );
  await c.txAttempts.createIndex({ status: 1, createdAt: -1 });
  await c.txAttempts.createIndex({ createdAt: -1 });

  await c.decisions.createIndex({ runId: 1, tick: 1 });
  await c.decisions.createIndex({ createdAt: -1 });

  await c.runs.createIndex({ runId: 1 }, { unique: true });
}

export type CollectionName =
  | "agent_runs"
  | "decisions"
  | "tx_attempts"
  | "policy_events"
  | "chain_state";
