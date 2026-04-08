# @ng-pay/flutterwave

Flutterwave adapter for the [ng-pay](https://github.com/ProfoundLabs/ng-pay) unified Nigerian fintech SDK.

## Installation
```bash
npm install @ng-pay/core @ng-pay/flutterwave
```

## Quick start
```typescript
import { FlutterwaveProvider } from '@ng-pay/flutterwave';
import { toKobo } from '@ng-pay/core';

const flutterwave = new FlutterwaveProvider({
  secretKey: process.env.FLW_SECRET_KEY!,
});
```

## Configuration
```typescript
const flutterwave = new FlutterwaveProvider({
  secretKey: 'FLWSECK_TEST-...',  // required — must start with FLWSECK or FLWSECK_TEST
  timeoutMs: 30_000,              // optional
  maxRetries: 3,                  // optional
});
```

## Provider quirks (handled for you)

| Flutterwave raw | ng-pay normalized |
|---|---|
| Amount in **naira** (major units) | Converted to **kobo** on all responses |
| Status `"successful"` | `"success"` |
| Status `"cancelled"` | `"abandoned"` |
| Event `"charge.completed"` | `"charge.success"` |
| Event `"transfer.completed"` | `"transfer.success"` |
| Webhook: plain header match | `verifyWebhook()` handles it |

## Payments
```typescript
const payment = await flutterwave.initializePayment({
  amount: { amount: toKobo(5000), currency: 'NGN' }, // ₦5,000
  customer: {
    email: 'customer@example.com',
    name: 'Chidi Okeke',
  },
  callbackUrl: 'https://yourapp.com/callback',
});

// Redirect your user
console.log(payment.authorizationUrl);

// Verify — uses tx_ref internally
const result = await flutterwave.verifyPayment(payment.reference);
console.log(result.status); // 'success' | 'failed' | 'pending' | 'abandoned'
console.log(result.amount); // { amount: 500000, currency: 'NGN' } — always in kobo
```

## Virtual accounts
```typescript
const account = await flutterwave.createVirtualAccount({
  customer: { email: 'customer@example.com', name: 'Chidi Okeke' },
  // For permanent accounts, BVN is required by Flutterwave:
  metadata: { bvn: '12345678901' },
});
```

## Transfers (payouts)
```typescript
// Flutterwave has no recipient endpoint — createTransferRecipient
// stores bank details locally and encodes them into recipientCode
const recipient = await flutterwave.createTransferRecipient({
  name: 'Chidi Okeke',
  accountNumber: '0123456789',
  bankCode: '058',
});

const transfer = await flutterwave.initiateTransfer({
  amount: { amount: toKobo(1000), currency: 'NGN' },
  recipientCode: recipient.recipientCode,
});
```

## Webhooks

Flutterwave authenticates webhooks by matching the `verif-hash` header against your secret key directly (not HMAC).
```typescript
app.post('/webhooks/flutterwave', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['verif-hash'] as string;

  if (!flutterwave.verifyWebhook(req.body.toString(), signature)) {
    return res.status(401).send('Invalid signature');
  }

  const event = flutterwave.parseWebhookEvent(JSON.parse(req.body.toString()));

  if (event.event === 'charge.success') {
    console.log('Payment received:', event.reference);
  }

  res.sendStatus(200);
});
```

## Links

- [GitHub](https://github.com/ProfoundLabs/ng-pay)
- [Flutterwave API docs](https://developer.flutterwave.com/docs)
- [npm — @ng-pay/core](https://npmjs.com/package/@ng-pay/core)
