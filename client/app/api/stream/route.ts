import { collections, type CollectionName } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_MS = 15_000;

/**
 * Server-sent events for the live dashboard.
 *
 * Primary transport is MongoDB Change Streams — the reason Mongo was chosen for this project. A
 * `watch()` on `tx_attempts` pushes a blocked payment to the browser the instant it is written,
 * with no polling loop anywhere.
 *
 * Change streams need a replica set. Atlas M0 is one, so this works on the free tier — but a
 * local standalone `mongod` is not, and `watch()` fails on first iteration rather than at call
 * time. Rather than let the dashboard silently go dead in that case, each watcher degrades to
 * timestamp polling on error. The demo is worth more than the elegance.
 */
export async function GET(request: Request) {
  const db = await getDb();
  const c = await collections(db);
  const encoder = new TextEncoder();

  let closed = false;
  const cleanups: Array<() => void> = [];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true; // client vanished mid-write
        }
      };

      // Seed the client with current state so the first paint is not empty.
      const [attempts, events, state] = await Promise.all([
        c.txAttempts.find({}).sort({ createdAt: -1 }).limit(25).toArray(),
        c.policyEvents.find({}).sort({ blockNumber: -1 }).limit(25).toArray(),
        c.chainState.findOne({ _id: "singleton" }),
      ]);
      send("snapshot", { attempts, events, state });

      const startPolling = (
        name: CollectionName,
        eventName: string,
        timeField: "createdAt" | "updatedAt",
      ) => {
        let cursor = new Date();
        const timer = setInterval(async () => {
          if (closed) return;
          try {
            const docs = await db
              .collection(name)
              .find({ [timeField]: { $gt: cursor } })
              .sort({ [timeField]: 1 })
              .limit(50)
              .toArray();
            for (const doc of docs) {
              const stamp = doc[timeField] as Date | undefined;
              if (stamp && stamp > cursor) cursor = stamp;
              send(eventName, doc);
            }
          } catch {
            /* transient read error — next tick will retry */
          }
        }, POLL_INTERVAL_MS);
        cleanups.push(() => clearInterval(timer));
      };

      const watch = (
        name: CollectionName,
        eventName: string,
        timeField: "createdAt" | "updatedAt",
      ) => {
        const changeStream = db
          .collection(name)
          .watch([], { fullDocument: "updateLookup" });
        cleanups.push(() => void changeStream.close().catch(() => {}));

        void (async () => {
          try {
            for await (const change of changeStream) {
              if (closed) break;
              const doc = (change as { fullDocument?: unknown }).fullDocument;
              if (doc) send(eventName, doc);
            }
          } catch {
            if (closed) return;
            // Almost always "not a replica set". Fall back rather than going silent.
            send("notice", {
              message: `change stream unavailable for ${name}; polling instead`,
            });
            startPolling(name, eventName, timeField);
          }
        })();
      };

      watch("tx_attempts", "tx", "updatedAt");
      watch("policy_events", "policy", "createdAt");
      watch("chain_state", "state", "updatedAt");
      watch("decisions", "decision", "createdAt");

      // Proxies and load balancers drop idle connections; a comment line keeps it warm and is
      // ignored by the EventSource parser.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);
      cleanups.push(() => clearInterval(heartbeat));

      request.signal.addEventListener("abort", () => {
        closed = true;
        for (const fn of cleanups) fn();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },

    cancel() {
      closed = true;
      for (const fn of cleanups) fn();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
