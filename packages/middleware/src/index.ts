// Shared types and utilities
export {
  processWebhook,
  resolveSignatureHeader,
  DEFAULT_SIGNATURE_HEADERS,
} from './shared.js';
export type { NgPayWebhookOptions } from './shared.js';

// Express
export { ngPayWebhook } from './express.js';

// NestJS
export {
  createNgPayGuard,
  NgPayWebhookEvent,
  NgPayWebhookModule,
  NG_PAY_WEBHOOK_GUARD,
  NG_PAY_WEBHOOK_EVENT_KEY,
} from './nestjs.js';

// Fastify
export { ngPayWebhookPlugin, ngPayWebhookHook } from './fastify.js';
export type { NgPayFastifyOptions } from './fastify.js';
