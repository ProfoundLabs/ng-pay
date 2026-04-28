# ng-pay

> A unified TypeScript SDK for Nigerian fintech providers — one interface, any provider.

[![npm version](https://img.shields.io/npm/v/@ng-pay/core.svg)](https://www.npmjs.com/package/@ng-pay/core)
[![CI](https://github.com/ProfoundLabs/ng-pay/actions/workflows/ci.yml/badge.svg)](https://github.com/ProfoundLabs/ng-pay/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Stop rewriting your Paystack/Flutterwave/Monnify integration every time you switch providers or add a new one. `ng-pay` gives you a single, strongly-typed interface that works across Nigerian payment providers.

## Packages

| Package                                                                | Description                               | Version                                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`@ng-pay/core`](https://npmjs.com/package/@ng-pay/core)               | Shared types, HTTP client, error classes  | [![npm](https://img.shields.io/npm/v/@ng-pay/core.svg)](https://www.npmjs.com/package/@ng-pay/core)               |
| [`@ng-pay/paystack`](https://npmjs.com/package/@ng-pay/paystack)       | Paystack adapter                          | [![npm](https://img.shields.io/npm/v/@ng-pay/paystack.svg)](https://www.npmjs.com/package/@ng-pay/paystack)       |
| [`@ng-pay/flutterwave`](https://npmjs.com/package/@ng-pay/flutterwave) | Flutterwave adapter                       | [![npm](https://img.shields.io/npm/v/@ng-pay/flutterwave.svg)](https://www.npmjs.com/package/@ng-pay/flutterwave) |
| [`@ng-pay/monnify`](https://npmjs.com/package/@ng-pay/monnify)         | Monnify adapter                           | [![npm](https://img.shields.io/npm/v/@ng-pay/monnify.svg)](https://www.npmjs.com/package/@ng-pay/monnify)         |
| [`@ng-pay/router`](https://npmjs.com/package/@ng-pay/router)           | Intelligent provider routing and failover | [![npm](https://img.shields.io/npm/v/@ng-pay/router.svg)](https://www.npmjs.com/package/@ng-pay/router)           |
| [`@ng-pay/middleware`](https://npmjs.com/package/@ng-pay/middleware)   | Express, NestJS & Fastify webhook helpers | [![npm](https://img.shields.io/npm/v/@ng-pay/middleware.svg)](https://www.npmjs.com/package/@ng-pay/middleware)   |

## Installation

```bash
# npm
npm install @ng-pay/core @ng-pay/paystack

# pnpm
pnpm add @ng-pay/core @ng-pay/paystack

# yarn
yarn add @ng-pay/core @ng-pay/paystack
```

Install the provider you need alongside core:

```bash
npm install @ng-pay/core @ng-pay/paystack      # Paystack
npm install @ng-pay/core @ng-pay/flutterwave   # Flutterwave
npm install @ng-pay/core @ng-pay/monnify       # Monnify
npm install @ng-pay/core @ng-pay/router @ng-pay/paystack @ng-pay/flutterwave  # multi-provider failover
```

## Quick Start

```typescript
import { PaystackProvider } from "@ng-pay/paystack";
import { toKobo, isNgPayError } from "@ng-pay/core";

const paystack = new PaystackProvider({
  secretKey: process.env.PAYSTACK_SECRET_KEY!,
});

// Initialize a payment
const payment = await paystack.initializePayment({
  amount: { amount: toKobo(5000), currency: "NGN" }, // ₦5,000
  customer: {
    email: "customer@example.com",
    name: "Adaobi Nwosu",
  },
  callbackUrl: "https://yourapp.com/payment/callback",
});

// Redirect flow
window.location.href = payment.authorizationUrl;

// Inline/embedded checkout (Paystack)
PaystackPop.setup({
  key: "pk_live_...",
  accessCode: payment.accessCode,
});

// Verify after callback
const result = await paystack.verifyPayment(payment.reference);
if (result.status === "success") {
  console.log("Payment confirmed!", result.amount);
}
```

## The Key Idea — One Interface, Any Provider

Every adapter implements the same `NgPayProvider` interface. Swap providers by changing one line:

```typescript
import { PaystackProvider } from '@ng-pay/paystack';
import { FlutterwaveProvider } from '@ng-pay/flutterwave';
import { MonnifyProvider } from '@ng-pay/monnify';

// Change this one line — everything else stays the same
const provider = new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! });
// const provider = new FlutterwaveProvider({ secretKey: process.env.FLW_SECRET_KEY! });
// const provider = new MonnifyProvider({ apiKey: '...', secretKey: '...', contractCode: '...' });

const payment = await provider.initializePayment({ ... });
const banks   = await provider.getBanks();
const account = await provider.resolveAccount('0123456789', '058');
```

## Intelligent Routing And Failover

Use `@ng-pay/router` when you want to wrap multiple providers behind the same `NgPayProvider` interface with automatic failover, circuit breaking, and routing strategies.

```typescript
import { ProviderRouter } from "@ng-pay/router";
import { PaystackProvider } from "@ng-pay/paystack";
import { FlutterwaveProvider } from "@ng-pay/flutterwave";

const provider = new ProviderRouter(
  [
    new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! }),
    new FlutterwaveProvider({ secretKey: process.env.FLW_SECRET_KEY! }),
  ],
  {
    strategy: "priority",
    failureThreshold: 0.5,
    circuitResetMs: 60_000,
  },
);

const payment = await provider.initializePayment({
  amount: { amount: 500_000, currency: "NGN" },
  customer: { email: "user@example.com", name: "Jane Doe" },
  callbackUrl: "https://myapp.com/callback",
});
```

The router exports the same `NgPayProvider` surface area as the individual adapters, so you can add failover without changing your application-facing payment code.

## API Reference

### Money

All amounts are in the **smallest currency unit** (kobo for NGN, pesewas for GHS, cents for ZAR/USD/KES). Always pass `currency` explicitly:

```typescript
import {
  toCents,
  toKobo,
  toPesewas,
  toRandCents,
  toSmallestUnit,
  fromCents,
  fromKobo,
  fromPesewas,
  fromRandCents,
  fromSmallestUnit,
  formatMoney,
} from "@ng-pay/core";

toCents(5000); // 500000
toKobo(5000); // 500000
toPesewas(5000); // 500000
toRandCents(5000); // 500000
toSmallestUnit(5000, "GHS"); // 500000
fromCents(500000); // 5000
fromKobo(500000); // 5000
fromPesewas(500000); // 5000
fromRandCents(500000); // 5000
fromSmallestUnit(500000, "ZAR"); // 5000
formatMoney({ amount: 500000, currency: "NGN" }); // "₦5,000.00"
```

### Payments

```typescript
// Initialize — returns a checkout URL and provider-specific tokens
const payment = await provider.initializePayment({
  amount: { amount: 500_000, currency: "NGN" }, // ₦5,000
  customer: { email: "user@example.com", name: "Jane Doe" },
  reference: "order_123", // optional — auto-generated if omitted
  callbackUrl: "https://myapp.com/cb",
  channels: ["card", "bank_transfer"], // optional — limit payment channels
  splitCode: "SPL_ab3defgh", // optional — Paystack revenue split
});

// For redirect checkout (all providers)
redirect(payment.authorizationUrl);

// For inline checkout
payment.accessCode; // Paystack inline SDK
payment.transactionReference; // Monnify inline SDK

// Verify
const result = await provider.verifyPayment("order_123");
console.log(result.status); // 'success' | 'failed' | 'pending' | 'abandoned'
console.log(result.amount); // { amount: 500000, currency: 'NGN' } — always in kobo
console.log(result.providerReference); // Paystack auth code / Flutterwave flw_ref / Monnify txRef
console.log(result.authorizationCode); // Paystack card auth code — use for recurring charges
```

### Virtual Accounts (NUBAN)

```typescript
const account = await provider.createVirtualAccount({
  customer: { email: "user@example.com", name: "Jane Doe" },

  // Paystack — override the bank per account
  metadata: { preferredBank: "titan-paystack" }, // 'wema-bank' | 'titan-paystack' | 'sterling-bank'

  // Paystack — split incoming payments
  splitCode: "SPL_ab3defgh",

  // Monnify — marketplace split config
  incomeSplitConfig: [{ subAccountCode: "MFY_SUB_...", splitPercentage: 80 }],
});

console.log(account.accountNumber); // "0123456789"
console.log(account.bankName); // "Wema Bank"
```

### Transfers (Payouts)

```typescript
// Step 1: create a recipient
const recipient = await provider.createTransferRecipient({
  name: "Jane Doe",
  accountNumber: "0123456789",
  bankCode: "058", // GTBank
});

// Step 2: send money
const transfer = await provider.initiateTransfer({
  amount: { amount: 100_000, currency: "NGN" }, // ₦1,000
  recipientCode: recipient.recipientCode,
  description: "Salary — April 2026",
});

// Step 3: verify
const status = await provider.verifyTransfer(transfer.reference);
console.log(status.status); // 'success' | 'pending' | 'failed'
```

### Banks & Account Resolution

```typescript
// Get all Nigerian banks
const banks = await provider.getBanks();
// [{ name: 'GTBank', code: '058', ussd: '*737#', ... }, ...]

// Resolve an account number
const account = await provider.resolveAccount("0123456789", "058");
console.log(account.accountName); // "JANE DOE"

// Enrich with bank name (resolveAccount doesn't return bankName by default)
import { enrichAccountWithBankName } from "@ng-pay/core";
const enriched = enrichAccountWithBankName(account, banks);
console.log(enriched.bankName); // "Guaranty Trust Bank"
```

### Webhooks

```typescript
import express from "express";

const app = express();

app.post(
  "/webhooks/paystack",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.headers["x-paystack-signature"] as string;
    const rawBody = req.body.toString();

    if (!provider.verifyWebhook(rawBody, signature)) {
      return res.status(401).send("Invalid signature");
    }

    const event = provider.parseWebhookEvent(JSON.parse(rawBody));

    switch (event.event) {
      case "charge.success":
        await fulfill(event.reference!);
        break;
      case "transfer.success":
        await confirmPayout(event.reference!);
        break;
      case "refund.processed":
        await handleRefund(event.reference!);
        break;
    }

    res.sendStatus(200);
  },
);
```

Or use `@ng-pay/middleware` to skip the boilerplate entirely — see the [middleware README](./packages/middleware/README.md).

### Webhook events

| Event                    | Meaning                |
| ------------------------ | ---------------------- |
| `charge.success`         | Payment completed      |
| `charge.failed`          | Payment failed         |
| `transfer.success`       | Payout sent            |
| `transfer.failed`        | Payout failed          |
| `transfer.reversed`      | Payout reversed        |
| `refund.processed`       | Refund completed       |
| `refund.failed`          | Refund failed          |
| `charge.dispute.create`  | Dispute opened         |
| `charge.dispute.resolve` | Dispute resolved       |
| `subscription.create`    | Subscription started   |
| `subscription.disable`   | Subscription cancelled |
| `invoice.create`         | Invoice created        |
| `invoice.update`         | Invoice updated        |
| `invoice.payment_failed` | Invoice payment failed |

## Error Handling

All errors extend `NgPayError` and are strongly typed:

```typescript
import { isNgPayError, isRateLimitError } from '@ng-pay/core';

try {
  await provider.initializePayment({ ... });
} catch (err) {
  if (isRateLimitError(err)) {
    await sleep(err.retryAfter! * 1000);
    // retry...
  } else if (isNgPayError(err)) {
    console.error({
      provider: err.provider,  // 'paystack' | 'flutterwave' | 'monnify'
      code: err.code,          // see table below
      message: err.message,
      raw: err.raw,            // original provider response
    });
  }
}
```

| Code                   | Meaning                                    |
| ---------------------- | ------------------------------------------ |
| `INVALID_API_KEY`      | Secret key is wrong or expired             |
| `INVALID_PARAMS`       | Bad request parameters                     |
| `DUPLICATE_REFERENCE`  | Payment reference already used             |
| `PAYMENT_NOT_FOUND`    | Reference doesn't exist                    |
| `INSUFFICIENT_BALANCE` | Not enough balance for transfer            |
| `ACCOUNT_NOT_FOUND`    | Account number resolution failed           |
| `RATE_LIMITED`         | Too many requests — check `err.retryAfter` |
| `TIMEOUT`              | Request timed out after `timeoutMs`        |
| `PROVIDER_ERROR`       | Provider-side 5xx error                    |
| `NETWORK_ERROR`        | Could not reach the provider               |

## Configuration

```typescript
// Paystack
const paystack = new PaystackProvider({
  secretKey: "sk_live_...",
  preferredBank: "wema-bank", // default bank for virtual accounts
  timeoutMs: 30_000,
  maxRetries: 3,
});

// Flutterwave
const flutterwave = new FlutterwaveProvider({
  secretKey: "FLWSECK-...",
  timeoutMs: 30_000,
  maxRetries: 3,
});

// Monnify
const monnify = new MonnifyProvider({
  apiKey: "MK_LIVE_...",
  secretKey: "...",
  contractCode: "...",
  sandbox: false, // or true for sandbox
  // If omitted, inferred from key prefix: MK_TEST_ → sandbox, MK_LIVE_ → production
});
```

## Security

- **Auth credentials are non-enumerable** — they will not appear in `JSON.stringify`, `console.log`, `Object.keys`, or error reporting tools like Sentry
- **Network errors are scrubbed** — auth headers are stripped from `NgPayError.raw` before the error is thrown
- **Timing-safe webhook verification** — all providers use constant-time comparison to prevent timing oracle attacks
- **Monnify token management** — the OAuth access token is stored non-enumerably and refreshed automatically

## Contributing

Contributions are welcome, especially new provider adapters. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Roadmap

- [ ] Ghana (Hubtel), Kenya (M-Pesa) support
- [ ] Multi-provider failover router
- [ ] Python bindings (`ng-pay` on PyPI)
- [ ] Hosted gateway (managed API)

## License

MIT © ng-pay contributors
