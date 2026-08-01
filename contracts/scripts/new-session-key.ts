import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Generates the agent's session key. Run once, then:
//   - the PRIVATE key goes in server/.env as AGENT_SESSION_KEY_PRIVATE (never anywhere else)
//   - the ADDRESS goes in contracts/.env as AGENT_SESSION_KEY_ADDRESS, so deploy can authorise it
//
// This key is deliberately disposable. It can sign payment proposals and nothing else: it cannot
// pause, unpause, change limits, edit the allowlist, or withdraw. Leaking it costs you at most one
// per-tx cap before the owner revokes it — which is the entire point of the design.

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("Agent session key generated.\n");
console.log(`  Address      ${account.address}`);
console.log(`  Private key  ${privateKey}\n`);
console.log("contracts/.env:  AGENT_SESSION_KEY_ADDRESS=" + account.address);
console.log("server/.env:     AGENT_SESSION_KEY_PRIVATE=" + privateKey);
console.log("\nFund the address with a little Sepolia ETH — the agent pays its own gas.");
