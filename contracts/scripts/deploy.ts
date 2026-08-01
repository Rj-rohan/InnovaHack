import { network } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseUnits, getAddress, stringToHex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Caps are sized for a live demo, not for realism. Sepolia has no time travel, so the rolling
// window has to be trippable within a couple of minutes on stage: at 40/100 the third payment
// in a run is the one that gets blocked.
const PER_TX_CAP = parseUnits("40", 6);
const ROLLING_CAP = parseUnits("100", 6);
const INITIAL_FUNDING = parseUnits("10000", 6);
const SESSION_DURATION_DAYS = 30n;

const TAG_VENDOR = stringToHex("vendor", { size: 32 });
const TAG_GAS = stringToHex("gas", { size: 32 });

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

const { viem } = await network.create();

const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

const chainId = await publicClient.getChainId();
console.log(`Deploying to chain ${chainId} as ${deployer.account.address}`);

// The agent's session key is generated separately and lives only in server/.env. The deployer
// (owner) key must never be the same account — the entire premise is that the process running
// the agent cannot unpause itself.
const agentSessionKey = getAddress(required("AGENT_SESSION_KEY_ADDRESS"));
if (agentSessionKey.toLowerCase() === deployer.account.address.toLowerCase()) {
  throw new Error(
    "AGENT_SESSION_KEY_ADDRESS must not equal the owner/deployer address — the agent would be able to unfreeze itself.",
  );
}

// Demo counterparties. Any address works; these only ever receive mUSDC.
const vendorAcme = getAddress(required("DEMO_VENDOR_1"));
const vendorGlobex = getAddress(required("DEMO_VENDOR_2"));
const gasRefill = getAddress(required("DEMO_GAS_REFILL"));

console.log("\nDeploying MockUSDC...");
const usdc = await viem.deployContract("MockUSDC");
console.log(`  MockUSDC     ${usdc.address}`);

console.log("Deploying AgentWallet...");
const wallet = await viem.deployContract("AgentWallet", [
  usdc.address,
  deployer.account.address,
  PER_TX_CAP,
  ROLLING_CAP,
]);
console.log(`  AgentWallet  ${wallet.address}`);

const deployBlock = await publicClient.getBlockNumber();

console.log("\nFunding the wallet...");
await publicClient.waitForTransactionReceipt({
  hash: await usdc.write.mint([wallet.address, INITIAL_FUNDING]),
});

console.log("Granting the agent a session key...");
const latestBlock = await publicClient.getBlock();
const expiresAt = latestBlock.timestamp + SESSION_DURATION_DAYS * 24n * 60n * 60n;
await publicClient.waitForTransactionReceipt({
  hash: await wallet.write.grantSession([agentSessionKey, expiresAt]),
});

console.log("Registering allowlisted counterparties...");
for (const [address, tag, label] of [
  [vendorAcme, TAG_VENDOR, "Acme Supplies (vendor)"],
  [vendorGlobex, TAG_VENDOR, "Globex Logistics (vendor)"],
  [gasRefill, TAG_GAS, "Gas Refill Service (gas)"],
] as const) {
  await publicClient.waitForTransactionReceipt({
    hash: await wallet.write.setCounterparty([address, tag]),
  });
  console.log(`  ${label} -> ${address}`);
}

for (const [tag, label] of [
  [TAG_VENDOR, "vendor"],
  [TAG_GAS, "gas"],
] as const) {
  await publicClient.waitForTransactionReceipt({
    hash: await wallet.write.setTagEnabled([tag, true]),
  });
  console.log(`  category "${label}" enabled`);
}

// Single source of truth for addresses + ABIs, read by both client/ and server/. Committing this
// means nobody has to copy an address between three .env files and get one of them wrong.
const record = {
  chainId,
  deployedAt: new Date().toISOString(),
  deployBlock: deployBlock.toString(),
  owner: deployer.account.address,
  agentSessionKey,
  contracts: {
    agentWallet: wallet.address,
    mockUsdc: usdc.address,
  },
  policy: {
    perTxCap: PER_TX_CAP.toString(),
    rollingCap: ROLLING_CAP.toString(),
    decimals: 6,
  },
  counterparties: [
    { address: vendorAcme, tag: "vendor", label: "Acme Supplies" },
    { address: vendorGlobex, tag: "vendor", label: "Globex Logistics" },
    { address: gasRefill, tag: "gas", label: "Gas Refill Service" },
  ],
  abi: {
    agentWallet: wallet.abi,
    mockUsdc: usdc.abi,
  },
};

const outDir = join(root, "deployments");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${chainId}.json`);
writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);

console.log(`\nWrote ${outFile}`);
console.log("\nNext steps:");
console.log(`  1. Set NEXT_PUBLIC_WALLET_ADDRESS=${wallet.address} in client/.env.local`);
console.log(`  2. Set WALLET_ADDRESS=${wallet.address} in server/.env`);
console.log(`  3. Verify: npx hardhat verify --network sepolia ${wallet.address} \\`);
console.log(
  `       ${usdc.address} ${deployer.account.address} ${PER_TX_CAP} ${ROLLING_CAP}`,
);
