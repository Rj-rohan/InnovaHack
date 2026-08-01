import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  paths: {
    sources: { solidity: ["src"] },
    tests: { solidity: "test" },
  },
  solidity: {
    profiles: {
      // Optimizer is on in BOTH profiles on purpose: the bytecode we test is the
      // bytecode we deploy and verify on Etherscan. Divergence there is a classic
      // way to ship a contract whose tests passed against different code.
      default: {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      production: {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  networks: {
    // In-process chain used by `hardhat test`.
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // The demo target: a standalone `npx hardhat node` on 31337. Accounts are the well-known
    // deterministic Hardhat set, already funded — no faucet, no key generation. `evm_increaseTime`
    // is available here, which is what makes the 24h rolling-window demo possible at all.
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    // Kept in place so promotion to a public network is a deploy, not a rewrite.
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("OWNER_PRIVATE_KEY")],
    },
  },
});
