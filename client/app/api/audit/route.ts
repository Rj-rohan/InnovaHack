import { collections } from "@/lib/collections";
import { tryLoadDeployment } from "@/lib/deployment";

export const dynamic = "force-dynamic";

/**
 * Audit log export.
 *
 * GET /api/audit          → JSON
 * GET /api/audit?fmt=csv  → CSV download
 *
 * Returns every tx attempt and policy event. Real finance systems need tamper-evident audit
 * trails; this endpoint makes the on-chain record downloadable in one click.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fmt = searchParams.get("fmt") ?? "json";

  const deployment = tryLoadDeployment();
  const c = await collections();

  const [attempts, events] = await Promise.all([
    c.txAttempts.find({}).sort({ createdAt: -1 }).limit(500).toArray(),
    c.policyEvents.find({}).sort({ blockNumber: -1 }).limit(500).toArray(),
  ]);

  if (fmt === "csv") {
    const rows = [
      ["timestamp", "type", "txHash", "from", "to", "vendor", "amountUsdc", "status", "reason", "blockNumber", "mode"].join(","),
      ...attempts.map((a) =>
        [
          new Date(a.createdAt).toISOString(),
          "tx_attempt",
          a.txHash ?? "",
          a.from,
          a.to,
          a.vendor ?? "",
          a.amount ? (Number(a.amount) / 1e6).toFixed(6) : "",
          a.status,
          a.reason ?? "",
          a.blockNumber ?? "",
          a.mode,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
      ...events.map((e) =>
        [
          new Date(e.createdAt).toISOString(),
          "policy_event",
          e.txHash,
          "",
          "",
          e.event,
          "",
          "",
          JSON.stringify(e.args),
          e.blockNumber,
          "",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");

    return new Response(rows, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="killswitch-audit-${Date.now()}.csv"`,
      },
    });
  }

  return Response.json({
    exportedAt: new Date().toISOString(),
    chainId: deployment?.chainId ?? null,
    wallet: deployment?.contracts.agentWallet ?? null,
    txAttempts: attempts,
    policyEvents: events,
  });
}
