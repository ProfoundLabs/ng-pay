import type { NgPayProvider, WebhookEvent } from '@ng-pay/core';
import { WebhookSignatureError } from '@ng-pay/core';

export interface NgPayWebhookOptions {
  /** The provider instance to use for verification and parsing */
  provider: NgPayProvider;
  /**
   * Function to retrieve the raw body from the request.
   * Must be the RAW string, not parsed JSON.
   * In Express: use express.raw() middleware upstream.
   * In Fastify: use addContentTypeParser for application/json.
   */
  getRawBody?: (req: unknown) => string | Buffer | undefined;
  /** Called after successful signature verification */
  onEvent?: (event: WebhookEvent, req: unknown, res: unknown) => Promise<void> | void;
  /** Called when signature verification fails. Default: 401 response. */
  onInvalidSignature?: (req: unknown, res: unknown) => void;
  /** Which header contains the signature. Defaults per provider:
   *  - paystack:    'x-paystack-signature'
   *  - flutterwave: 'verif-hash'
   *  - monnify:     'monnify-signature'
   */
  signatureHeader?: string;
}

export const DEFAULT_SIGNATURE_HEADERS: Record<string, string> = {
  paystack: 'x-paystack-signature',
  flutterwave: 'verif-hash',
  monnify: 'monnify-signature',
};

export function resolveSignatureHeader(provider: NgPayProvider, override?: string): string {
  return override ?? DEFAULT_SIGNATURE_HEADERS[provider.name] ?? 'x-webhook-signature';
}

export function processWebhook(
  provider: NgPayProvider,
  rawBody: string,
  signature: string
): WebhookEvent {
  const isValid = provider.verifyWebhook(rawBody, signature);
  if (!isValid) {
    throw new WebhookSignatureError(provider.name);
  }
  return provider.parseWebhookEvent(JSON.parse(rawBody));
}
