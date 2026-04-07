# Contributing to ng-pay

Thanks for your interest in contributing! This guide will get you up and running quickly.

## Project Structure

```
ng-pay/
├── packages/
│   ├── core/          # Shared types, HTTP client, errors — edit carefully, everything depends on this
│   ├── paystack/      # Paystack adapter
│   ├── flutterwave/   # (coming soon)
│   └── monnify/       # (coming soon)
├── .github/workflows/ # CI/CD
└── README.md
```

## Local Setup

```bash
# Clone
git clone https://github.com/your-org/ng-pay.git
cd ng-pay

# Install (requires Node >=18 and pnpm)
npm install -g pnpm
pnpm install

# Run all tests
pnpm -r test

# Build all packages
pnpm -r build

# Watch mode (one package)
cd packages/core && pnpm dev
```

## Adding a New Provider Adapter

This is the most valuable contribution you can make. Here's the exact pattern:

### 1. Scaffold the package

```bash
mkdir -p packages/<provider>/src/{types,__tests__}
```

Copy `packages/paystack/package.json` and update `name`, `description`.

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

Don't bring in axios or node-fetch. Use the `HttpClient` already in `@ng-pay/core` — it handles retries, timeouts, and error normalization for you.

```typescript
import { HttpClient } from '@ng-pay/core';

this.http = new HttpClient({
  baseUrl: 'https://api.yourprovider.com',
  provider: 'yourprovider',
  apiKey: config.secretKey,
});
```

### 4. Normalize everything

The whole point of ng-pay is normalization. Every provider returns different shapes — your job is to map them onto the shared types from `@ng-pay/core`.

- Money amounts → always smallest unit (kobo for NGN)
- Payment status → `PaymentStatus` type
- Errors → throw `NgPayError` subclasses, never raw provider errors

### 5. Write tests with mocked fetch

Mock `global.fetch` with vitest. See `packages/paystack/src/__tests__/paystack.test.ts` for the pattern. Cover at minimum:
- Constructor validation (bad/missing API key)
- `initializePayment` — happy path + error cases
- `verifyPayment` — success + not found
- `getBanks` — filtering inactive banks
- `verifyWebhook` — valid + invalid signature
- `parseWebhookEvent` — known + unknown event types

### 6. Add path alias to vitest config

```typescript
// packages/<provider>/vitest.config.ts
alias: {
  '@ng-pay/core': path.resolve(__dirname, '../core/src/index.ts'),
}
```

### 7. Open a PR

- Title: `feat: add <Provider> adapter`
- All tests must pass
- Include a note about any provider quirks (e.g. "Flutterwave uses `tx_ref` not `reference`")

## Coding Standards

- **TypeScript strict mode** — no `any`, no `@ts-ignore`
- Raw provider responses always stored in `.raw` — never discard them
- All money in smallest unit (kobo) internally
- Use `generateReference()` from core when reference is optional
- Use `parseDate()` from core for date fields — provider date strings are unreliable
- Timing-safe comparison for all webhook signature checks

## Commit Style

```
feat: add Flutterwave adapter
fix: handle null customer name in Paystack verify
test: add transfer recipient tests for Paystack
docs: update README with Monnify example
```

## Releases

Maintainers publish by pushing a commit starting with `release:` to main:

```bash
git commit -m "release: v0.2.0 — add Flutterwave adapter"
git push origin main
```

CI will build, test, and publish all packages to npm automatically.
