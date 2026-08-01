import { collections } from "@/lib/collections";
import { authorized, txAttemptSchema } from "@/lib/ingest-schemas";

export const dynamic = "force-dynamic";

/**
 * Records a payment the agent attempted.
 *
 * This fires the moment the transaction is broadcast, BEFORE its outcome is known — the row lands
 * as `pending` and the indexer later flips it to `confirmed` or `reverted` with a decoded reason.
 * Writing it up front is deliberate: if the agent proposes something and the chain refuses it, the
 * attempt must still be visible. An audit trail that only records successes is not an audit trail.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = txAttemptSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const c = await collections();
  const now = new Date();
  const doc = { ...parsed.data, blockNumber: null, createdAt: now, updatedAt: now };

  if (doc.txHash) {
    // Upsert keyed on (hash, leg) so a retry from the agent cannot create a duplicate row, and so
    // a race with the indexer (which may see the receipt first) resolves to one document.
    await c.txAttempts.updateOne(
      { txHash: doc.txHash, legIndex: doc.legIndex },
      { $setOnInsert: doc },
      { upsert: true },
    );
  } else {
    await c.txAttempts.insertOne(doc);
  }

  return Response.json({ ok: true });
}
