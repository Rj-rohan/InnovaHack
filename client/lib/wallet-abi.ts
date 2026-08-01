/**
 * Hand-written slice of the AgentWallet ABI for browser use.
 *
 * The full ABI lives in the deployment record, but that file is read with `node:fs` and is far
 * larger than the browser needs. The freeze button only ever calls three functions, so ship three.
 */
export const walletControlAbi = [
  { type: "function", name: "pause", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "unpause", inputs: [], outputs: [], stateMutability: "nonpayable" },
  {
    type: "function",
    name: "setThrottle",
    inputs: [{ name: "bps", type: "uint16" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "throttleBps",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
    stateMutability: "view",
  },
] as const;
