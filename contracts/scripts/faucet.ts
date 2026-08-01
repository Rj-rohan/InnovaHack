import { network } from "hardhat";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatEther, formatUnits, getAddress, parseEther, parseUnits } from "viem";

/**
 * Sends test ETH and mUSDC to any address — for topping up a MetaMask account you imported
 * yourself rather than using one of the node's built-in ones.
 *
 *   TO=0xYourAddress npm run faucet
 *   TO=0xYourAddress ETH=5 USDC=250 npm run faucet
 *
 * Local dev chain only. Both assets are valueless: the ETH is minted by the node at genesis and
 * mUSDC has an unrestricted mint.
 */

const here = dirname(fileURLToPath(import.meta.url));

const to = process.env.TO;
if (!to) {
  throw new Error("Set TO to the address you want funded, e.g. TO=0xabc… npm run faucet");
}
const recipient = getAddress(to);
const ethAmount = parseEther(process.env.ETH ?? "10");
const usdcAmount = parseUnits(process.env.USDC ?? "1000", 6);

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

if (chainId !== 31337) {
  throw new Error(`Refusing to run on chain ${chainId}. This is a local-dev faucet only.`);
}

const [funder] = await viem.getWalletClients();

await publicClient.waitForTransactionReceipt({
  hash: await funder.sendTransaction({ to: recipient, value: ethAmount }),
});

const record = JSON.parse(
  readFileSync(join(here, "..", "deployments", `${chainId}.json`), "utf8"),
);
const usdc = await viem.getContractAt("MockUSDC", record.contracts.mockUsdc);
await publicClient.waitForTransactionReceipt({
  hash: await usdc.write.mint([recipient, usdcAmount]),
});

const [ethBalance, usdcBalance] = await Promise.all([
  publicClient.getBalance({ address: recipient }),
  usdc.read.balanceOf([recipient]) as Promise<bigint>,
]);

console.log(`Funded ${recipient}`);
console.log(`  ${formatEther(ethBalance)} ETH`);
console.log(`  ${formatUnits(usdcBalance, 6)} mUSDC`);
console.log(`\nmUSDC token address (Import tokens in MetaMask): ${record.contracts.mockUsdc}`);
