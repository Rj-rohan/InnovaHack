import { collections, ensureIndexes } from "../lib/collections";
import { getClient, getDb } from "../lib/mongodb";

/**
 * Clears recorded history and recreates the indexes.
 *
 *   npm run db:reset
 *
 * Run this whenever the chain is redeployed. Rows from a previous run reference contract
 * addresses, invoice IDs and vendors that no longer exist, and the review queue is the case where
 * that actually breaks something: the agent service owns the queue in memory, so approving a
 * leftover row posts an invoice ID the running agent has never heard of and the button appears to
 * do nothing.
 *
 * Nothing here touches the chain — redeploy separately with `npm run deploy:local` in contracts/.
 */
async function main() {
  const db = await getDb();
  const c = await collections(db);

  const targets = [
    ["tx_attempts", c.txAttempts],
    ["policy_events", c.policyEvents],
    ["decisions", c.decisions],
    ["agent_runs", c.runs],
    ["review_items", c.reviewItems],
    ["chain_state", c.chainState],
  ] as const;

  for (const [name, collection] of targets) {
    const { deletedCount } = await collection.deleteMany({});
    console.log(`  cleared ${name.padEnd(14)} ${deletedCount} document(s)`);
  }

  await ensureIndexes(db);
  console.log("\nIndexes recreated. Restart the indexer and the agent service.");

  const client = await getClient();
  await client.close();
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
