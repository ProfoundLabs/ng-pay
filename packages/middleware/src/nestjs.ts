/**
 * @ng-pay/middleware/nestjs
 *
 * Usage — Guard on a controller:
 *
 *   import { Controller, Post, UseGuards } from '@nestjs/common';
 *   import { createNgPayGuard, NgPayWebhookEvent } from '@ng-pay/middleware/nestjs';
 *   import { PaystackProvider } from '@ng-pay/paystack';
 *   import type { WebhookEvent } from '@ng-pay/core';
 *
 *   const paystack = new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! });
 *   const PaystackWebhookGuard = createNgPayGuard({ provider: paystack });
 *
 *   @Controller('webhooks')
 *   export class WebhookController {
 *     @Post('paystack')
 *     @UseGuards(PaystackWebhookGuard)
 *     async handlePaystack(@NgPayWebhookEvent() event: WebhookEvent) {
 *       if (event.event === 'charge.success') {
 *         await this.ordersService.fulfill(event.reference!);
 *       }
 *       return { received: true };
 *     }
 *   }
 *
 * Usage — Module setup for app-wide DI:
 *
 *   import { NgPayWebhookModule } from '@ng-pay/middleware/nestjs';
 *
 *   @Module({
 *     imports: [
 *       NgPayWebhookModule.register({
 *         provider: new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! }),
 *       }),
 *     ],
 *   })
 *   export class AppModule {}
 *
 * Important: enable raw body parsing in main.ts so the guard can read it:
 *
 *   const app = await NestFactory.create(AppModule, { rawBody: true });
 */

import type {
  CanActivate,
  ExecutionContext,
  DynamicModule,
} from '@nestjs/common';
import {
  Injectable,
  createParamDecorator,
  Module,
} from '@nestjs/common';
import type { WebhookEvent } from '@ng-pay/core';
import { WebhookSignatureError } from '@ng-pay/core';
import { resolveSignatureHeader, processWebhook, type NgPayWebhookOptions } from './shared.js';

export type { NgPayWebhookOptions };

// ─────────────────────────────────────────────────────────────────────────────
// Parsed event key — used to pass event between guard and controller
// ─────────────────────────────────────────────────────────────────────────────

export const NG_PAY_WEBHOOK_EVENT_KEY = '__ngpay_webhook_event__';

// ─────────────────────────────────────────────────────────────────────────────
// createNgPayGuard — factory that returns a guard class closed over options.
//
// This avoids @Inject() parameter decorators entirely, which require
// emitDecoratorMetadata + @swc/core and cause TS5.x DTS build errors
// when @nestjs/common is a peer dep not installed at build time.
// ─────────────────────────────────────────────────────────────────────────────

export function createNgPayGuard(options: NgPayWebhookOptions) {
  const { provider, onInvalidSignature } = options;
  const sigHeader = resolveSignatureHeader(provider, options.signatureHeader);

  @Injectable()
  class NgPayWebhookGuardImpl implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context.switchToHttp().getRequest();
      const res = context.switchToHttp().getResponse();

      const signature = req.headers[sigHeader] as string;

      if (!signature) {
        res.status(400).json({ error: `Missing ${sigHeader} header` });
        return false;
      }

      // NestJS rawBody: enable with { rawBody: true } in NestFactory.create()
      const rawBody: string =
        Buffer.isBuffer(req.rawBody)
          ? req.rawBody.toString('utf-8')
          : typeof req.rawBody === 'string'
            ? req.rawBody
            : JSON.stringify(req.body);

      try {
        const event = processWebhook(provider, rawBody, signature);
        req[NG_PAY_WEBHOOK_EVENT_KEY] = event;
        return true;
      } catch (err) {
        if (err instanceof WebhookSignatureError) {
          if (onInvalidSignature) {
            onInvalidSignature(req, res);
            return false;
          }
          res.status(401).json({ error: 'Invalid webhook signature' });
          return false;
        }
        throw err;
      }
    }
  }

  return NgPayWebhookGuardImpl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Param decorator — pull the parsed event into a controller method argument
// ─────────────────────────────────────────────────────────────────────────────

export const NgPayWebhookEvent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WebhookEvent => {
    const request = ctx.switchToHttp().getRequest();
    return request[NG_PAY_WEBHOOK_EVENT_KEY] as WebhookEvent;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// NgPayWebhookModule — optional, registers a shared guard via DI
// ─────────────────────────────────────────────────────────────────────────────

export const NG_PAY_WEBHOOK_GUARD = 'NG_PAY_WEBHOOK_GUARD';

@Module({})
export class NgPayWebhookModule {
  static register(options: NgPayWebhookOptions): DynamicModule {
    const GuardClass = createNgPayGuard(options);

    return {
      module: NgPayWebhookModule,
      providers: [
        { provide: NG_PAY_WEBHOOK_GUARD, useClass: GuardClass },
      ],
      exports: [NG_PAY_WEBHOOK_GUARD],
    };
  }
}
