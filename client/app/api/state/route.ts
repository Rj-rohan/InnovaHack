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
        // Neutral wording: this payload reaches the browser, so it must not read as a build
        // instruction. Operator guidance lives in SETUP.md.
        message: "No wallet is under management on the configured network.",
      },
      { status: 503 },
    );
  }

  // History is a nice-to-have; the contract addresses are not.
  //
  // An unreachable database used to fail this whole route, which left the browser with no wallet
  // address — and therefore a kill switch that silently did nothing when held. The owner's ability
  // to freeze must not depend on Mongo being up, so the deployment half is returned either way and
  // only the recorded history degrades.
  let history: {
    state: Awaited<ReturnType<typeof loadHistory>>["state"];
    attempts: unknown[];
    events: unknown[];
    decisions: unknown[];
    run: unknown;
    reviewItems: unknown[];
  } | null = null;

  try {
    history = await loadHistory();
  } catch {
    history = null;
  }

  const state = history?.state ?? null;

  return Response.json({
    deployed: true,
    chainId: deployment.chainId,
    contracts: deployment.contracts,
    owner: deployment.owner,
    agentSessionKey: deployment.agentSessionKey,
    counterparties: deployment.counterparties,
    state,
    attempts: history?.attempts ?? [],
    events: history?.events ?? [],
    decisions: history?.decisions ?? [],
    run: history?.run ?? null,
    reviewItems: history?.reviewItems ?? [],
    /** False when the recorded history is unavailable — the UI says so rather than showing zeroes. */
    historyAvailable: history !== null,
    // Null until the indexer has written once — the UI should say "indexer not running" rather
    // than silently showing stale-looking zeroes.
    indexerHealthy: state != null && Date.now() - new Date(state.updatedAt).getTime() < 30_000,
  });
}

async function loadHistory() {
  const c = await collections();

  const [state, attempts, events, decisions, run, reviewItems] = await Promise.all([
    c.chainState.findOne({ _id: "singleton" }),
    c.txAttempts.find({}).sort({ createdAt: -1 }).limit(50).toArray(),
    c.policyEvents.find({}).sort({ blockNumber: -1, logIndex: -1 }).limit(50).toArray(),
    c.decisions.find({}).sort({ createdAt: -1 }).limit(25).toArray(),
    c.runs.find({}).sort({ startedAt: -1 }).limit(1).next(),
    c.reviewItems.find({}).sort({ createdAt: -1 }).limit(25).toArray(),
  ]);

  return { state, attempts, events, decisions, run, reviewItems };
}
