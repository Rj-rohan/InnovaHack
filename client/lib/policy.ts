/**
 * Policy vocabulary shared by the server and the browser.
 *
 * Lives apart from `collections.ts` because that module imports the MongoDB driver: importing a
 * *value* from it in a client component drags `mongodb` — and its `net`/`tls`/`fs` requires —
 * into the browser bundle and the build fails. Types alone are safe there, since they are erased;
 * runtime constants are not, so they live here.
 */

/** Mirrors `AgentWallet.BlockReason`, in the contract's own declaration order. */
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

export type TxStatus = "pending" | "confirmed" | "reverted" | "blocked";
export type AgentMode = "normal" | "injected" | "rogue";

/**
 * States of the hold-for-review queue.
 *
 * This is a *soft* control and should be presented as one. The agent choosing to hold a suspicious
 * invoice is good product behaviour, not the safety mechanism — the contract is what makes a bad
 * payment impossible. A dashboard that blurs the two tells the wrong story.
 */
export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
