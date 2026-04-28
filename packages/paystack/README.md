# @ng-pay/paystack

Paystack adapter for the [ng-pay](https://github.com/ProfoundLabs/ng-pay) unified Nigerian fintech SDK.

## Installation

```bash
npm install @ng-pay/core @ng-pay/paystack
```

## Quick start

```typescript
import { PaystackProvider } from "@ng-pay/paystack";
import { toKobo } from "@ng-pay/core";

const paystack = new PaystackProvider({
  secretKey: process.env.PAYSTACK_SECRET_KEY!,
});
```

## Configuration

```typescript
const paystack = new PaystackProvider({
  secretKey: "sk_live_...", // required — must start with sk_live_ or sk_test_
  preferredBank: "wema-bank", // optional — bank for virtual accounts (default: 'wema-bank')
  timeoutMs: 30_000, // optional — request timeout in ms (default: 30000)
  maxRetries: 3, // optional — retry attempts on 5xx errors (default: 3)
});
```

**Supported banks for virtual accounts:**

- `wema-bank` — Wema Bank (default, most widely available)
- `titan-paystack` — Titan Trust Bank
- `sterling-bank` — Sterling Bank

## Payments

```typescript
// Initialize — returns a URL to redirect your customer to
const payment = await paystack.initializePayment({
  amount: { amount: toKobo(5000), currency: "NGN" }, // ₦5,000
  customer: {
    email: "customer@example.com",
    firstName: "Adaobi",
    lastName: "Nwosu",
  },
  reference: "order_123", // optional — auto-generated if omitted
  callbackUrl: "https://yourapp.com/payment/callback",
  channels: ["card", "bank_transfer"], // optional
});

// Redirect your user
console.log(payment.authorizationUrl);

// Verify after callback
const result = await paystack.verifyPayment("order_123");
console.log(result.status); // 'success' | 'failed' | 'pending' | 'abandoned'
```

## Virtual accounts (NUBAN)

```typescript
const account = await paystack.createVirtualAccount({
  customer: {
    email: "customer@example.com",
    firstName: "Adaobi",
    lastName: "Nwosu",
    phone: "08012345678",
  },
  // Override bank for this specific account:
  metadata: { preferredBank: "titan-paystack" },
});

console.log(account.accountNumber); // "0123456789"
console.log(account.bankName); // "Titan Trust Bank"
```

## Transfers (payouts)

```typescript
// Step 1: create a recipient
const recipient = await paystack.createTransferRecipient({
  name: "Adaobi Nwosu",
  accountNumber: "0123456789",
  bankCode: "058", // GTBank
});

// Step 2: send money
const transfer = await paystack.initiateTransfer({
  amount: { amount: toKobo(1000), currency: "NGN" }, // ₦1,000
  recipientCode: recipient.recipientCode,
  description: "Refund - order_123",
});

// Step 3: verify
const status = await paystack.verifyTransfer(transfer.reference);
```

## Banks & account resolution

```typescript
const banks = await paystack.getBanks();
// [{ name: 'GTBank', code: '058', ... }, ...]

const account = await paystack.resolveAccount("0123456789", "058");
// { accountName: 'ADAOBI NWOSU', accountNumber: '0123456789', ... }
```

## Webhooks

```typescript
import express from "express";

const app = express();

app.post(
  "/webhooks/paystack",
  express.raw({ type: "application/json" }), // must be raw body
  (req, res) => {
    const signature = req.headers["x-paystack-signature"] as string;
    const rawBody = req.body.toString();

    if (!paystack.verifyWebhook(rawBody, signature)) {
      return res.status(401).send("Invalid signature");
    }

    const event = paystack.parseWebhookEvent(JSON.parse(rawBody));

    if (event.event === "charge.success") {
      console.log("Payment received:", event.reference);
    }

    res.sendStatus(200);
  },
);
```

Or use the middleware package for a cleaner integration — see [@ng-pay/middleware](https://npmjs.com/package/@ng-pay/middleware).

## Links

- [GitHub](https://github.com/ProfoundLabs/ng-pay)
- [Paystack API docs](https://paystack.com/docs/api)
- [npm — @ng-pay/core](https://npmjs.com/package/@ng-pay/core)
