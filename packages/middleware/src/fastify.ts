/**
 * @ng-pay/middleware/fastify
 *
 * Usage:
 *   import Fastify from 'fastify';
 *   import { ngPayWebhookPlugin } from '@ng-pay/middleware/fastify';
 *   import { PaystackProvider } from '@ng-pay/paystack';
 *
 *   const app = Fastify();
 *   const paystack = new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! });
 *
 *   await app.register(ngPayWebhookPlugin, {
 *     provider: paystack,
 *     routePrefix: '/webhooks/paystack',
 *     onEvent: async (event) => {
 *       if (event.event === 'charge.success') {
 *         await fulfillOrder(event.reference!);
 *       }
 *     },
 *   });
 *
 * Or use the route hook directly on an existing route:
 *
 *   app.post('/webhooks/paystack', {
 *     preHandler: ngPayWebhookHook({ provider: paystack }),
 *   }, async (request, reply) => {
 *     const event = request.ngPayEvent; // typed WebhookEvent
 *     reply.send({ received: true });
 *   });
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { WebhookEvent } from '@ng-pay/core';
import { WebhookSignatureError } from '@ng-pay/core';
import { resolveSignatureHeader, processWebhook, type NgPayWebhookOptions } from './shared.js';

export type { NgPayWebhookOptions };

// Augment Fastify request to include the parsed event
declare module 'fastify' {
  interface FastifyRequest {
    ngPayEvent?: WebhookEvent;
  }
}

export interface NgPayFastifyOptions extends NgPayWebhookOptions {
  /**
   * If provided, registers a POST route at this path.
   * If omitted, use ngPayWebhookHook() on individual routes.
   */
  routePrefix?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin — registers a dedicated webhook POST route
// ─────────────────────────────────────────────────────────────────────────────

export const ngPayWebhookPlugin: FastifyPluginAsync<NgPayFastifyOptions> = async (
  fastify,
  options
) => {
  const { provider, onEvent, onInvalidSignature, routePrefix = '/webhooks' } = options;
  const sigHeader = resolveSignatureHeader(provider, options.signatureHeader);

  // Tell Fastify to keep raw body accessible
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  fastify.post(routePrefix, async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = request.body as string;
    const signature = (request.headers[sigHeader] as string) ?? '';

    if (!signature) {
      return reply.status(400).send({ error: `Missing ${sigHeader} header` });
    }

    try {
      const event = processWebhook(provider, rawBody, signature);
      request.ngPayEvent = event;

      // Acknowledge immediately before processing
      reply.status(200).send({ received: true });

      if (onEvent) {
        await onEvent(event, request, reply);
      }
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        if (onInvalidSignature) {
          onInvalidSignature(request, reply);
          return;
        }
        return reply.status(401).send({ error: 'Invalid webhook signature' });
      }
      throw err;
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook — use on individual routes as a preHandler
// ─────────────────────────────────────────────────────────────────────────────

export function ngPayWebhookHook(options: NgPayWebhookOptions) {
  const { provider, onInvalidSignature } = options;
  const sigHeader = resolveSignatureHeader(provider, options.signatureHeader);

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const rawBody = request.body as string;
    const signature = (request.headers[sigHeader] as string) ?? '';

    if (!signature) {
      reply.status(400).send({ error: `Missing ${sigHeader} header` });
      return;
    }

    try {
      const event = processWebhook(provider, rawBody, signature);
      request.ngPayEvent = event;
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        if (onInvalidSignature) {
          onInvalidSignature(request, reply);
          return;
        }
        reply.status(401).send({ error: 'Invalid webhook signature' });
        return;
      }
      throw err;
    }
  };
}
