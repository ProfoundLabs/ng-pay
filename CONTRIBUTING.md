# Contributing to ng-pay

Thanks for your interest in contributing! This guide will get you up and running quickly.

## Project Structure

ng-pay/
├── packages/
│ ├── core/ # Shared types, HTTP client, errors — edit carefully, everything depends on this
│ ├── paystack/ # Paystack adapter
│ ├── flutterwave/ # Flutterwave adapter
│ ├── monnify/ # Monnify adapter
│ └── middleware/ # Express, NestJS, Fastify webhook helpers
├── .github/workflows/ # CI/CD
└── README.md

## Local Setup

```bash
# Clone
git clone https://github.com/ProfoundLabs/ng-pay.git
cd ng-pay

# Install (requires Node >=18 and pnpm)
npm install -g pnpm
pnpm install

# Build core first — everything else depends on it
pnpm --filter @ng-pay/core build

# Run all tests
pnpm -r test

# Build all packages
pnpm -r build

# Watch mode (one package)
cd packages/core && pnpm dev
```

## Adding a New Provider Adapter

This is the most valuable contribution you can make — especially for other African markets (Ghana, Kenya, South Africa). Here's the exact pattern to follow:

### 1. Scaffold the package

```bash
mkdir -p packages/<provider>/src/{types,__tests__}
```

Copy `packages/paystack/package.json` and update `name`, `description`, and `keywords`.

### 2. Implement `NgPayProvider`

Your adapter **must** implement every method of the `NgPayProvider` interface from `@ng-pay/core`:

```typescript
import type { NgPayProvider } from '@ng-pay/core';

export class YourProvider implements NgPayProvider {
  readonly name = 'yourprovider';

  async initializePayment(params) { ... }
  async verifyPayment(reference) { ... }
  async createVirtualAccount(params) { ... }
  async createTransferRecipient(params) { ... }
  async initiateTransfer(params) { ... }
  async verifyTransfer(reference) { ... }
  async getBanks(country?) { ... }
  async resolveAccount(accountNumber, bankCode) { ... }
  verifyWebhook(payload, signature) { ... }
  parseWebhookEvent(payload) { ... }
}
```

### 3. Use `HttpClient` from core

Don't bring in axios or node-fetch. Use the `HttpClient` already in `@ng-pay/core` — it handles retries, timeouts, error normalization, and secure credential storage for you.

```typescript
import { HttpClient } from "@ng-pay/core";

this.http = new HttpClient({
  baseUrl: "https://api.yourprovider.com",
  provider: "yourprovider",
  auth: { type: "bearer", token: config.secretKey },
  // or: { type: 'basic', username: config.apiKey, password: config.secretKey }
  // or: { type: 'custom', header: 'X-API-KEY', value: config.secretKey }
});
```

### 4. Normalize everything

The whole point of ng-pay is normalization. Every provider returns different shapes — your job is to map them onto the shared types from `@ng-pay/core`.

- **Money amounts** → always smallest unit (kobo for NGN, pesewas for GHS). If the provider returns major units (naira), multiply by 100 on the way out
- **Payment status** → map to `PaymentStatus` (`'success' | 'failed' | 'pending' | 'abandoned' | 'processing' | 'reversed' | 'queued'`)
- **Webhook events** → map to `WebhookEventType`
- **Errors** → throw `NgPayError` subclasses — never let raw provider errors bubble up
- **`providerReference`** → populate from the provider's internal reference (auth code, flw_ref, transactionReference etc.)

### 5. Handle credentials securely

Auth credentials must never appear in logs, `JSON.stringify`, or error context. The `HttpClient` already handles this for its own `_auth` field. If your provider uses a token exchange flow (like Monnify's OAuth), store the token non-enumerably:

```typescript
Object.defineProperty(this, "_accessToken", {
  value: token,
  writable: true,
  enumerable: false, // hidden from JSON.stringify and Object.keys
  configurable: false,
});
```

### 6. Write tests with mocked fetch

Mock `global.fetch` with vitest. See `packages/paystack/src/__tests__/paystack.test.ts` for the full pattern. Cover at minimum:

- Constructor validation (bad/missing API key)
- `initializePayment` — happy path + provider error response
- `verifyPayment` — success, normalization of status strings, not found
- `getBanks` — correct shape mapping
- `verifyWebhook` — valid signature, invalid signature, non-string payload
- `parseWebhookEvent` — known event types, unknown event type, non-object payload

### 7. Add tsconfig and vitest config

```typescript
// packages/<provider>/vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".js"],
    alias: {
      // Point to core source during tests — avoids needing a built dist
      "@ng-pay/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

```json
// packages/<provider>/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

### 8. Add package.json and vitest config for the new package

```json
{
  "name": "@ng-pay/<provider>",
  "version": "0.1.0",
  "description": "<Provider> adapter for the ng-pay unified Nigerian fintech SDK",
  "keywords": ["nigeria", "<provider>", "payments", "fintech", "sdk"],
  "author": "ng-pay contributors",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "dev": "tsup src/index.ts --format esm,cjs --dts --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@ng-pay/core": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

### 9. Document provider quirks

Every provider has quirks. Document them clearly at the top of your provider file and in the PR description. Common ones to watch for:

| Quirk                 | Example                                                |
| --------------------- | ------------------------------------------------------ |
| Amount units          | Does the provider expect kobo or naira?                |
| Status strings        | `"successful"` vs `"success"`, `"PAID"` vs `"success"` |
| Reference field names | `tx_ref`, `paymentReference`, `transactionReference`   |
| Webhook auth          | HMAC vs plain header comparison vs OAuth               |
| Auth flow             | Static API key vs token exchange                       |
| Virtual account banks | Which banks are supported, is BVN required             |

### 10. Write a README for the package

Add a `packages/<provider>/README.md` following the same pattern as the existing provider READMEs. Include:

- Installation
- Configuration options
- Provider quirks and how ng-pay handles them
- Code examples for each operation
- Link to the provider's official API docs

### 11. Open a PR

- Title: `feat: add <Provider> adapter`
- All tests must pass (`pnpm -r test`)
- All packages must build cleanly (`pnpm -r build`)
- Include a brief description of provider quirks in the PR body

---

## Coding Standards

- **TypeScript strict mode** — no `any`, no `@ts-ignore`
- Raw provider responses always stored in `.raw` — never discard them
- All money in smallest unit internally (kobo for NGN, pesewas for GHS, cents for ZAR/USD/KES) — convert at the boundary
- Use `toKobo()` / `toPesewas()` / `toRandCents()` / `toCents()` / `toSmallestUnit()` helpers from core when constructing amounts
- Use `generateReference()` from core when `reference` is optional
- Use `parseDate()` from core for all date fields — provider date strings are unreliable
- Timing-safe comparison for all webhook signature checks — never use `===` for HMAC comparison
- `HttpClient` only — no axios, node-fetch, or got
- No hardcoded strings in provider adapters — use constants or config

## Commit Style

feat: add Hubtel (Ghana) adapter
fix: handle null customer name in Paystack verify
test: add transfer recipient tests for Flutterwave
docs: update README with Monnify inline checkout example
chore: bump all packages to 0.2.0
release: v0.2.0 — add Ghana (Hubtel) adapter

## Releases

Maintainers publish by pushing a commit starting with `release:` to main. CI runs tests across Node 18/20/22 and publishes all packages to npm automatically if they pass.

```bash
# 1. Bump version in all packages/*/package.json
# 2. Commit and push
git commit -m "release: v0.2.0 — add Ghana (Hubtel) adapter"
git push origin main
```

The publish job only runs on commits starting with `release:` — all other pushes run tests and build only.

## Getting Help

- Open an issue on [GitHub](https://github.com/ProfoundLabs/ng-pay/issues) for bugs or feature requests
- For questions about implementing a new provider, open a discussion first — we can help map out the approach before you start coding
