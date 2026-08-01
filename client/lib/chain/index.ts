import deploymentJson from "./deployment.json";

export { agentWalletAbi } from "./abi";

export type Address = `0x${string}`;

export type CounterpartyRecord = {
  address: Address;
  tag: string;
  label: string;
};

export type Deployment = {
  deployed: boolean;
  chainId: number;
  deployedAt: string | null;
  deployBlock: string;
  owner: Address | null;
  agentSessionKey: Address | null;
  contracts: {
    agentWallet: Address | null;
    mockUsdc: Address | null;
  };
  policy: {
    perTxCap: string;
    rollingCap: string;
    decimals: number;
  };
  counterparties: CounterpartyRecord[];
};

/** Written by `npm run sync:chain`. Committed, so a fresh clone builds without Hardhat. */
export const deployment = deploymentJson as Deployment;

/** A deployment that actually has addresses. Everything chain-facing narrows through this. */
export type LiveDeployment = Deployment & {
  deployed: true;
  owner: Address;
  contracts: { agentWallet: Address; mockUsdc: Address };
};

export function isLive(d: Deployment): d is LiveDeployment {
  return d.deployed && Boolean(d.contracts.agentWallet) && Boolean(d.owner);
}

export const DECIMALS = deployment.policy.decimals;
export const TOKEN_SYMBOL = "mUSDC";

const EXPLORERS: Record<number, string> = {
  11155111: "https://sepolia.etherscan.io",
  1: "https://etherscan.io",
};

export const explorerBase = EXPLORERS[deployment.chainId] ?? null;

export function explorerTx(hash: string): string | null {
  return explorerBase ? `${explorerBase}/tx/${hash}` : null;
}

export function explorerAddress(address: string): string | null {
  return explorerBase ? `${explorerBase}/address/${address}` : null;
}

/** Label a known counterparty; falls back to the raw address for anything unrecognised. */
export function counterpartyLabel(address: string): string | null {
  const match = deployment.counterparties.find(
    (c) => c.address.toLowerCase() === address.toLowerCase(),
  );
  return match?.label ?? null;
}
