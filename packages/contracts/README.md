# RentalVault contracts

This package uses the project's existing Hardhat 3.20, Solidity 0.8.34, and ethers/Mocha toolbox. `RentalVault.sol` accepts native ETH for local agreements. The browser uses ethers 6 with MetaMask; no additional Solidity library dependency was added.

## Build and test

From the repository root in Windows PowerShell:

```powershell
npm.cmd run contracts:build
npm.cmd run contracts:test
```

The test suite includes Solidity starter tests plus TypeScript integration coverage for RentalVault success and failure cases, deadlines, cancellation, exact deductions, disputes, arbitrator authority and failover, withdrawal failures, reentrancy, and liability accounting.

## Local deployment

Run these commands in separate terminals from the repository root:

```powershell
npm.cmd run chain:local
npm.cmd run deploy:local --workspace=contracts
npm.cmd run dev:web
```

The deployment script connects to `http://127.0.0.1:8545`, uses local Hardhat accounts 8 and 9 as primary and backup arbitrators, and writes the deployed address to the ignored `apps/web/.env.local`. Restart Vite after deployment so it loads the new address. Restarting the Hardhat node resets all deployments and state.

## Accounting and limitations

After handover, rent becomes owner withdrawal credit and the deposit remains agreement escrow. Every settlement converts the remaining agreement escrow into owner and renter credits. `totalEscrow + totalCredits` tracks contract liabilities; withdrawals reduce a caller's credit before the ETH call and revert fully if the call fails. There is no admin or emergency pause. Deadlines never prove a physical event or trigger an automatic payout; a missed party can leave money locked if nobody initiates resolution.

The arbitrator addresses are fixed when the contract is deployed. The primary may decide for seven days after a dispute opens; after that only the configured backup may decide. Both can allocate only the agreement's current escrow between its owner and renter. Neither may redirect ETH to another address. This failover handles primary key loss but cannot resolve simultaneous loss or unavailability of both keys.

This is a demonstration prototype, not an independent audit or production security review.
