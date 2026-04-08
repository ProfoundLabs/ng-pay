# @ng-pay/monnify

Monnify adapter for the [ng-pay](https://github.com/ProfoundLabs/ng-pay) unified Nigerian fintech SDK.

## Installation
```bash
npm install @ng-pay/core @ng-pay/monnify
```

## Quick start
```typescript
import { MonnifyProvider } from '@ng-pay/monnify';
import { toKobo } from '@ng-pay/core';

const monnify = new MonnifyProvider({
  apiKey: process.env.MONNIFY_API_KEY!,
  secretKey: process.env.MONNIFY_SECRET_KEY!,
  contractCode: process.env.MONNIFY_CONTRACT_CODE!,
  sandbox: true, // or false for production
});
```

## Configuration
```typescript
const monnify = new MonnifyProvider({
  apiKey: 'MK_TEST_...',     // required
  secretKey: '...',          // required
  contractCode: '...',       // required — your Monnify merchant contract code
  sandbox: true,             // recommended to set explicitly
  timeoutMs: 30_000,         // optional
  maxRetries: 3,             // optional
});
```

**Environment inference from API key prefix:**

If `sandbox` is not set, ng-pay infers the environment from your key:
- `MK_TEST_` prefix → sandbox
- `MK_LIVE_` prefix → production
- Any other prefix → throws, forcing you to set `sandbox` explicitly

Always set `sandbox` explicitly in production to avoid misconfiguration.

## Provider quirks (handled for you)

| Monnify raw | ng-pay normalized |
|---|---|
| Amount in **naira** (major units) | Converted to **kobo** on all responses |
| OAuth token exchange on every session | Automatic — token cached and refreshed |
| Status `"PAID"` / `"OVERPAID"` | `"success"` |
| Status `"PARTIALLY_PAID"` | `"processing"` |
| Status `"EXPIRED"` / `"CANCELLED"` | `"abandoned"` |
| Event `"SUCCESSFUL_TRANSACTION"` | `"charge.success"` |
| Event `"SUCCESSFUL_DISBURSEMENT"` | `"transfer.success"` |
| Reserved accounts | Normalized to `VirtualAccount` |

## Payments
```typescript
const payment = await monnify.initializePayment({
  amount: { amount: toKobo(5000), currency: 'NGN' }, // ₦5,000
  customer: {
    email: 'customer@example.com',
    name: 'Emeka Eze',
  },
  callbackUrl: 'https://yourapp.com/callback',
});

console.log(payment.authorizationUrl); // Monnify checkout URL

const result = await monnify.verifyPayment(payment.reference);
console.log(result.status); // 'success' | 'failed' | 'pending' | 'processing'
```

## Reserved accounts (virtual accounts)

Monnify calls these "reserved accounts". ng-pay exposes them via the standard `createVirtualAccount` interface.
```typescript
const account = await monnify.createVirtualAccount({
  customer: { email: 'customer@example.com', name: 'Emeka Eze' },
  // BVN required for most account types:
  metadata: { bvn: '12345678901' },
});

console.log(account.accountNumber); // "0123456789"
console.log(account.bankName);      // "Wema Bank"
console.log(account.bankCode);      // "035"
```

## Transfers (disbursements)
```typescript
const recipient = await monnify.createTransferRecipient({
  name: 'Emeka Eze',
  accountNumber: '0123456789',
  bankCode: '058',
});

const transfer = await monnify.initiateTransfer({
  amount: { amount: toKobo(1000), currency: 'NGN' },
  recipientCode: recipient.recipientCode,
  description: 'Payout',
});
```

## Webhooks

Monnify signs webhooks with HMAC-SHA512. The signature is in the `monnify-signature` header.
```typescript
app.post('/webhooks/monnify', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['monnify-signature'] as string;
  const rawBody = req.body.toString();

  if (!monnify.verifyWebhook(rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }

  const event = monnify.parseWebhookEvent(JSON.parse(rawBody));

  if (event.event === 'charge.success') {
    console.log('Payment received:', event.reference);
  }

  res.sendStatus(200);
});
```

## Links

- [GitHub](https://github.com/ProfoundLabs/ng-pay)
- [Monnify API docs](https://developers.monnify.com)
- [npm — @ng-pay/core](https://npmjs.com/package/@ng-pay/core)
