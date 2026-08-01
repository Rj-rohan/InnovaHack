import { collections } from "@/lib/collections";
import { authorized, reviewItemSchema } from "@/lib/ingest-schemas";

export const dynamic = "force-dynamic";

/**
 * Projects the agent's hold-for-review queue into MongoDB.
 *
 * Write-only mirror: the queue is owned by the agent service, which posts here when it holds an
 * invoice and again when the owner approves or rejects it. The console reads this collection and
 * sends owner decisions back to the agent service — not to Mongo — so there is exactly one writer
 * and no two-way sync to get wrong.
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

  const parsed = reviewItemSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const c = await collections();
  const now = new Date();
  const { invoiceId, ...rest } = parsed.data;

  await c.reviewItems.updateOne(
    { invoiceId },
    {
      $set: { ...rest, updatedAt: now },
      $setOnInsert: { invoiceId, createdAt: now },
    },
    { upsert: true },
  );

  return Response.json({ ok: true });
}
