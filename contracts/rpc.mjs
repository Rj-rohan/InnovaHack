/**
 * The single definition of the local chain's RPC endpoint.
 *
 * Imported by both `hardhat.config.ts` (which uses it as the `localhost` network URL) and
 * `scripts/node.mjs` (which derives the port it binds). Keeping one definition is the point:
 * the node and the deploy target cannot drift apart, and changing the port is one edit in
 * contracts/.env with no code change anywhere.
 *
 * 8550 rather than Ethereum's conventional 8545, because 8545 is commonly already held by another
 * node or an anvil instance. A stale listener there produces an EADDRINUSE that reads like a broken
 * project rather than a busy port.
 */
export const DEFAULT_RPC_URL = "http://127.0.0.1:8550";

/** `RPC_URL` from the environment, or the default. Call after `dotenv/config` has been imported. */
export function localRpcUrl() {
  return process.env.RPC_URL ?? DEFAULT_RPC_URL;
}
