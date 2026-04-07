import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlutterwaveProvider } from '../flutterwave.provider.js';
import { ValidationError, NgPayError } from '@ng-pay/core';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockFlwResponse<T>(data: T, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => (key === 'content-type' ? 'application/json' : null),
      forEach: () => {},
    },
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructor
// ─────────────────────────────────────────────────────────────────────────────

describe('FlutterwaveProvider constructor', () => {
  it('throws if no secret key', () => {
    expect(() => new FlutterwaveProvider({ secretKey: '' })).toThrow(ValidationError);
  });

  it('throws if key has wrong format', () => {
    expect(() => new FlutterwaveProvider({ secretKey: 'bad_key_format' })).toThrow(ValidationError);
  });

  it('accepts a valid test key', () => {
    expect(() => new FlutterwaveProvider({ secretKey: 'FLWSECK_TEST-abc123' })).not.toThrow();
  });

  it('accepts a valid live key', () => {
    expect(() => new FlutterwaveProvider({ secretKey: 'FLWSECK-abc123' })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initializePayment
// ─────────────────────────────────────────────────────────────────────────────

describe('FlutterwaveProvider.initializePayment', () => {
  let provider: FlutterwaveProvider;

  beforeEach(() => {
    provider = new FlutterwaveProvider({ secretKey: 'FLWSECK_TEST-abc123', maxRetries: 0 });
    mockFetch.mockReset();
  });

  it('converts kobo to naira before sending', async () => {
    mockFlwResponse({
      status: 'success',
      message: 'Hosted Link',
      data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' },
    });

    const result = await provider.initializePayment({
      amount: { amount: 500_000, currency: 'NGN' }, // 500,000 kobo = ₦5,000
      customer: { email: 'paul@example.com', name: 'Paul A.' },
      callbackUrl: 'https://myapp.com/callback',
    });

    // Verify the body sent to Flutterwave has major units
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.amount).toBe(5000); // 500_000 / 100

    expect(result.provider).toBe('flutterwave');
    expect(result.authorizationUrl).toBe('https://checkout.flutterwave.com/v3/hosted/pay/abc');
    expect(result.status).toBe('pending');
  });

  it('throws ValidationError for zero amount', async () => {
    await expect(
      provider.initializePayment({
        amount: { amount: 0, currency: 'NGN' },
        customer: { email: 'paul@example.com' },
      })
    ).rejects.toThrow(ValidationError);
  });

  it('throws NgPayError when Flutterwave returns status: error', async () => {
    mockFlwResponse({ status: 'error', message: 'Invalid key', data: null });

    await expect(
      provider.initializePayment({
        amount: { amount: 5000, currency: 'NGN' },
        customer: { email: 'paul@example.com' },
      })
    ).rejects.toThrow(NgPayError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyPayment — status normalization
// ─────────────────────────────────────────────────────────────────────────────

describe('FlutterwaveProvider.verifyPayment', () => {
  let provider: FlutterwaveProvider;

  beforeEach(() => {
    provider = new FlutterwaveProvider({ secretKey: 'FLWSECK_TEST-abc123', maxRetries: 0 });
    mockFetch.mockReset();
  });

  it('normalizes "successful" → "success" and converts amount to kobo', async () => {
    // Step 1: search by tx_ref
    mockFlwResponse({
      status: 'success',
      message: 'Transactions fetched',
      data: {
        data: [{
          id: 99,
          tx_ref: 'my_ref_001',
          flw_ref: 'FLW-001',
          amount: 5000,          // major units (naira)
          currency: 'NGN',
          status: 'successful',
          payment_type: 'card',
          created_at: '2024-04-01T12:00:00.000Z',
          customer: { email: 'paul@example.com', name: 'Paul A.', phone_number: null },
          app_fee: 100,
          charged_amount: 5000,
          processor_response: 'Approved',
          device_fingerprint: '',
          auth_model: '',
          ip: '',
          narration: '',
          account_id: 1,
          meta: null,
        }],
      },
    });

    // Step 2: verify by ID
    mockFlwResponse({
      status: 'success',
      message: 'Transaction fetched',
      data: {
        id: 99,
        tx_ref: 'my_ref_001',
        flw_ref: 'FLW-001',
        amount: 5000,
        currency: 'NGN',
        charged_amount: 5000,
        app_fee: 100,
        status: 'successful',
        payment_type: 'card',
        created_at: '2024-04-01T12:00:00.000Z',
        customer: { email: 'paul@example.com', name: 'Paul A.', phone_number: null },
        processor_response: 'Approved',
        device_fingerprint: '',
        auth_model: '',
        ip: '',
        narration: '',
        account_id: 1,
        meta: null,
        merchant_fee: 0,
      },
    });

    const result = await provider.verifyPayment('my_ref_001');

    expect(result.status).toBe('success');
    expect(result.amount.amount).toBe(500_000); // 5000 naira → 500,000 kobo
    expect(result.amount.currency).toBe('NGN');
    expect(result.channel).toBe('card');
    expect(result.fees?.amount).toBe(10_000); // 100 naira → 10,000 kobo
  });

  it('normalizes "cancelled" → "abandoned"', async () => {
    mockFlwResponse({
      status: 'success',
      message: 'Transactions fetched',
      data: { data: [{ id: 100, tx_ref: 'ref2', amount: 1000, currency: 'NGN', status: 'cancelled', payment_type: 'card', created_at: '2024-04-01T12:00:00.000Z', customer: { email: 'x@x.com', name: '', phone_number: null }, app_fee: 0, charged_amount: 0, processor_response: '', device_fingerprint: '', auth_model: '', ip: '', narration: '', account_id: 1, meta: null, merchant_fee: 0, flw_ref: '' }] },
    });
    mockFlwResponse({
      status: 'success',
      message: 'Transaction fetched',
      data: { id: 100, tx_ref: 'ref2', flw_ref: '', amount: 1000, currency: 'NGN', charged_amount: 0, app_fee: 0, status: 'cancelled', payment_type: 'card', created_at: '2024-04-01T12:00:00.000Z', customer: { email: 'x@x.com', name: '', phone_number: null }, processor_response: '', device_fingerprint: '', auth_model: '', ip: '', narration: '', account_id: 1, meta: null, merchant_fee: 0 },
    });

    const result = await provider.verifyPayment('ref2');
    expect(result.status).toBe('abandoned');
  });

  it('throws NgPayError when transaction not found', async () => {
    mockFlwResponse({
      status: 'success',
      message: 'Transactions fetched',
      data: { data: [] },
    });

    await expect(provider.verifyPayment('nonexistent')).rejects.toThrow(NgPayError);
  });

  it('throws ValidationError for empty reference', async () => {
    await expect(provider.verifyPayment('')).rejects.toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBanks
// ─────────────────────────────────────────────────────────────────────────────

describe('FlutterwaveProvider.getBanks', () => {
  let provider: FlutterwaveProvider;

  beforeEach(() => {
    provider = new FlutterwaveProvider({ secretKey: 'FLWSECK_TEST-abc123', maxRetries: 0 });
    mockFetch.mockReset();
  });

  it('maps Flutterwave bank shape to normalized Bank', async () => {
    mockFlwResponse({
      status: 'success',
      message: 'Banks fetched',
      data: [
        { id: 1, code: '058', name: 'Guaranty Trust Bank' },
        { id: 2, code: '044', name: 'Access Bank' },
      ],
    });

    const banks = await provider.getBanks();

    expect(banks).toHaveLength(2);
    expect(banks[0]?.name).toBe('Guaranty Trust Bank');
    expect(banks[0]?.code).toBe('058');
    expect(banks[0]?.currency).toBe('NGN');
    expect(banks[0]?.active).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyWebhook — plain header comparison (not HMAC)
// ─────────────────────────────────────────────────────────────────────────────

describe('FlutterwaveProvider.verifyWebhook', () => {
  const secretKey = 'FLWSECK_TEST-mysecret';
  let provider: FlutterwaveProvider;

  beforeEach(() => {
    provider = new FlutterwaveProvider({ secretKey });
  });

  it('returns true when signature matches secret key exactly', () => {
    const payload = JSON.stringify({ event: 'charge.completed', data: {} });
    // Flutterwave: verif-hash header must equal secret key
    expect(provider.verifyWebhook(payload, secretKey)).toBe(true);
  });

  it('returns false when signature does not match', () => {
    const payload = JSON.stringify({ event: 'charge.completed', data: {} });
    expect(provider.verifyWebhook(payload, 'wrong-secret')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseWebhookEvent — Flutterwave event name mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('FlutterwaveProvider.parseWebhookEvent', () => {
  let provider: FlutterwaveProvider;

  beforeEach(() => {
    provider = new FlutterwaveProvider({ secretKey: 'FLWSECK_TEST-abc123' });
  });

  it('maps charge.completed → charge.success', () => {
    const event = provider.parseWebhookEvent({
      event: 'charge.completed',
      data: { tx_ref: 'ref_123', amount: 5000, status: 'successful' },
    });

    expect(event.provider).toBe('flutterwave');
    expect(event.event).toBe('charge.success');
    expect(event.reference).toBe('ref_123');
  });

  it('maps transfer.completed → transfer.success', () => {
    const event = provider.parseWebhookEvent({
      event: 'transfer.completed',
      data: { reference: 'trf_001' },
    });
    expect(event.event).toBe('transfer.success');
    expect(event.reference).toBe('trf_001');
  });

  it('sets unknown for unrecognized events', () => {
    const event = provider.parseWebhookEvent({ event: 'some.future.event', data: {} });
    expect(event.event).toBe('unknown');
  });

  it('throws ValidationError for non-object payload', () => {
    expect(() => provider.parseWebhookEvent(null)).toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createTransferRecipient — encodes bank details as base64
// ─────────────────────────────────────────────────────────────────────────────

describe('FlutterwaveProvider.createTransferRecipient', () => {
  let provider: FlutterwaveProvider;

  beforeEach(() => {
    provider = new FlutterwaveProvider({ secretKey: 'FLWSECK_TEST-abc123', maxRetries: 0 });
    mockFetch.mockReset();
  });

  it('returns a decodable recipientCode', async () => {
    // getBanks call
    mockFlwResponse({
      status: 'success',
      message: 'Banks fetched',
      data: [{ id: 1, code: '058', name: 'Guaranty Trust Bank' }],
    });

    const recipient = await provider.createTransferRecipient({
      name: 'Paul Adeyinka',
      accountNumber: '0123456789',
      bankCode: '058',
    });

    expect(recipient.provider).toBe('flutterwave');
    expect(recipient.accountNumber).toBe('0123456789');
    expect(recipient.bankCode).toBe('058');
    expect(recipient.bankName).toBe('Guaranty Trust Bank');
    // Decode and verify recipientCode contains the right data
    const decoded = JSON.parse(Buffer.from(recipient.recipientCode, 'base64').toString());
    expect(decoded.account_number).toBe('0123456789');
    expect(decoded.bank_code).toBe('058');
  });
});
