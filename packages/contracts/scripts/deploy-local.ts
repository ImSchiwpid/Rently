import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { network } from "hardhat";

const { ethers } = await network.create();
const signers = await ethers.getSigners();
const primary = signers[8];
const backup = signers[9];

if (!primary || !backup) throw new Error("The local node must expose at least ten accounts.");

const vault = await ethers.deployContract("RentalVault", [primary.address, backup.address]);
await vault.waitForDeployment();

const address = await vault.getAddress();
const envFile = resolve(process.cwd(), "../../apps/web/.env.local");
writeFileSync(envFile, `VITE_RENTAL_VAULT_ADDRESS=${address}\nVITE_CHAIN_ID=31337\n`);
console.log(`RentalVault deployed at ${address}`);
console.log(`Wrote ${envFile}`);
