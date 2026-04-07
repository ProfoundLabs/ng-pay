# ng-pay

> A unified TypeScript SDK for Nigerian fintech providers — one interface, any provider.

[![npm version](https://img.shields.io/npm/v/@ng-pay/core.svg)](https://www.npmjs.com/package/@ng-pay/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Stop rewriting your Paystack/Flutterwave/Monnify integration every time you switch providers or add a new one. `ng-pay` gives you a single, strongly-typed interface that works across Nigerian payment providers.

## Packages

| Package | Description | Status |
|---|---|---|
| `@ng-pay/core` | Shared types, HTTP client, error classes | ✅ v0.1.0 |
| `@ng-pay/paystack` | Paystack adapter | ✅ v0.1.0 |
| `@ng-pay/flutterwave` | Flutterwave adapter | 🚧 Coming soon |
| `@ng-pay/monnify` | Monnify adapter | 🚧 Coming soon |

## Installation

```bash
# npm
npm install @ng-pay/core @ng-pay/paystack

# pnpm
pnpm add @ng-pay/core @ng-pay/paystack

# yarn
yarn add @ng-pay/core @ng-pay/paystack
```

## Quick Start

```typescript
import { PaystackProvider } from '@ng-pay/paystack';
import { toKobo, isNgPayError } from '@ng-pay/core';

const paystack = new PaystackProvider({
  secretKey: process.env.PAYSTACK_SECRET_KEY!,
});

// Initialize a payment
const payment = await paystack.initializePayment({
  amount: { amount: toKobo(5000), currency: 'NGN' }, // ₦5,000
  customer: {
    email: 'customer@example.com',
    name: 'Adaobi Nwosu',
  },
  callbackUrl: 'https://yourapp.com/payment/callback',
});

// Redirect your user to:
console.log(payment.authorizationUrl);

// Verify after callback
const verification = await paystack.verifyPayment(payment.reference);
if (verification.status === 'success') {
  console.log('Payment confirmed!', verification.amount);
}
```

## The Key Idea — Provider Interface

Every adapter implements the same `NgPayProvider` interface. This means you can swap providers with one line:

```typescript
import { PaystackProvider } from '@ng-pay/paystack';
// import { FlutterwaveProvider } from '@ng-pay/flutterwave'; // coming soon

// Change this one line to switch providers
const provider = new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! });
// const provider = new FlutterwaveProvider({ secretKey: process.env.FLW_SECRET_KEY! });

// Everything else stays the same
const payment = await provider.initializePayment({ ... });
const banks = await provider.getBanks();
const account = await provider.resolveAccount('0123456789', '058');
```

## API Reference

### Payments

```typescript
// Initialize a payment — returns redirect URL
const payment = await provider.initializePayment({
  amount: { amount: 500_000, currency: 'NGN' }, // ₦5,000 in kobo
  customer: { email: 'user@example.com', name: 'Jane Doe' },
  reference: 'my_unique_ref', // optional — auto-generated if omitted
  callbackUrl: 'https://myapp.com/callback',
  channels: ['card', 'bank_transfer'], // optional — limit payment channels
});

// Verify a payment
const result = await provider.verifyPayment('my_unique_ref');
console.log(result.status); // 'success' | 'failed' | 'pending' | ...
```

### Virtual Accounts (NUBAN)

```typescript
const account = await provider.createVirtualAccount({
  customer: { email: 'user@example.com', name: 'Jane Doe' },
});

console.log(account.accountNumber); // e.g. "0123456789"
console.log(account.bankName);      // e.g. "Wema Bank"
```

### Transfers (Payouts)

```typescript
// Step 1: create a recipient
const recipient = await provider.createTransferRecipient({
  name: 'Jane Doe',
  accountNumber: '0123456789',
  bankCode: '058', // GTBank
});

// Step 2: send money
const transfer = await provider.initiateTransfer({
  amount: { amount: 100_000, currency: 'NGN' }, // ₦1,000
  recipientCode: recipient.recipientCode,
  description: 'Salary payment',
});
```

### Banks & Account Resolution

```typescript
// Get all Nigerian banks
const banks = await provider.getBanks();

// Resolve an account number to get the account name
const account = await provider.resolveAccount('0123456789', '058');
console.log(account.accountName); // "JANE DOE"
```

### Webhooks

```typescript
import express from 'express';

const app = express();
app.use('/webhook/paystack', express.raw({ type: 'application/json' }));

app.post('/webhook/paystack', (req, res) => {
  const signature = req.headers['x-paystack-signature'] as string;
  const rawBody = req.body.toString();

  // Verify the webhook is actually from Paystack
  if (!provider.verifyWebhook(rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }

  // Parse into normalized event
  const event = provider.parseWebhookEvent(JSON.parse(rawBody));

  if (event.event === 'charge.success') {
    console.log('Payment received:', event.reference);
  }

  res.sendStatus(200);
});
```

## Error Handling

All errors extend `NgPayError` and are strongly typed:

```typescript
import { isNgPayError, isRateLimitError, NgPayError } from '@ng-pay/core';

try {
  const payment = await provider.initializePayment({ ... });
} catch (error) {
  if (isRateLimitError(error)) {
    // Retry after error.retryAfter seconds
    await sleep(error.retryAfter * 1000);
  } else if (isNgPayError(error)) {
    console.error({
      provider: error.provider, // 'paystack'
      code: error.code,         // 'INVALID_PARAMS', 'PROVIDER_ERROR', etc.
      message: error.message,
      raw: error.raw,           // Original provider response for debugging
    });
  }
}
```

### Error Codes

| Code | Meaning |
|---|---|
| `INVALID_API_KEY` | Secret key is wrong or expired |
| `INVALID_PARAMS` | Bad request parameters |
| `DUPLICATE_REFERENCE` | Payment reference already used |
| `PAYMENT_NOT_FOUND` | Reference doesn't exist |
| `INSUFFICIENT_BALANCE` | Not enough balance for transfer |
| `ACCOUNT_NOT_FOUND` | Account number resolution failed |
| `RATE_LIMITED` | Too many requests — check `error.retryAfter` |
| `TIMEOUT` | Request timed out |
| `PROVIDER_ERROR` | Provider-side 5xx error |

## Money Utilities

```typescript
import { toKobo, fromKobo, formatMoney } from '@ng-pay/core';

toKobo(5000)    // → 500000 (kobo)
fromKobo(500000) // → 5000 (naira)
formatMoney({ amount: 500000, currency: 'NGN' }) // → "₦5,000.00"
```

## Configuration

```typescript
const provider = new PaystackProvider({
  secretKey: 'sk_live_...',
  timeoutMs: 30_000,   // default: 30s
  maxRetries: 3,       // default: 3 retries with exponential backoff
});
```

## Contributing

We welcome contributions, especially new provider adapters. See [CONTRIBUTING.md](./CONTRIBUTING.md).

### Adding a new provider

1. Create `packages/<provider-name>/`
2. Implement the `NgPayProvider` interface from `@ng-pay/core`
3. Add tests with mocked HTTP responses
4. Open a PR

## Roadmap

- [ ] Flutterwave adapter
- [ ] Monnify adapter
- [ ] Express/NestJS/Fastify webhook middleware helpers
- [ ] Python bindings (`ng-pay` on PyPI)
- [ ] Multi-provider failover router
- [ ] Hosted gateway (managed API)
- [ ] Ghana (Hubtel), Kenya (M-Pesa) support

## License

MIT © ng-pay contributors
