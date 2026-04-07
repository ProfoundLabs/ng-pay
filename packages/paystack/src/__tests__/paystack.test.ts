import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaystackProvider } from '../paystack.provider.js';
import { ValidationError, NgPayError } from '@ng-pay/core';

// ─────────────────────────────────────────────────────────────────────────────
// Mock fetch globally
// ─────────────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockPaystackResponse<T>(data: T, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => {
        if (key === 'content-type') return 'application/json';
        if (key === 'retry-after') return null;
        return null;
      },
      forEach: () => {},
    },
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructor validation
// ─────────────────────────────────────────────────────────────────────────────

describe('PaystackProvider constructor', () => {
  it('throws if no secret key provided', () => {
    expect(() => new PaystackProvider({ secretKey: '' })).toThrow(ValidationError);
  });

  it('throws if secret key has wrong format', () => {
    expect(() => new PaystackProvider({ secretKey: 'bad_key' })).toThrow(ValidationError);
  });

  it('accepts valid test key', () => {
    expect(() => new PaystackProvider({ secretKey: 'sk_test_abc123' })).not.toThrow();
  });

  it('accepts valid live key', () => {
    expect(() => new PaystackProvider({ secretKey: 'sk_live_abc123' })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initializePayment
// ─────────────────────────────────────────────────────────────────────────────

describe('PaystackProvider.initializePayment', () => {
  let provider: PaystackProvider;

  beforeEach(() => {
    provider = new PaystackProvider({ secretKey: 'sk_test_abc123', maxRetries: 0 });
    mockFetch.mockReset();
  });

  it('returns payment response with authorization URL', async () => {
    mockPaystackResponse({
      status: true,
      message: 'Authorization URL created',
      data: {
        authorization_url: 'https://checkout.paystack.com/abc123',
        access_code: 'abc123',
        reference: 'pstk_1234567890_aabbccdd',
      },
    });

    const result = await provider.initializePayment({
      amount: { amount: 10_000_00, currency: 'NGN' }, // ₦100,000 in kobo
      customer: { email: 'paul@example.com', name: 'Paul Adeyinka' },
    });

    expect(result.provider).toBe('paystack');
    expect(result.authorizationUrl).toBe('https://checkout.paystack.com/abc123');
    expect(result.status).toBe('pending');
    expect(result.accessCode).toBe('abc123');
  });

  it('throws ValidationError for zero amount', async () => {
    await expect(
      provider.initializePayment({
        amount: { amount: 0, currency: 'NGN' },
        customer: { email: 'paul@example.com' },
      })
    ).rejects.toThrow(ValidationError);
  });

  it('throws NgPayError when Paystack returns status: false', async () => {
    mockPaystackResponse({
      status: false,
      message: 'Email is invalid',
      data: null,
    });

    await expect(
      provider.initializePayment({
        amount: { amount: 5000, currency: 'NGN' },
        customer: { email: 'notanemail' },
      })
    ).rejects.toThrow(NgPayError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyPayment
// ─────────────────────────────────────────────────────────────────────────────

describe('PaystackProvider.verifyPayment', () => {
  let provider: PaystackProvider;

  beforeEach(() => {
    provider = new PaystackProvider({ secretKey: 'sk_test_abc123', maxRetries: 0 });
    mockFetch.mockReset();
  });

  it('returns verified payment with normalized status', async () => {
    mockPaystackResponse({
      status: true,
      message: 'Verification successful',
      data: {
        id: 12345,
        reference: 'my_ref_001',
        status: 'success',
        amount: 50_000,
        currency: 'NGN',
        channel: 'card',
        gateway_response: 'Successful',
        paid_at: '2024-04-01T12:00:00.000Z',
        fees: 500,
        customer: {
          email: 'paul@example.com',
          first_name: 'Paul',
          last_name: 'Adeyinka',
          phone: null,
          customer_code: 'CUS_abc',
          metadata: {},
          risk_action: 'default',
          international_format_phone: null,
        },
        authorization: {},
        domain: 'test',
        ip_address: '127.0.0.1',
        metadata: {},
        message: null,
        created_at: '2024-04-01T11:59:00.000Z',
      },
    });

    const result = await provider.verifyPayment('my_ref_001');

    expect(result.status).toBe('success');
    expect(result.amount.amount).toBe(50_000);
    expect(result.amount.currency).toBe('NGN');
    expect(result.customer.email).toBe('paul@example.com');
    expect(result.customer.name).toBe('Paul Adeyinka');
    expect(result.paidAt).toBeInstanceOf(Date);
    expect(result.fees?.amount).toBe(500);
  });

  it('throws ValidationError for empty reference', async () => {
    await expect(provider.verifyPayment('')).rejects.toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBanks
// ─────────────────────────────────────────────────────────────────────────────

describe('PaystackProvider.getBanks', () => {
  let provider: PaystackProvider;

  beforeEach(() => {
    provider = new PaystackProvider({ secretKey: 'sk_test_abc123', maxRetries: 0 });
    mockFetch.mockReset();
  });

  it('returns filtered active banks', async () => {
    mockPaystackResponse({
      status: true,
      message: 'Banks retrieved',
      data: [
        { id: 1, name: 'GTBank', slug: 'guaranty-trust-bank', code: '058', active: true, is_deleted: false, country: 'Nigeria', currency: 'NGN', longcode: '', gateway: null, pay_with_bank: true, type: 'nuban', createdAt: '', updatedAt: '' },
        { id: 2, name: 'Deleted Bank', slug: 'deleted', code: '999', active: false, is_deleted: true, country: 'Nigeria', currency: 'NGN', longcode: '', gateway: null, pay_with_bank: false, type: 'nuban', createdAt: '', updatedAt: '' },
      ],
    });

    const banks = await provider.getBanks();

    expect(banks).toHaveLength(1);
    expect(banks[0]?.name).toBe('GTBank');
    expect(banks[0]?.code).toBe('058');
    expect(banks[0]?.active).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyWebhook
// ─────────────────────────────────────────────────────────────────────────────

describe('PaystackProvider.verifyWebhook', () => {
  let provider: PaystackProvider;
  const secretKey = 'sk_test_mysecretkey';

  beforeEach(() => {
    provider = new PaystackProvider({ secretKey });
  });

  it('returns true for a valid signature', () => {
    const { createHmac } = require('crypto');
    const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'ref123' } });
    const signature = createHmac('sha512', secretKey).update(payload).digest('hex');

    expect(provider.verifyWebhook(payload, signature)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    const payload = JSON.stringify({ event: 'charge.success' });
    expect(provider.verifyWebhook(payload, 'badsignature')).toBe(false);
  });

  it('throws ValidationError for non-string payload', () => {
    expect(() => provider.verifyWebhook({ not: 'a string' }, 'sig')).toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseWebhookEvent
// ─────────────────────────────────────────────────────────────────────────────

describe('PaystackProvider.parseWebhookEvent', () => {
  let provider: PaystackProvider;

  beforeEach(() => {
    provider = new PaystackProvider({ secretKey: 'sk_test_abc123' });
  });

  it('parses a charge.success event', () => {
    const payload = {
      event: 'charge.success',
      data: { reference: 'ref_123', amount: 50_000 },
    };

    const event = provider.parseWebhookEvent(payload);

    expect(event.provider).toBe('paystack');
    expect(event.event).toBe('charge.success');
    expect(event.reference).toBe('ref_123');
  });

  it('sets unknown for unrecognized event types', () => {
    const event = provider.parseWebhookEvent({
      event: 'some.future.event',
      data: {},
    });
    expect(event.event).toBe('unknown');
  });

  it('throws ValidationError for non-object payload', () => {
    expect(() => provider.parseWebhookEvent('not an object')).toThrow(ValidationError);
    expect(() => provider.parseWebhookEvent(null)).toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createVirtualAccount — preferred bank configuration
// ─────────────────────────────────────────────────────────────────────────────

describe('PaystackProvider.createVirtualAccount — preferred bank', () => {
  beforeEach(() => mockFetch.mockReset());

  function mockCustomer() {
    mockPaystackResponse({ status: true, message: 'Customer created', data: { customer_code: 'CUS_abc' } });
  }
  function mockDedicatedAccount(bankSlug = 'wema-bank') {
    mockPaystackResponse({
      status: true,
      message: 'NUBAN successfully created',
      data: {
        account_number: '9876543210',
        account_name: 'Paul A. / Test Co',
        bank: { name: bankSlug === 'titan-paystack' ? 'Titan Trust Bank' : 'Wema Bank', id: bankSlug === 'titan-paystack' ? 51 : 20, slug: bankSlug },
        assigned: true,
        currency: 'NGN',
        metadata: null,
        active: true,
        id: 1,
        created_at: '2024-04-01T00:00:00.000Z',
        updated_at: '2024-04-01T00:00:00.000Z',
        assignment: { integration: 1, assignee_id: 1, assignee_type: 'Customer', expired: false, account_type: 'PAY-WITH-TRANSFER', assigned_at: '' },
        customer: { id: 1, first_name: 'Paul', last_name: 'A.', email: 'paul@example.com', customer_code: 'CUS_abc', phone: null, metadata: {}, risk_action: 'default', international_format_phone: null },
      },
    });
  }

  it('defaults to wema-bank when no preferredBank set', async () => {
    const provider = new PaystackProvider({ secretKey: 'sk_test_abc123', maxRetries: 0 });
    mockCustomer();
    mockDedicatedAccount('wema-bank');

    await provider.createVirtualAccount({ customer: { email: 'paul@example.com' } });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.preferred_bank).toBe('wema-bank');
  });

  it('uses preferredBank from constructor config', async () => {
    const provider = new PaystackProvider({
      secretKey: 'sk_test_abc123',
      preferredBank: 'titan-paystack',
      maxRetries: 0,
    });
    mockCustomer();
    mockDedicatedAccount('titan-paystack');

    await provider.createVirtualAccount({ customer: { email: 'paul@example.com' } });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.preferred_bank).toBe('titan-paystack');
  });

  it('per-call metadata.preferredBank overrides the constructor default', async () => {
    const provider = new PaystackProvider({
      secretKey: 'sk_test_abc123',
      preferredBank: 'wema-bank', // instance default
      maxRetries: 0,
    });
    mockCustomer();
    mockDedicatedAccount('sterling-bank');

    await provider.createVirtualAccount({
      customer: { email: 'paul@example.com' },
      metadata: { preferredBank: 'sterling-bank' }, // per-call override
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.preferred_bank).toBe('sterling-bank');
  });

  it('bankCode is prefixed with pstk: to distinguish from CBN codes', async () => {
    const provider = new PaystackProvider({ secretKey: 'sk_test_abc123', maxRetries: 0 });
    mockCustomer();
    mockDedicatedAccount('wema-bank');

    const account = await provider.createVirtualAccount({ customer: { email: 'paul@example.com' } });

    expect(account.bankCode).toMatch(/^pstk:/);
    expect(account.bankCode).toBe('pstk:20');
  });
});
