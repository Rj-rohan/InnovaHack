import { network } from "hardhat";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits, parseUnits } from "viem";

/**
 * Tops the wallet up with mUSDC.
 *
 *   npm run fund              # +10,000 mUSDC
 *   AMOUNT=500 npm run fund   # +500
 *
 * `deploy:local` already funds the wallet, so this is only for a long session that drains it.
 * MockUSDC.mint is deliberately unrestricted — it is a testnet token with no value, and access
 * control there would only make the demo harder to run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const amount = parseUnits(process.env.AMOUNT ?? "10000", 6);

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

const record = JSON.parse(
  readFileSync(join(here, "..", "deployments", `${chainId}.json`), "utf8"),
);

const usdc = await viem.getContractAt("MockUSDC", record.contracts.mockUsdc);
const wallet = record.contracts.agentWallet as `0x${string}`;

const before = (await usdc.read.balanceOf([wallet])) as bigint;
await publicClient.waitForTransactionReceipt({
  hash: await usdc.write.mint([wallet, amount]),
});
const after = (await usdc.read.balanceOf([wallet])) as bigint;

console.log(`Wallet ${wallet}`);
console.log(`  ${formatUnits(before, 6)} -> ${formatUnits(after, 6)} mUSDC`);
