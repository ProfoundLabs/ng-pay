import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processWebhook, resolveSignatureHeader, DEFAULT_SIGNATURE_HEADERS } from '../shared.js';
import { ngPayWebhook } from '../express.js';
import { ngPayWebhookHook } from '../fastify.js';
import type { NgPayProvider, WebhookEvent } from '@ng-pay/core';
import { WebhookSignatureError } from '@ng-pay/core';

// ─────────────────────────────────────────────────────────────────────────────
// Mock provider factory
// ─────────────────────────────────────────────────────────────────────────────

function makeMockProvider(name = 'paystack', signatureValid = true): NgPayProvider {
  return {
    name,
    initializePayment: vi.fn(),
    verifyPayment: vi.fn(),
    createVirtualAccount: vi.fn(),
    createTransferRecipient: vi.fn(),
    initiateTransfer: vi.fn(),
    verifyTransfer: vi.fn(),
    getBanks: vi.fn(),
    resolveAccount: vi.fn(),
    verifyWebhook: vi.fn().mockReturnValue(signatureValid),
    parseWebhookEvent: vi.fn().mockReturnValue({
      provider: name,
      event: 'charge.success',
      reference: 'ref_123',
      data: { amount: 5000 },
      raw: {},
    } satisfies WebhookEvent),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────────────────────────

describe('DEFAULT_SIGNATURE_HEADERS', () => {
  it('has correct header for each provider', () => {
    expect(DEFAULT_SIGNATURE_HEADERS['paystack']).toBe('x-paystack-signature');
    expect(DEFAULT_SIGNATURE_HEADERS['flutterwave']).toBe('verif-hash');
    expect(DEFAULT_SIGNATURE_HEADERS['monnify']).toBe('monnify-signature');
  });
});

describe('resolveSignatureHeader', () => {
  it('returns provider default when no override given', () => {
    const provider = makeMockProvider('paystack');
    expect(resolveSignatureHeader(provider)).toBe('x-paystack-signature');
  });

  it('returns override when provided', () => {
    const provider = makeMockProvider('paystack');
    expect(resolveSignatureHeader(provider, 'x-custom-sig')).toBe('x-custom-sig');
  });

  it('falls back to generic header for unknown providers', () => {
    const provider = makeMockProvider('unknown-provider');
    expect(resolveSignatureHeader(provider)).toBe('x-webhook-signature');
  });
});

describe('processWebhook', () => {
  it('returns parsed event for valid signature', () => {
    const provider = makeMockProvider('paystack', true);
    const payload = JSON.stringify({ event: 'charge.success', data: {} });
    const event = processWebhook(provider, payload, 'valid-sig');

    expect(provider.verifyWebhook).toHaveBeenCalledWith(payload, 'valid-sig');
    expect(event.event).toBe('charge.success');
    expect(event.reference).toBe('ref_123');
  });

  it('throws WebhookSignatureError for invalid signature', () => {
    const provider = makeMockProvider('paystack', false);
    const payload = JSON.stringify({ event: 'charge.success', data: {} });

    expect(() => processWebhook(provider, payload, 'bad-sig')).toThrow(WebhookSignatureError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Express middleware
// ─────────────────────────────────────────────────────────────────────────────

describe('ngPayWebhook (Express)', () => {
  function makeReq(overrides: Record<string, unknown> = {}) {
    return {
      headers: { 'x-paystack-signature': 'valid-sig' },
      body: Buffer.from(JSON.stringify({ event: 'charge.success', data: {} })),
      ...overrides,
    };
  }

  function makeRes() {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    return res;
  }

  it('calls onEvent with parsed event and sends 200', async () => {
    const provider = makeMockProvider('paystack', true);
    const onEvent = vi.fn();
    const middleware = ngPayWebhook({ provider, onEvent });

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(onEvent).toHaveBeenCalledOnce();
    const [event] = onEvent.mock.calls[0]!;
    expect(event.event).toBe('charge.success');
  });

  it('returns 401 when signature is invalid', async () => {
    const provider = makeMockProvider('paystack', false);
    const middleware = ngPayWebhook({ provider });

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when signature header is missing', async () => {
    const provider = makeMockProvider('paystack', true);
    const middleware = ngPayWebhook({ provider });

    const req = makeReq({ headers: {} }); // no signature header
    const res = makeRes();
    const next = vi.fn();

    await middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('calls custom onInvalidSignature handler when provided', async () => {
    const provider = makeMockProvider('paystack', false);
    const onInvalidSignature = vi.fn();
    const middleware = ngPayWebhook({ provider, onInvalidSignature });

    const req = makeReq();
    const res = makeRes();

    await middleware(req as any, res as any, vi.fn());

    expect(onInvalidSignature).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  it('respects custom signatureHeader', async () => {
    const provider = makeMockProvider('paystack', true);
    const onEvent = vi.fn();
    const middleware = ngPayWebhook({ provider, onEvent, signatureHeader: 'x-custom-sig' });

    const req = makeReq({ headers: { 'x-custom-sig': 'valid-sig' } });
    const res = makeRes();

    await middleware(req as any, res as any, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(onEvent).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fastify hook
// ─────────────────────────────────────────────────────────────────────────────

describe('ngPayWebhookHook (Fastify)', () => {
  function makeRequest(overrides: Record<string, unknown> = {}) {
    return {
      headers: { 'x-paystack-signature': 'valid-sig' },
      body: JSON.stringify({ event: 'charge.success', data: {} }),
      ngPayEvent: undefined as WebhookEvent | undefined,
      ...overrides,
    };
  }

  function makeReply() {
    return {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
  }

  it('attaches parsed event to request.ngPayEvent on success', async () => {
    const provider = makeMockProvider('paystack', true);
    const hook = ngPayWebhookHook({ provider });

    const request = makeRequest();
    const reply = makeReply();

    await hook(request as any, reply as any);

    expect(request.ngPayEvent).toBeDefined();
    expect(request.ngPayEvent?.event).toBe('charge.success');
    expect(reply.status).not.toHaveBeenCalled(); // no error
  });

  it('returns 401 for invalid signature', async () => {
    const provider = makeMockProvider('paystack', false);
    const hook = ngPayWebhookHook({ provider });

    const request = makeRequest();
    const reply = makeReply();

    await hook(request as any, reply as any);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(request.ngPayEvent).toBeUndefined();
  });

  it('returns 400 when signature header missing', async () => {
    const provider = makeMockProvider('paystack', true);
    const hook = ngPayWebhookHook({ provider });

    const request = makeRequest({ headers: {} });
    const reply = makeReply();

    await hook(request as any, reply as any);

    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it('calls custom onInvalidSignature for bad signature', async () => {
    const provider = makeMockProvider('paystack', false);
    const onInvalidSignature = vi.fn();
    const hook = ngPayWebhookHook({ provider, onInvalidSignature });

    const request = makeRequest();
    const reply = makeReply();

    await hook(request as any, reply as any);

    expect(onInvalidSignature).toHaveBeenCalledOnce();
    expect(reply.status).not.toHaveBeenCalledWith(401);
  });
});
