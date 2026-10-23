# Rental marketplace API

This Express service stores listing descriptions and booking references in MongoDB. Rental status, escrow, credits, and transaction results remain authoritative on the RentalVault contract.

## Local setup

Install MongoDB Community Server and make sure its local service is running. Then, from the repository root, copy the safe example configuration:

```powershell
if (-not (Test-Path apps/api/.env)) { Copy-Item apps/api/.env.example apps/api/.env }
```

Set `JWT_SECRET` to a random value of at least 32 characters. The root README shows a PowerShell command to generate a 64-character value. Keep the real `.env` private.

Start the API in its own PowerShell window:

```powershell
npm.cmd run dev:api
```

The default API address is `http://localhost:3001`; `GET /api/health` reports API and database status. Open the web app at `http://localhost:5173` so its browser session cookie is sent to the API. Start the web app separately with `npm.cmd run dev:web`.

Rently accounts use password hashes, a seven-day HttpOnly session cookie, and a per-user token version so logout invalidates the session. The cookie persists across browser refreshes but is scoped to the running API instance, so restarting the API requires users to log in again. Protected API routes verify the Rently account and ownership. Wallet authorization is separate: the user signs a one-time challenge when an operation needs wallet proof. A wallet token never authenticates a Rently account. Booking history is available to the authenticated account without requiring a wallet signature. Public listing responses omit owner email and private meeting instructions. Booking status and ETH remain authoritative on `RentalVault`; MongoDB booking metadata is not proof of an on-chain agreement.

## Tests

```powershell
npm.cmd run test --workspace=api
```

The tests cover wallet address validation, canonical request serialization, and listing signature verification. Database-backed HTTP tests require a running MongoDB service.
