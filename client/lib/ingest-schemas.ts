import { z } from "zod";

/**
 * Validation for the only path from the Python agent into the database.
 *
 * The agent is an external, semi-trusted process whose payloads are partly shaped by LLM output,
 * so everything crossing this boundary is parsed rather than cast. A malformed tool call should
 * produce a 400, not a half-written document.
 */

const address = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "expected a 20-byte hex address");

const txHash = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "expected a 32-byte hex tx hash");

/** Base units as a decimal string — never a JS number. */
const baseUnits = z.string().regex(/^\d+$/, "expected an integer amount in base units");

export const agentMode = z.enum(["normal", "injected", "rogue"]);

export const decisionSchema = z.object({
  runId: z.string().min(1),
  tick: z.number().int().nonnegative(),
  mode: agentMode,
  provider: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  reasoning: z.string().default(""),
  toolCalls: z
    .array(
      z.object({
        name: z.string(),
        args: z.record(z.string(), z.unknown()).default({}),
        result: z.string().default(""),
      }),
    )
    .default([]),
});

export const txAttemptSchema = z.object({
  runId: z.string().min(1),
  tick: z.number().int().nonnegative(),
  txHash: txHash.nullable().default(null),
  /** Leg within a batch transaction; 0 for a plain single payment. */
  legIndex: z.number().int().nonnegative().default(0),
  from: address,
  to: address,
  vendor: z.string().nullable().default(null),
  amount: baseUnits,
  // `pending` once broadcast; `blocked` when the agent never got a transaction out at all
  // (e.g. the preflight simulate already refused, or a rogue send threw before broadcast).
  status: z.enum(["pending", "confirmed", "reverted", "blocked"]).default("pending"),
  reason: z.string().nullable().default(null),
  mode: agentMode,
});

export type DecisionInput = z.infer<typeof decisionSchema>;
export type TxAttemptInput = z.infer<typeof txAttemptSchema>;

/** Constant-time-ish shared-secret check for the ingest routes. */
export function authorized(request: Request): boolean {
  const expected = process.env.INGEST_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
