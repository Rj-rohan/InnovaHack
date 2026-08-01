/**
 * Hand-written slice of the AgentWallet ABI for browser use.
 *
 * The full ABI lives in the deployment record, but that file is read with `node:fs` and is far
 * larger than the browser needs. This slice is exactly what the owner console signs — every
 * `onlyOwner` write reachable from the UI — plus the custom errors, so a failed write can be
 * named ("over the per-transaction cap") instead of shown as a hex selector.
 *
 * `pay` and `payBatch` are deliberately absent: the agent calls those, never the dashboard.
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

  // --- Remaining owner writes, for /console --------------------------------
  {
    type: "function",
    name: "setLimits",
    inputs: [
      { name: "newPerTxCap", type: "uint256" },
      { name: "newRollingCap", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    // Passing bytes32(0) as the tag removes the counterparty. The UI says "Remove" and sends the
    // zero tag, rather than exposing that mechanic to the owner.
    type: "function",
    name: "setCounterparty",
    inputs: [
      { name: "account", type: "address" },
      { name: "tag", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setTagEnabled",
    inputs: [
      { name: "tag", type: "bytes32" },
      { name: "enabled", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "grantSession",
    inputs: [
      { name: "key", type: "address" },
      { name: "expiresAt", type: "uint48" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeSession",
    inputs: [{ name: "key", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // --- Custom errors, so a revert can be named -----------------------------
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "WalletPaused", inputs: [] },
  { type: "error", name: "InvalidThrottle", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "EmptyBatch", inputs: [] },
  { type: "error", name: "SpendHistoryFull", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  { type: "error", name: "SessionInvalid", inputs: [{ name: "key", type: "address" }] },
  { type: "error", name: "CounterpartyNotAllowed", inputs: [{ name: "to", type: "address" }] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
  {
    type: "error",
    name: "SpendLimitExceeded",
    inputs: [
      { name: "attempted", type: "uint256" },
      { name: "cap", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "RollingLimitExceeded",
    inputs: [
      { name: "attempted", type: "uint256" },
      { name: "remaining", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "InsufficientBalance",
    inputs: [
      { name: "attempted", type: "uint256" },
      { name: "available", type: "uint256" },
    ],
  },
] as const;
