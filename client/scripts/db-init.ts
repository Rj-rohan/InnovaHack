import { ensureIndexes } from "../lib/collections";
import { getClient, getDb } from "../lib/mongodb";

/**
 * Creates the MongoDB indexes. Run once after pointing MONGODB_URI at a fresh cluster:
 *   npm run db:init
 *
 * Also verifies that change streams are available, because that determines whether the live
 * dashboard pushes or polls — better to learn that now than during a demo.
 */
async function main() {
  const db = await getDb();
  await ensureIndexes(db);
  console.log("Indexes created.");

  try {
    const probe = db.collection("tx_attempts").watch();
    await probe.close();
    console.log("Change streams: available — the dashboard will push in real time.");
  } catch {
    console.log(
      "Change streams: UNAVAILABLE (not a replica set). /api/stream will fall back to polling.\n" +
        "  This is expected on a standalone local mongod. Atlas M0 supports change streams.",
    );
  }

  const client = await getClient();
  await client.close();
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
