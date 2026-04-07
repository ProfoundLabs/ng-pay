/**
 * @ng-pay/middleware/express
 *
 * Usage:
 *   import express from 'express';
 *   import { ngPayWebhook } from '@ng-pay/middleware/express';
 *   import { PaystackProvider } from '@ng-pay/paystack';
 *
 *   const app = express();
 *   const paystack = new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! });
 *
 *   // IMPORTANT: mount express.raw() BEFORE the webhook route so we get the raw body
 *   app.post(
 *     '/webhooks/paystack',
 *     express.raw({ type: 'application/json' }),
 *     ngPayWebhook({
 *       provider: paystack,
 *       onEvent: async (event) => {
 *         if (event.event === 'charge.success') {
 *           await fulfillOrder(event.reference!);
 *         }
 *       },
 *     })
 *   );
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  resolveSignatureHeader,
  processWebhook,
  type NgPayWebhookOptions,
} from './shared.js';

export type { NgPayWebhookOptions };

export function ngPayWebhook(options: NgPayWebhookOptions): RequestHandler {
  const { provider, onEvent, onInvalidSignature } = options;
  const sigHeader = resolveSignatureHeader(provider, options.signatureHeader);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Raw body: express.raw() puts it in req.body as a Buffer
      const rawBody: string =
        Buffer.isBuffer(req.body)
          ? req.body.toString('utf-8')
          : typeof req.body === 'string'
            ? req.body
            : JSON.stringify(req.body);

      const signature = req.headers[sigHeader] as string;

      if (!signature) {
        res.status(400).json({ error: `Missing ${sigHeader} header` });
        return;
      }

      const event = processWebhook(provider, rawBody, signature);

      // Always acknowledge before processing — prevents provider retries
      res.status(200).json({ received: true });

      if (onEvent) {
        await onEvent(event, req, res);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'WebhookSignatureError') {
        if (onInvalidSignature) {
          onInvalidSignature(req, res);
          return;
        }
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }
      next(err);
    }
  };
}
