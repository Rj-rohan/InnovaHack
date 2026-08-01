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
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("OWNER_PRIVATE_KEY")],
    },
  },
});
