# @ng-pay/core

Core types, HTTP client, and error classes for the ng-pay unified Nigerian fintech SDK.

> This package is a peer dependency of all ng-pay adapters. You don't use it directly unless you're building a custom provider.

## Installation

```bash
npm install @ng-pay/core
```

## What's in here

### Money utilities

All monetary amounts in ng-pay are in the **smallest currency unit** (kobo for NGN, pesewas for GHS, cents for ZAR/USD/KES). Never use floats for money.

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

toCents(5000); // → 500000
toKobo(5000); // → 500000
toPesewas(5000); // → 500000
toRandCents(5000); // → 500000
toSmallestUnit(5000, "GHS"); // → 500000
fromCents(500000); // → 5000
fromKobo(500000); // → 5000
fromPesewas(500000); // → 5000
fromRandCents(500000); // → 5000
fromSmallestUnit(500000, "ZAR"); // → 5000
formatMoney({ amount: 500000, currency: "NGN" }); // → "₦5,000.00"
```

### Validation utilities

```typescript
import { isValidNUBAN, isValidBankCode, generateReference } from "@ng-pay/core";

isValidNUBAN("0123456789"); // → true  (10-digit CBN account number)
isValidBankCode("058"); // → true  (3-digit CBN bank code)
generateReference("pstk"); // → "pstk_1712345678_a3f9b2c1"
```

### Error handling

Every error thrown by an ng-pay adapter extends `NgPayError`:

```typescript
import { isNgPayError, isRateLimitError, NgPayError } from '@ng-pay/core';

try {
  await provider.initializePayment({ ... });
} catch (err) {
  if (isRateLimitError(err)) {
    console.log(`Retry after ${err.retryAfter}s`);
  } else if (isNgPayError(err)) {
    console.error({
      provider: err.provider,  // 'paystack' | 'flutterwave' | 'monnify'
      code: err.code,          // 'INVALID_PARAMS' | 'RATE_LIMITED' | ...
      message: err.message,
      raw: err.raw,            // original provider response
    });
  }
}
```

### Error codes

| Code                   | Meaning                                      |
| ---------------------- | -------------------------------------------- |
| `INVALID_API_KEY`      | Secret key is wrong or expired               |
| `INVALID_PARAMS`       | Bad request parameters                       |
| `DUPLICATE_REFERENCE`  | Payment reference already used               |
| `PAYMENT_NOT_FOUND`    | Reference doesn't exist                      |
| `INSUFFICIENT_BALANCE` | Not enough balance for transfer              |
| `ACCOUNT_NOT_FOUND`    | Account number resolution failed             |
| `RATE_LIMITED`         | Too many requests — check `error.retryAfter` |
| `TIMEOUT`              | Request timed out                            |
| `PROVIDER_ERROR`       | Provider-side 5xx error                      |
| `NETWORK_ERROR`        | Could not reach the provider                 |

### Provider interface

All adapters implement the same `NgPayProvider` interface:

```typescript
interface NgPayProvider {
  readonly name: string;
  initializePayment(params: PaymentParams): Promise<PaymentResponse>;
  verifyPayment(reference: string): Promise<VerificationResponse>;
  createVirtualAccount(params: VirtualAccountParams): Promise<VirtualAccount>;
  createTransferRecipient(
    params: TransferRecipientParams,
  ): Promise<TransferRecipient>;
  initiateTransfer(params: TransferParams): Promise<TransferResponse>;
  verifyTransfer(reference: string): Promise<TransferResponse>;
  getBanks(country?: string): Promise<Bank[]>;
  resolveAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<AccountDetails>;
  verifyWebhook(payload: unknown, signature: string): boolean;
  parseWebhookEvent(payload: unknown): WebhookEvent;
}
```

## Security

Auth credentials are stored as non-enumerable properties — they will not appear in `JSON.stringify`, `console.log`, `Object.keys`, or error reporting tools like Sentry. Network errors are scrubbed before being stored in `NgPayError.raw`.

## Links

- [GitHub](https://github.com/ProfoundLabs/ng-pay)
- [npm — @ng-pay/paystack](https://npmjs.com/package/@ng-pay/paystack)
- [npm — @ng-pay/flutterwave](https://npmjs.com/package/@ng-pay/flutterwave)
- [npm — @ng-pay/monnify](https://npmjs.com/package/@ng-pay/monnify)
