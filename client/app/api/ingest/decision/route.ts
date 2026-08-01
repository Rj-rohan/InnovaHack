import { collections, ensureIndexes } from "@/lib/collections";
import { authorized, decisionSchema } from "@/lib/ingest-schemas";

export const dynamic = "force-dynamic";

/** The Python agent posts one of these per decision cycle. */
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

  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const c = await collections();
  const now = new Date();

  await c.decisions.insertOne({ ...parsed.data, createdAt: now });

  // Upsert the run so the dashboard has something to group by even if /agent/start was missed.
  await c.runs.updateOne(
    { runId: parsed.data.runId },
    {
      $setOnInsert: { runId: parsed.data.runId, startedAt: now, endedAt: null },
      $set: { mode: parsed.data.mode, status: "running" },
    },
    { upsert: true },
  );

  return Response.json({ ok: true });
}

/** Convenience for local setup: POST /api/ingest/decision?init=1 creates the indexes. */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  await ensureIndexes();
  return Response.json({ ok: true, indexes: "ensured" });
}
