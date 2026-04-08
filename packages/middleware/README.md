# @ng-pay/middleware

Express, NestJS, and Fastify webhook middleware for the [ng-pay](https://github.com/ProfoundLabs/ng-pay) unified Nigerian fintech SDK.

Handles signature verification, raw body parsing, error responses, and event parsing — so you never wire webhooks manually again.

## Installation
```bash
npm install @ng-pay/core @ng-pay/middleware
```

Install your provider adapter too:
```bash
npm install @ng-pay/paystack   # or flutterwave, monnify
```

## Express
```typescript
import express from 'express';
import { ngPayWebhook } from '@ng-pay/middleware/express';
import { PaystackProvider } from '@ng-pay/paystack';

const app = express();
const paystack = new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! });

app.post(
  '/webhooks/paystack',
  express.raw({ type: 'application/json' }), // must come before the middleware
  ngPayWebhook({
    provider: paystack,
    onEvent: async (event) => {
      if (event.event === 'charge.success') {
        await fulfillOrder(event.reference!);
      }
    },
  })
);
```

The middleware automatically:
- Reads the correct signature header per provider (`x-paystack-signature`, `verif-hash`, `monnify-signature`)
- Returns `400` if the header is missing
- Returns `401` if the signature is invalid
- Sends `200` before calling `onEvent` (prevents provider retries)

## NestJS
```typescript
// app.module.ts
import { NgPayWebhookModule } from '@ng-pay/middleware/nestjs';
import { PaystackProvider } from '@ng-pay/paystack';

@Module({
  imports: [
    NgPayWebhookModule.register({
      provider: new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! }),
    }),
  ],
})
export class AppModule {}
```
```typescript
// webhook.controller.ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { createNgPayGuard, NgPayWebhookEvent } from '@ng-pay/middleware/nestjs';
import { PaystackProvider } from '@ng-pay/paystack';
import type { WebhookEvent } from '@ng-pay/core';

const paystack = new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! });
const PaystackGuard = createNgPayGuard({ provider: paystack });

@Controller('webhooks')
export class WebhookController {
  @Post('paystack')
  @UseGuards(PaystackGuard)
  async handlePaystack(@NgPayWebhookEvent() event: WebhookEvent) {
    if (event.event === 'charge.success') {
      await this.ordersService.fulfill(event.reference!);
    }
    return { received: true };
  }
}
```

> Enable raw body parsing in `main.ts`:
> ```typescript
> const app = await NestFactory.create(AppModule, { rawBody: true });
> ```

## Fastify

**Plugin** — registers a dedicated POST route:
```typescript
import Fastify from 'fastify';
import { ngPayWebhookPlugin } from '@ng-pay/middleware/fastify';
import { PaystackProvider } from '@ng-pay/paystack';

const app = Fastify();
const paystack = new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! });

await app.register(ngPayWebhookPlugin, {
  provider: paystack,
  routePrefix: '/webhooks/paystack',
  onEvent: async (event) => {
    if (event.event === 'charge.success') {
      await fulfillOrder(event.reference!);
    }
  },
});
```

**Hook** — use as a `preHandler` on existing routes:
```typescript
import { ngPayWebhookHook } from '@ng-pay/middleware/fastify';
import type { WebhookEvent } from '@ng-pay/core';

app.post('/webhooks/paystack', {
  preHandler: ngPayWebhookHook({ provider: paystack }),
}, async (request, reply) => {
  const event = request.ngPayEvent as WebhookEvent;
  reply.send({ received: true });
});
```

## Custom signature header

If your provider uses a non-standard header:
```typescript
ngPayWebhook({
  provider: paystack,
  signatureHeader: 'x-custom-sig', // overrides the default
  onEvent: async (event) => { ... },
})
```

## Default signature headers

| Provider | Header |
|---|---|
| Paystack | `x-paystack-signature` |
| Flutterwave | `verif-hash` |
| Monnify | `monnify-signature` |

## Links

- [GitHub](https://github.com/ProfoundLabs/ng-pay)
- [npm — @ng-pay/paystack](https://npmjs.com/package/@ng-pay/paystack)
- [npm — @ng-pay/flutterwave](https://npmjs.com/package/@ng-pay/flutterwave)
- [npm — @ng-pay/monnify](https://npmjs.com/package/@ng-pay/monnify)
