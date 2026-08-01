import { collections } from "@/lib/collections";
import { tryLoadDeployment } from "@/lib/deployment";

export const dynamic = "force-dynamic";

/**
 * Everything the dashboard needs for a first paint, in one request.
 *
 * The SSE feed at /api/stream carries live deltas after this; the two are meant to be used
 * together (fetch once, then subscribe). Kept read-only and unauthenticated — it exposes testnet
 * state that is already public on Etherscan.
 */
export async function GET() {
  const deployment = tryLoadDeployment();
  if (!deployment) {
    return Response.json(
      {
        deployed: false,
        message: "No deployment record found. Run: cd contracts && npm run deploy:sepolia",
      },
      { status: 503 },
    );
  }

  const c = await collections();

  const [state, attempts, events, decisions, run, reviewItems] = await Promise.all([
    c.chainState.findOne({ _id: "singleton" }),
    c.txAttempts.find({}).sort({ createdAt: -1 }).limit(50).toArray(),
    c.policyEvents.find({}).sort({ blockNumber: -1, logIndex: -1 }).limit(50).toArray(),
    c.decisions.find({}).sort({ createdAt: -1 }).limit(25).toArray(),
    c.runs.find({}).sort({ startedAt: -1 }).limit(1).next(),
    c.reviewItems.find({}).sort({ createdAt: -1 }).limit(25).toArray(),
  ]);

  return Response.json({
    deployed: true,
    chainId: deployment.chainId,
    contracts: deployment.contracts,
    owner: deployment.owner,
    agentSessionKey: deployment.agentSessionKey,
    counterparties: deployment.counterparties,
    state,
    attempts,
    events,
    decisions,
    run,
    reviewItems,
    // Null until the indexer has written once — the UI should say "indexer not running" rather
    // than silently showing stale-looking zeroes.
    indexerHealthy: state != null && Date.now() - new Date(state.updatedAt).getTime() < 30_000,
  });
}
