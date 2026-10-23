import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ContractFactory, JsonRpcProvider } from "ethers";

const rpcUrl = "http://127.0.0.1:8545";
const provider = new JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();

if (network.chainId !== 31337n) {
  throw new Error(`Expected Hardhat Local chain 31337 at ${rpcUrl}, got ${network.chainId}.`);
}

const envFile = resolve(process.cwd(), "../../apps/web/.env.local");
const artifactFile = resolve(process.cwd(), "artifacts/contracts/RentalVault.sol/RentalVault.json");

if (!existsSync(artifactFile)) {
  throw new Error("RentalVault artifact is missing. Run npm.cmd run contracts:build first.");
}

const currentAddress = existsSync(envFile)
  ? readFileSync(envFile, "utf8").match(/^VITE_RENTAL_VAULT_ADDRESS=(0x[a-fA-F0-9]{40})$/m)?.[1]
  : undefined;

if (currentAddress && (await provider.getCode(currentAddress)) !== "0x") {
  console.log(`RentalVault is already deployed at ${currentAddress} on local chain 31337.`);
  console.log("No duplicate contract was deployed.");
  process.exit(0);
}

const accounts = await provider.send("eth_accounts", []);
if (accounts.length < 10) throw new Error("The local node must expose at least ten accounts.");

const primary = await provider.getSigner(8);
const backup = await provider.getSigner(9);
const artifact = JSON.parse(readFileSync(artifactFile, "utf8"));
const vault = await new ContractFactory(artifact.abi, artifact.bytecode, primary).deploy(
  await primary.getAddress(),
  await backup.getAddress(),
);
await vault.waitForDeployment();

const address = await vault.getAddress();
const deploymentReceipt = await vault.deploymentTransaction()?.wait();
if (!deploymentReceipt || deploymentReceipt.status !== 1) {
  throw new Error("The RentalVault deployment transaction did not succeed.");
}

let deployedCode = "0x";
for (let attempt = 0; attempt < 20; attempt += 1) {
  deployedCode = await provider.getCode(address);
  if (deployedCode !== "0x") break;
  await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
}
if (deployedCode === "0x") throw new Error("Deployment receipt succeeded, but the local RPC did not return contract bytecode.");

const existingEnv = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const preservedLines = existingEnv.split(/\r?\n/).filter(line =>
  line.trim() && !/^\s*VITE_(RENTAL_VAULT_ADDRESS|CHAIN_ID)\s*=/.test(line),
);
writeFileSync(envFile, [
  ...preservedLines,
  `VITE_RENTAL_VAULT_ADDRESS=${address}`,
  "VITE_CHAIN_ID=31337",
].join("\n") + "\n");
console.log(`RentalVault deployed at ${address}`);
console.log(`Wrote ${envFile}`);
console.log("Deployment is complete. Restart the web app so Vite reloads the contract address.");
