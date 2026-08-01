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

const LOCAL_CHAIN_ID = 31337;

const { viem } = await network.create();

const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const isLocal = chainId === LOCAL_CHAIN_ID;

// Check the signing key BEFORE asking for wallet clients. Hardhat resolves accounts lazily, so a
// placeholder key surfaces as a 40-line stack trace out of an elliptic-curve library rather than
// "you left 0x in your .env" — which is what it actually means, every time.
if (!isLocal) {
  const key = process.env.OWNER_PRIVATE_KEY ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    const detail = key === "" ? "not set" : `set but ${key.length} chars — expected 66`;
    throw new Error(
      `OWNER_PRIVATE_KEY is ${detail}.\n` +
        `  Deploying to chain ${chainId} needs a real funded key in contracts/.env.\n` +
        "  It must be 0x followed by 64 hex characters.\n" +
        "  Export it from MetaMask: Account details -> Show private key.",
    );
  }
}

const walletClients = await viem.getWalletClients();
const [deployer] = walletClients;

console.log(`Deploying to chain ${chainId} as ${deployer.account.address}`);
if (isLocal) {
  console.log("Local dev chain — using the node's deterministic accounts, no env vars needed.\n");
  // Deployment itself wants instant mining. Interval mining is switched on at the end.
  await publicClient.request({
    method: "evm_setAutomine" as never,
    params: [true] as never,
  });
}

/**
 * On the local dev chain, take an address from the node's pre-funded deterministic accounts.
 * On any other chain, require it explicitly.
 *
 * The split matters: Hardhat's accounts are derived from a mnemonic printed in every tutorial on
 * the internet. Defaulting to them on a public network would mean deploying a wallet whose owner
 * key is public knowledge, so that path stays closed and env vars stay mandatory off-31337.
 */
function participant(index: number, envName: string): `0x${string}` {
  if (!isLocal) return getAddress(required(envName));

  const client = walletClients[index];
  if (!client) {
    throw new Error(
      `The local node exposed only ${walletClients.length} accounts; need at least ${index + 1}. ` +
        "Start it with `npx hardhat node`.",
    );
  }
  return getAddress(client.account.address);
}

// The agent's session key. It must never be the owner account — the entire premise is that the
// process running the agent cannot unpause itself.
const agentSessionKey = participant(1, "AGENT_SESSION_KEY_ADDRESS");
if (agentSessionKey.toLowerCase() === deployer.account.address.toLowerCase()) {
  throw new Error(
    "The agent session key must not equal the owner/deployer address — the agent would be able to unfreeze itself.",
  );
}

// Demo counterparties. Any address works; these only ever receive mUSDC.
const vendorAcme = participant(2, "DEMO_VENDOR_1");
const vendorGlobex = participant(3, "DEMO_VENDOR_2");
const gasRefill = participant(4, "DEMO_GAS_REFILL");

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

if (isLocal) {
  /**
   * Switch the node from automine to interval mining.
   *
   * This is not cosmetic. With automine on, Hardhat simulates every transaction at submission and
   * *rejects* one that would revert — it never reaches a block. That would quietly destroy the
   * central demo: a policy-violating payment would surface as a client-side error instead of a
   * reverted transaction on chain, and there would be nothing for the indexer to decode.
   *
   * With automine off, transactions enter a mempool and are mined on a timer exactly as they are
   * on a public network, so a refused payment becomes a real reverted transaction with real revert
   * data. Two-second blocks also give the owner a genuine window to land a freeze mid-run, without
   * Sepolia's twelve-second wait.
   */
  const BLOCK_TIME_MS = 2000;
  await publicClient.request({
    method: "evm_setAutomine" as never,
    params: [false] as never,
  });
  await publicClient.request({
    method: "evm_setIntervalMining" as never,
    params: [BLOCK_TIME_MS] as never,
  });
  console.log(
    `\nNode switched to interval mining (${BLOCK_TIME_MS}ms blocks).\n` +
      "  Failing transactions now mine as reverted rather than being rejected on submit —\n" +
      "  which is what makes a blocked payment visible on chain.\n" +
      "  Restarting the node resets this; re-run this script after any restart.",
  );
}

console.log("\nNext steps:");
console.log("  1. cd ../client && CHAIN_ID=" + chainId + " npm run sync:chain");

if (isLocal) {
  console.log("  2. Nothing else — client/ and server/ default to chain 31337.");
  console.log(
    "\n  The agent signs as account #1 (" +
      agentSessionKey +
      ").\n  server/.env.example already carries that account's well-known test key.",
  );
} else {
  console.log(`  2. Set CHAIN_ID=${chainId} and RPC_URL in client/.env.local and server/.env`);
  console.log(`  3. Verify: npx hardhat verify --network sepolia ${wallet.address} \\`);
  console.log(
    `       ${usdc.address} ${deployer.account.address} ${PER_TX_CAP} ${ROLLING_CAP}`,
  );
}
