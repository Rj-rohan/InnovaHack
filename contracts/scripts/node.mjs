#!/usr/bin/env node
/**
 * Starts the local chain on the port `RPC_URL` names.
 *
 * A wrapper rather than a plain npm script because the port has to come from `.env` — and an npm
 * script cannot expand `${RPC_PORT:-8550}` on Windows, where `npm run` shells out to cmd.exe. This
 * keeps a single source of truth: change `RPC_URL` in contracts/.env and the node, the deploy
 * target and every client follow, with no code edit anywhere.
 *
 *   npm run node
 *   RPC_URL=http://127.0.0.1:9001 npm run node
 */

import "dotenv/config";
import { spawn } from "node:child_process";
import { DEFAULT_RPC_URL, localRpcUrl } from "../rpc.mjs";

const rpcUrl = localRpcUrl();

let port;
let hostname;
try {
  const parsed = new URL(rpcUrl);
  // A URL with no explicit port yields "" — fall back to the default's port rather than passing
  // an empty --port to Hardhat, which fails confusingly. Derived, so there is still exactly one
  // place the port number is written down.
  port = parsed.port || new URL(DEFAULT_RPC_URL).port;
  hostname = parsed.hostname;
} catch {
  console.error(`RPC_URL is not a valid URL: ${rpcUrl}`);
  process.exit(1);
}

console.log(`Starting local chain on ${rpcUrl}\n`);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["hardhat", "node", "--port", port, "--hostname", hostname],
  { stdio: "inherit", shell: process.platform === "win32" },
);

child.on("exit", (code) => process.exit(code ?? 0));

// Forward Ctrl-C so the chain shuts down cleanly instead of orphaning a listener on the port —
// an orphaned node is exactly what produces the EADDRINUSE this file exists to avoid.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
