import type { Chain } from "viem";
import { hardhat, sepolia } from "viem/chains";

/**
 * Per-chain settings, keyed by chain id.
 *
 * The point of this file is that **nothing else in the app hardcodes a chain**. Running against a
 * local node is one row in a table, not an assumption baked into the indexer, wagmi, and half a
 * dozen `chainId === 11155111` checks. Promoting to a public network is two env vars and a deploy,
 * with no code edits — which is only true if every chain-specific number lives here.
 *
 * Browser-safe: no `node:fs`, no MongoDB. Both the indexer and client components import it.
 */

export interface ChainProfile {
  chainId: number;
  label: string;
  viemChain: Chain;
  /** Base explorer URL, or null when the chain has none (local). */
  explorerBase: string | null;
  /**
   * Blocks to wait before trusting a log. Zero is correct locally — there are no reorgs on a
   * single-node chain and waiting only makes the dashboard feel laggy.
   */
  confirmations: bigint;
  /** Max `getLogs` span. Public RPCs reject large ranges; a local node does not care. */
  maxBlockRange: bigint;
  /** Indexer poll interval. Matched roughly to block time. */
  pollMs: number;
  /**
   * Whether `evm_increaseTime` is permitted. Only ever true for a dev chain — this is what makes
   * the 24h rolling-window demo possible, and what must never be reachable on a public network.
   */
  allowTimeTravel: boolean;
}

export const CHAIN_PROFILES: Record<number, ChainProfile> = {
  31337: {
    chainId: 31337,
    label: "Hardhat (local)",
    viemChain: hardhat,
    explorerBase: null,
    confirmations: 0n,
    maxBlockRange: 100_000n,
    pollMs: 1000,
    allowTimeTravel: true,
  },
  11155111: {
    chainId: 11155111,
    label: "Sepolia",
    viemChain: sepolia,
    explorerBase: "https://sepolia.etherscan.io",
    confirmations: 1n,
    maxBlockRange: 800n,
    pollMs: 6000,
    allowTimeTravel: false,
  },
};

export const DEFAULT_CHAIN_ID = 31337;

/**
 * `NEXT_PUBLIC_CHAIN_ID` is read first so client components resolve the same chain as the server.
 * Only `NEXT_PUBLIC_*` is inlined into the browser bundle; the bare `CHAIN_ID` is the server-side
 * fallback for the indexer and route handlers.
 */
export const CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? DEFAULT_CHAIN_ID,
);

export function getChainProfile(chainId: number = CHAIN_ID): ChainProfile {
  const profile = CHAIN_PROFILES[chainId];
  if (!profile) {
    throw new Error(
      `No chain profile for chain ${chainId}. Add one to client/lib/chains.ts — every ` +
        `chain-specific setting (explorer, confirmations, poll interval) is resolved from there.`,
    );
  }
  return profile;
}

export function isLocalChain(chainId: number = CHAIN_ID): boolean {
  return getChainProfile(chainId).explorerBase === null;
}

/** Null on a chain with no explorer, so the UI can render a plain hash instead of a dead link. */
export function explorerTxUrl(txHash: string, chainId: number = CHAIN_ID): string | null {
  const base = CHAIN_PROFILES[chainId]?.explorerBase;
  return base ? `${base}/tx/${txHash}` : null;
}

export function explorerAddressUrl(address: string, chainId: number = CHAIN_ID): string | null {
  const base = CHAIN_PROFILES[chainId]?.explorerBase;
  return base ? `${base}/address/${address}` : null;
}

/** The RPC every process talks to. One variable, so switching chains never means editing code. */
export function rpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_RPC_URL ??
    process.env.RPC_URL ??
    "http://127.0.0.1:8545"
  );
}
