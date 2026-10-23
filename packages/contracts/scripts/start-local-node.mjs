import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const rpcUrl = "http://127.0.0.1:8545";
const expectedChainId = "0x7a69";

try {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
  });
  if (!response.ok) throw new Error(`Local RPC returned HTTP ${response.status}.`);
  const result = await response.json();
  if (result.result?.toLowerCase() !== expectedChainId) {
    console.error(`Port 8545 is in use by chain ${result.result ?? "unknown"}, not Hardhat chain 31337.`);
    console.error("Stop the other service or configure the project to use its intended local node.");
    process.exit(1);
  }

  console.log("Hardhat local chain is already running at http://127.0.0.1:8545 (chain ID 31337).");
  console.log("No second node was started. Keep using the existing node terminal.");
  process.exit(0);
} catch (error) {
  const code = error?.cause?.code;
  if (code !== "ECONNREFUSED" && code !== "ECONNRESET") {
    console.error(`Could not verify the local RPC at ${rpcUrl}: ${error.message}`);
    process.exit(1);
  }
}

const require = createRequire(import.meta.url);
const hardhatEntry = require.resolve("hardhat");
const hardhatCli = resolve(dirname(hardhatEntry), "cli.js");
const child = spawn(process.execPath, [hardhatCli, "node", "--network", "hardhatMainnet"], {
  cwd: process.cwd(),
  stdio: "inherit",
  windowsHide: true,
});

child.on("error", error => {
  console.error(`Could not start the Hardhat node: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
