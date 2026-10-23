# Rently

Rently is a student peer-to-peer rental marketplace prototype. Listings, booking requests, and booking metadata are stored by the Express API in MongoDB. Rental agreements, funding, handover and return confirmations, escrow, credits, and dispute settlement are handled by the `RentalVault` contract on a local Hardhat 3 chain.

This prototype is for local demonstrations only. The contract has not been independently audited, the API and database are not production hardened, and physical handover or return cannot be proven on-chain.

## Requirements

- Node.js 22 LTS and npm 10 or newer. The Hardhat workspace is not verified on Node.js 26.
- MetaMask.
- A MongoDB instance reachable by the API. Local MongoDB is the default example; the API can also use a configured remote MongoDB URI.

In Windows PowerShell, use `npm.cmd` if the `npm.ps1` shim is blocked.

## Configure the API

On first setup, copy the example without overwriting an existing local configuration:

```powershell
if (-not (Test-Path apps/api/.env)) { Copy-Item apps/api/.env.example apps/api/.env }
```

Set `MONGODB_URI` to the intended database. `JWT_SECRET` must contain at least 32 characters; generate a 64-character random value in PowerShell with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, then put the result after `JWT_SECRET=` in `apps/api/.env`. Keep the real `.env` file private and do not paste the secret into chat. The application reads listing records from the `listings` collection in the database named by this URI; do not change the database name unless you have verified where the intended data lives.

## Start the local application

Use three PowerShell terminals from the repository root. Keep the chain, API, and Vite processes running. The contract artifact is already built; run `npm.cmd run contracts:build` only after changing Solidity source or if deployment says the artifact is missing.

**Terminal 1 - start Hardhat Local:**

```powershell
npm.cmd run chain:local
```

The node listens on `http://127.0.0.1:8545` with chain ID `31337`. Starting the node alone does not deploy the contract.

**Terminal 2 — deploy, then start the API:**

```powershell
npm.cmd run deploy:local
```

After deployment finishes, start the API in the same terminal and leave it running:

```powershell
npm.cmd run dev:api
```

This checks the local chain, deploys `RentalVault` with Hardhat accounts 8 and 9 as its primary and backup arbitrators, and updates `apps/web/.env.local` with the contract address and chain ID. It preserves other Vite settings in that file. Restart Vite after redeploying.

The API listens on `http://localhost:3001`. Its health endpoint is `http://localhost:3001/api/health`.

**Terminal 3 — start the frontend:**

```powershell
npm.cmd run dev:web
```

Open the Vite URL printed in the terminal, normally `http://localhost:5173`. Use the `localhost` URL so the browser sends the API's HttpOnly session cookie. MetaMask must use the **Hardhat Local** network (chain ID `31337`, RPC `http://127.0.0.1:8545`). Use only Hardhat's local development accounts on this chain, never on a public network.

Rently login and MetaMask are separate. The app checks `eth_accounts` on load and silently restores a previously approved wallet unless the user disconnected it in Rently. Protected actions require Rently login first; wallet access is requested only when needed, and each contract transaction still requires explicit MetaMask approval. The HttpOnly Rently session persists across page refreshes and is invalidated on logout or API server restart.

To demonstrate a booking, connect the listing owner's local account, publish an item, and have a different local account request it. The owner accepts the request by creating an on-chain agreement; only the designated renter can fund the exact rent plus deposit. Both parties confirm handover. After return, the renter confirms return, the owner proposes a deduction (zero is allowed), and the renter accepts that exact amount. Each participant withdraws their own credit.

## Checks

```powershell
npm.cmd run build:web
npm.cmd run lint:web
npm.cmd run contracts:build
npm.cmd run contracts:test
npm.cmd run api:test
```

## Contract flow and prototype limits

`Created → Funded → HandoverPending → Active → ReturnPending → Completed`. Unfunded agreements can be cancelled or expired after their funding deadline. A funded agreement can be cancelled before handover only with both parties' consent. Missed deadlines do not prove what happened and do not release escrow; a participant can open a dispute and an authorized arbitrator allocates only the remaining escrow. The primary arbitrator may decide during the first seven days after a dispute opens; the backup may act after that period. Payouts become pull credits that each wallet withdraws.

Listing descriptions and booking metadata are database records, not on-chain inventory. The contract does not enforce availability across different applications. Evidence references are stored on-chain as hashes, but evidence handling and arbitration remain off-chain. If neither participant opens a dispute or an arbitrator does not act, funds can remain locked. This prototype is not audited or suitable for real funds.

## Workspaces

- `apps/web` — React and Vite marketplace, authentication UI, and wallet interface.
- `apps/api` — Express API, email/password authentication, listing and booking models.
- `packages/contracts` — Hardhat configuration, `RentalVault`, tests, and local chain/deployment scripts.
