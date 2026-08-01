import { MongoClient, type Db } from "mongodb";

/**
 * Single shared MongoDB connection.
 *
 * The global cache is not premature optimisation: Next.js re-executes modules on every hot
 * reload, so a plain `new MongoClient()` at module scope opens a fresh connection pool on every
 * file save until Atlas starts refusing connections. Stashing the promise on `globalThis` survives
 * HMR. In production the module is evaluated once, so the plain path is enough.
 */

declare global {
  // eslint-disable-next-line no-var
  var _killSwitchMongo: Promise<MongoClient> | undefined;
}

const DB_NAME = process.env.MONGODB_DB ?? "killswitch";

function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Copy client/.env.example to client/.env.local and add your Atlas connection string.",
    );
  }

  // Fail fast rather than hanging a request for 30s when the cluster is unreachable — on a
  // shared M0 tier a slow cold connect is normal, but an unreachable one should surface quickly.
  return new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
    retryWrites: true,
  }).connect();
}

/** Lazy on purpose: throwing at import time would break `next build` on a machine without env. */
export function getClient(): Promise<MongoClient> {
  if (process.env.NODE_ENV === "development") {
    globalThis._killSwitchMongo ??= connect();
    return globalThis._killSwitchMongo;
  }
  globalThis._killSwitchMongo ??= connect();
  return globalThis._killSwitchMongo;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(DB_NAME);
}
