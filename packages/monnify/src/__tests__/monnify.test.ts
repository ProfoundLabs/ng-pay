import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonnifyProvider } from '../monnify.provider.js';
import { ValidationError, NgPayError } from '@ng-pay/core';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockMonnifyResponse<T>(body: T, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => (key === 'content-type' ? 'application/json' : null),
      forEach: () => {},
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

// Auth token response — always called first
function mockAuthToken() {
  mockMonnifyResponse({
    requestSuccessful: true,
    responseMessage: 'success',
    responseCode: '0',
    responseBody: {
      accessToken: 'test-access-token-xyz',
      expiresIn: 3600,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructor
// ─────────────────────────────────────────────────────────────────────────────

describe('MonnifyProvider constructor', () => {
  it('throws if apiKey is missing', () => {
    expect(() => new MonnifyProvider({ apiKey: '', secretKey: 'sk', contractCode: 'cc' }))
      .toThrow(ValidationError);
  });

  it('throws if secretKey is missing', () => {
    expect(() => new MonnifyProvider({ apiKey: 'ak', secretKey: '', contractCode: 'cc' }))
      .toThrow(ValidationError);
  });

  it('throws if contractCode is missing', () => {
    expect(() => new MonnifyProvider({ apiKey: 'ak', secretKey: 'sk', contractCode: '' }))
      .toThrow(ValidationError);
  });

  it('constructs successfully with valid config', () => {
    expect(() => new MonnifyProvider({
      apiKey: 'MK_TEST_abc123',
      secretKey: 'sk-secret',
      contractCode: '123456789',
      sandbox: true,
    })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth token exchange
// ─────────────────────────────────────────────────────────────────────────────

describe('MonnifyProvider auth', () => {
  let provider: MonnifyProvider;

  beforeEach(() => {
    provider = new MonnifyProvider({
      apiKey: 'MK_TEST_abc',
      secretKey: 'sk-secret',
      contractCode: '123456789',
      sandbox: true,
      maxRetries: 0,
    });
    mockFetch.mockReset();
  });

  it('exchanges Basic auth for Bearer token before first API call', async () => {
    mockAuthToken();
    mockMonnifyResponse({
      requestSuccessful: true,
      responseMessage: 'success',
      responseCode: '0',
      responseBody: [{ name: 'GTBank', code: '058', ussdTemplate: null, baseUssdCode: null, transferUssdTemplate: null }],
    });

    await provider.getBanks();

    // First call should have Basic auth (token exchange)
    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall[1].headers.Authorization).toMatch(/^Basic /);

    // Second call should have Bearer token
    const secondCall = mockFetch.mock.calls[1];
    expect(secondCall[1].headers.Authorization).toBe('Bearer test-access-token-xyz');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initializePayment
// ─────────────────────────────────────────────────────────────────────────────

describe('MonnifyProvider.initializePayment', () => {
  let provider: MonnifyProvider;

  beforeEach(() => {
    provider = new MonnifyProvider({
      apiKey: 'MK_TEST_abc',
      secretKey: 'sk-secret',
      contractCode: '123456789',
      sandbox: true,
      maxRetries: 0,
    });
    mockFetch.mockReset();
  });

  it('converts kobo to naira and returns checkout URL', async () => {
    mockAuthToken();
    mockMonnifyResponse({
      requestSuccessful: true,
      responseMessage: 'success',
      responseCode: '0',
      responseBody: {
        transactionReference: 'MNFY|20240401|001',
        paymentReference: 'mfy_1234_abcd',
        merchantName: 'Test Merchant',
        apiKey: 'MK_TEST_abc',
        redirectUrl: 'https://myapp.com/callback',
        enabledPaymentMethod: ['CARD', 'ACCOUNT_TRANSFER'],
        checkoutUrl: 'https://checkout.monnify.com/checkout/MNFY|001',
      },
    });

    const result = await provider.initializePayment({
      amount: { amount: 100_000, currency: 'NGN' }, // 100,000 kobo = ₦1,000
      customer: { email: 'paul@example.com', name: 'Paul A.' },
      callbackUrl: 'https://myapp.com/callback',
    });

    // Body sent to Monnify must be in naira
    const callBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(callBody.amount).toBe(1000); // 100_000 / 100

    expect(result.provider).toBe('monnify');
    expect(result.authorizationUrl).toBe('https://checkout.monnify.com/checkout/MNFY|001');
    expect(result.status).toBe('pending');
  });

  it('throws ValidationError for zero amount', async () => {
    mockAuthToken();
    await expect(
      provider.initializePayment({
        amount: { amount: 0, currency: 'NGN' },
        customer: { email: 'paul@example.com' },
      })
    ).rejects.toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyPayment — Monnify status normalization
// ─────────────────────────────────────────────────────────────────────────────

describe('MonnifyProvider.verifyPayment', () => {
  let provider: MonnifyProvider;

  beforeEach(() => {
    provider = new MonnifyProvider({
      apiKey: 'MK_TEST_abc',
      secretKey: 'sk-secret',
      contractCode: '123456789',
      sandbox: true,
      maxRetries: 0,
    });
    mockFetch.mockReset();
  });

  it('normalizes PAID → success and converts amount to kobo', async () => {
    mockAuthToken();
    mockMonnifyResponse({
      requestSuccessful: true,
      responseMessage: 'success',
      responseCode: '0',
      responseBody: {
        transactionReference: 'MNFY|001',
        paymentReference: 'ref_123',
        amountPaid: 5000,   // major units (naira)
        totalPayable: 5000,
        settlementAmount: 4900,
        paidOn: '2024-04-01T12:00:00.000Z',
        paymentStatus: 'PAID',
        paymentDescription: 'Test payment',
        currency: 'NGN',
        paymentMethod: 'CARD',
        product: { reference: 'ref_123', type: 'INLINE' },
        cardDetails: null,
        accountDetails: null,
        customer: { email: 'paul@example.com', name: 'Paul A.' },
        metaData: null,
      },
    });

    const result = await provider.verifyPayment('ref_123');

    expect(result.status).toBe('success');
    expect(result.amount.amount).toBe(500_000); // 5000 naira → 500,000 kobo
    expect(result.channel).toBe('card');
  });

  it('normalizes OVERPAID → success', async () => {
    mockAuthToken();
    mockMonnifyResponse({
      requestSuccessful: true,
      responseMessage: 'success',
      responseCode: '0',
      responseBody: {
        transactionReference: 'MNFY|002',
        paymentReference: 'ref_overpaid',
        amountPaid: 6000,
        totalPayable: 5000,
        settlementAmount: 5900,
        paidOn: '2024-04-01T12:00:00.000Z',
        paymentStatus: 'OVERPAID',
        paymentDescription: '',
        currency: 'NGN',
        paymentMethod: 'ACCOUNT_TRANSFER',
        product: { reference: 'ref_overpaid', type: 'INLINE' },
        cardDetails: null,
        accountDetails: null,
        customer: { email: 'x@x.com', name: 'X' },
        metaData: null,
      },
    });

    const result = await provider.verifyPayment('ref_overpaid');
    expect(result.status).toBe('success');
    expect(result.channel).toBe('bank_transfer');
  });

  it('normalizes PARTIALLY_PAID → processing', async () => {
    mockAuthToken();
    mockMonnifyResponse({
      requestSuccessful: true,
      responseMessage: 'success',
      responseCode: '0',
      responseBody: {
        transactionReference: 'MNFY|003',
        paymentReference: 'ref_partial',
        amountPaid: 2500,
        totalPayable: 5000,
        settlementAmount: 2400,
        paidOn: null,
        paymentStatus: 'PARTIALLY_PAID',
        paymentDescription: '',
        currency: 'NGN',
        paymentMethod: 'ACCOUNT_TRANSFER',
        product: { reference: 'ref_partial', type: 'INLINE' },
        cardDetails: null,
        accountDetails: null,
        customer: { email: 'x@x.com', name: 'X' },
        metaData: null,
      },
    });

    const result = await provider.verifyPayment('ref_partial');
    expect(result.status).toBe('processing');
  });

  it('throws ValidationError for empty reference', async () => {
    mockAuthToken();
    await expect(provider.verifyPayment('')).rejects.toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createVirtualAccount (Reserved Account)
// ─────────────────────────────────────────────────────────────────────────────

describe('MonnifyProvider.createVirtualAccount', () => {
  let provider: MonnifyProvider;

  beforeEach(() => {
    provider = new MonnifyProvider({
      apiKey: 'MK_TEST_abc',
      secretKey: 'sk-secret',
      contractCode: '123456789',
      sandbox: true,
      maxRetries: 0,
    });
    mockFetch.mockReset();
  });

  it('returns normalized virtual account from reserved account response', async () => {
    mockAuthToken();
    mockMonnifyResponse({
      requestSuccessful: true,
      responseMessage: 'success',
      responseCode: '0',
      responseBody: {
        contractCode: '123456789',
        accountReference: 'mfy-va_ref123',
        accountName: 'Paul A.',
        currencyCode: 'NGN',
        customerEmail: 'paul@example.com',
        customerName: 'Paul A.',
        accountNumber: '9876543210',
        bankName: 'Wema Bank',
        bankCode: '035',
        collectionChannel: 'RESERVED_ACCOUNT',
        reservationReference: 'MNFY|RESERVED|001',
        reservedAccountType: 'GENERAL',
        status: 'ACTIVE',
        createdOn: '2024-04-01T10:00:00.000Z',
        incomeSplitConfig: [],
        restrictPaymentSource: false,
      },
    });

    const account = await provider.createVirtualAccount({
      customer: { email: 'paul@example.com', name: 'Paul A.' },
    });

    expect(account.provider).toBe('monnify');
    expect(account.accountNumber).toBe('9876543210');
    expect(account.bankName).toBe('Wema Bank');
    expect(account.bankCode).toBe('035');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBanks
// ─────────────────────────────────────────────────────────────────────────────

describe('MonnifyProvider.getBanks', () => {
  let provider: MonnifyProvider;

  beforeEach(() => {
    provider = new MonnifyProvider({
      apiKey: 'MK_TEST_abc',
      secretKey: 'sk-secret',
      contractCode: '123456789',
      sandbox: true,
      maxRetries: 0,
    });
    mockFetch.mockReset();
  });

  it('maps Monnify bank shape to normalized Bank', async () => {
    mockAuthToken();
    mockMonnifyResponse({
      requestSuccessful: true,
      responseMessage: 'success',
      responseCode: '0',
      responseBody: [
        { name: 'GTBank', code: '058', ussdTemplate: null, baseUssdCode: '*737#', transferUssdTemplate: null },
        { name: 'First Bank', code: '011', ussdTemplate: null, baseUssdCode: '*894#', transferUssdTemplate: null },
      ],
    });

    const banks = await provider.getBanks();

    expect(banks).toHaveLength(2);
    expect(banks[0]?.code).toBe('058');
    expect(banks[0]?.ussd).toBe('*737#');
    expect(banks[1]?.code).toBe('011');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyWebhook — HMAC-SHA512 (same as Paystack)
// ─────────────────────────────────────────────────────────────────────────────

describe('MonnifyProvider.verifyWebhook', () => {
  let provider: MonnifyProvider;
  const secretKey = 'sk-secret';

  beforeEach(() => {
    provider = new MonnifyProvider({
      apiKey: 'MK_TEST_abc',
      secretKey,
      contractCode: '123456789',
    });
  });

  it('returns true for a valid HMAC signature', () => {
    const { createHmac } = require('crypto');
    const payload = JSON.stringify({ eventType: 'SUCCESSFUL_TRANSACTION', eventData: { paymentReference: 'ref1' } });
    const signature = createHmac('sha512', secretKey).update(payload).digest('hex');
    expect(provider.verifyWebhook(payload, signature)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    const payload = JSON.stringify({ eventType: 'SUCCESSFUL_TRANSACTION' });
    expect(provider.verifyWebhook(payload, 'wrong')).toBe(false);
  });

  it('throws ValidationError for non-string payload', () => {
    expect(() => provider.verifyWebhook({ not: 'a string' }, 'sig')).toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseWebhookEvent — Monnify event name mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('MonnifyProvider.parseWebhookEvent', () => {
  let provider: MonnifyProvider;

  beforeEach(() => {
    provider = new MonnifyProvider({
      apiKey: 'MK_TEST_abc',
      secretKey: 'sk-secret',
      contractCode: '123456789',
    });
  });

  it('maps SUCCESSFUL_TRANSACTION → charge.success', () => {
    const event = provider.parseWebhookEvent({
      eventType: 'SUCCESSFUL_TRANSACTION',
      eventData: { paymentReference: 'ref_123', amountPaid: 5000 },
    });

    expect(event.provider).toBe('monnify');
    expect(event.event).toBe('charge.success');
    expect(event.reference).toBe('ref_123');
  });

  it('maps SUCCESSFUL_DISBURSEMENT → transfer.success', () => {
    const event = provider.parseWebhookEvent({
      eventType: 'SUCCESSFUL_DISBURSEMENT',
      eventData: { paymentReference: 'trf_001' },
    });
    expect(event.event).toBe('transfer.success');
  });

  it('maps REVERSED_DISBURSEMENT → transfer.reversed', () => {
    const event = provider.parseWebhookEvent({
      eventType: 'REVERSED_DISBURSEMENT',
      eventData: { paymentReference: 'trf_002' },
    });
    expect(event.event).toBe('transfer.reversed');
  });

  it('handles unknown event types gracefully', () => {
    const event = provider.parseWebhookEvent({ eventType: 'SOME_FUTURE_EVENT', eventData: {} });
    expect(event.event).toBe('unknown');
  });

  it('throws ValidationError for non-object payload', () => {
    expect(() => provider.parseWebhookEvent(null)).toThrow(ValidationError);
    expect(() => provider.parseWebhookEvent('string')).toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox inference — security fix
// ─────────────────────────────────────────────────────────────────────────────

describe('MonnifyProvider sandbox resolution', () => {
  it('infers sandbox from MK_TEST_ prefix when sandbox not specified', () => {
    const provider = new MonnifyProvider({
      apiKey: 'MK_TEST_abc123',
      secretKey: 'sk',
      contractCode: 'cc',
      // sandbox not specified — should infer from key
    });
    expect(provider).toBeDefined(); // didn't throw
  });

  it('infers production from MK_LIVE_ prefix when sandbox not specified', () => {
    const provider = new MonnifyProvider({
      apiKey: 'MK_LIVE_abc123',
      secretKey: 'sk',
      contractCode: 'cc',
    });
    expect(provider).toBeDefined();
  });

  it('throws when key prefix is ambiguous and sandbox is not set', () => {
    expect(() => new MonnifyProvider({
      apiKey: 'AMBIGUOUS_KEY',
      secretKey: 'sk',
      contractCode: 'cc',
      // no sandbox flag, no recognized prefix
    })).toThrow(ValidationError);
  });

  it('explicit sandbox: true overrides key prefix', () => {
    expect(() => new MonnifyProvider({
      apiKey: 'AMBIGUOUS_KEY',
      secretKey: 'sk',
      contractCode: 'cc',
      sandbox: true,            // explicit — should not throw
    })).not.toThrow();
  });

  it('explicit sandbox: false overrides key prefix', () => {
    expect(() => new MonnifyProvider({
      apiKey: 'AMBIGUOUS_KEY',
      secretKey: 'sk',
      contractCode: 'cc',
      sandbox: false,
    })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Access token — non-enumerable
// ─────────────────────────────────────────────────────────────────────────────

describe('MonnifyProvider access token security', () => {
  it('does not expose _accessToken via JSON.stringify', () => {
    const provider = new MonnifyProvider({
      apiKey: 'MK_TEST_abc',
      secretKey: 'sk',
      contractCode: 'cc',
    });

    const serialized = JSON.stringify(provider);
    expect(serialized).not.toContain('_accessToken');
    expect(serialized).not.toContain('accessToken');
  });

  it('does not expose _accessToken via Object.keys', () => {
    const provider = new MonnifyProvider({
      apiKey: 'MK_TEST_abc',
      secretKey: 'sk',
      contractCode: 'cc',
    });

    expect(Object.keys(provider)).not.toContain('_accessToken');
    expect(Object.keys(provider)).not.toContain('_basicUsername');
  });
});
