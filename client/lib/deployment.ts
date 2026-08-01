import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Abi } from "viem";

/**
 * Reads the deployment record written by `contracts/scripts/deploy.ts`.
 *
 * One file is the single source of truth for addresses and ABIs across contracts/, client/ and
 * server/. The alternative — pasting the same address into three .env files — reliably produces
 * one stale copy and an afternoon of debugging.
 *
 * Server-only. Do not import from a client component; it touches `node:fs`.
 */

export interface DeploymentRecord {
  chainId: number;
  deployedAt: string;
  deployBlock: string;
  owner: `0x${string}`;
  agentSessionKey: `0x${string}`;
  contracts: {
    agentWallet: `0x${string}`;
    mockUsdc: `0x${string}`;
  };
  policy: { perTxCap: string; rollingCap: string; decimals: number };
  counterparties: { address: `0x${string}`; tag: string; label: string }[];
  abi: { agentWallet: Abi; mockUsdc: Abi };
}

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11155111);

function deploymentPath(chainId: number): string {
  // client/ and contracts/ are siblings under the repo root.
  return join(process.cwd(), "..", "contracts", "deployments", `${chainId}.json`);
}

let cached: DeploymentRecord | null = null;

/** Returns null when the contracts have not been deployed yet, so the UI can say so. */
export function tryLoadDeployment(chainId: number = CHAIN_ID): DeploymentRecord | null {
  if (cached && cached.chainId === chainId) return cached;

  const path = deploymentPath(chainId);
  if (!existsSync(path)) return null;

  cached = JSON.parse(readFileSync(path, "utf8")) as DeploymentRecord;
  return cached;
}

export function loadDeployment(chainId: number = CHAIN_ID): DeploymentRecord {
  const record = tryLoadDeployment(chainId);
  if (!record) {
    throw new Error(
      `No deployment found for chain ${chainId}. Run: cd contracts && npm run deploy:sepolia`,
    );
  }
  return record;
}

export function explorerTxUrl(txHash: string, chainId: number = CHAIN_ID): string {
  const base =
    chainId === 11155111 ? "https://sepolia.etherscan.io" : "https://etherscan.io";
  return `${base}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string, chainId: number = CHAIN_ID): string {
  const base =
    chainId === 11155111 ? "https://sepolia.etherscan.io" : "https://etherscan.io";
  return `${base}/address/${address}`;
}
