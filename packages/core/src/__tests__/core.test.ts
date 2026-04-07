import { describe, it, expect, vi } from 'vitest';
import {
  toKobo,
  fromKobo,
  formatMoney,
  generateReference,
  isValidNUBAN,
  isValidBankCode,
  NgPayError,
  AuthenticationError,
  ValidationError,
  RateLimitError,
  TimeoutError,
  isNgPayError,
  isRateLimitError,
} from '../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Money utilities
// ─────────────────────────────────────────────────────────────────────────────

describe('Money utilities', () => {
  describe('toKobo', () => {
    it('converts naira to kobo correctly', () => {
      expect(toKobo(100)).toBe(10_000);
      expect(toKobo(1)).toBe(100);
      expect(toKobo(0.5)).toBe(50);
    });

    it('handles floating point correctly', () => {
      expect(toKobo(1000.99)).toBe(100_099);
    });

    it('returns 0 for 0', () => {
      expect(toKobo(0)).toBe(0);
    });
  });

  describe('fromKobo', () => {
    it('converts kobo to naira correctly', () => {
      expect(fromKobo(10_000)).toBe(100);
      expect(fromKobo(100)).toBe(1);
      expect(fromKobo(50)).toBe(0.5);
    });
  });

  describe('formatMoney', () => {
    it('formats NGN correctly', () => {
      const formatted = formatMoney({ amount: 10_000_00, currency: 'NGN' });
      expect(formatted).toContain('10,000');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reference generation
// ─────────────────────────────────────────────────────────────────────────────

describe('generateReference', () => {
  it('generates a reference with default prefix', () => {
    const ref = generateReference();
    expect(ref).toMatch(/^ngp_\d+_[a-f0-9]{8}$/);
  });

  it('generates a reference with custom prefix', () => {
    const ref = generateReference('pstk');
    expect(ref).toMatch(/^pstk_\d+_[a-f0-9]{8}$/);
  });

  it('generates unique references', () => {
    const refs = new Set(Array.from({ length: 100 }, () => generateReference()));
    expect(refs.size).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NUBAN / Bank code validation
// ─────────────────────────────────────────────────────────────────────────────

describe('isValidNUBAN', () => {
  it('accepts valid 10-digit account numbers', () => {
    expect(isValidNUBAN('0123456789')).toBe(true);
    expect(isValidNUBAN('9876543210')).toBe(true);
  });

  it('rejects invalid account numbers', () => {
    expect(isValidNUBAN('012345678')).toBe(false);   // too short
    expect(isValidNUBAN('01234567890')).toBe(false); // too long
    expect(isValidNUBAN('012345678a')).toBe(false);  // non-digit
    expect(isValidNUBAN('')).toBe(false);
  });
});

describe('isValidBankCode', () => {
  it('accepts valid 3-digit bank codes', () => {
    expect(isValidBankCode('058')).toBe(true); // GTBank
    expect(isValidBankCode('011')).toBe(true); // First Bank
  });

  it('rejects invalid bank codes', () => {
    expect(isValidBankCode('58')).toBe(false);    // too short
    expect(isValidBankCode('0058')).toBe(false);  // too long
    expect(isValidBankCode('abc')).toBe(false);   // non-digit
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error classes
// ─────────────────────────────────────────────────────────────────────────────

describe('NgPayError', () => {
  it('creates error with correct properties', () => {
    const error = new NgPayError({
      provider: 'paystack',
      code: 'PROVIDER_ERROR',
      message: 'Something went wrong',
      statusCode: 500,
      raw: { detail: 'internal error' },
    });

    expect(error.provider).toBe('paystack');
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.message).toBe('Something went wrong');
    expect(error.statusCode).toBe(500);
    expect(error.raw).toEqual({ detail: 'internal error' });
    expect(error.name).toBe('NgPayError');
  });

  it('is an instance of Error', () => {
    const error = new NgPayError({
      provider: 'paystack',
      code: 'UNKNOWN',
      message: 'test',
    });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(NgPayError);
  });

  it('serializes to JSON correctly', () => {
    const error = new NgPayError({
      provider: 'paystack',
      code: 'RATE_LIMITED',
      message: 'Rate limited',
      statusCode: 429,
    });
    const json = error.toJSON();
    expect(json).toEqual({
      name: 'NgPayError',
      provider: 'paystack',
      code: 'RATE_LIMITED',
      message: 'Rate limited',
      statusCode: 429,
    });
  });
});

describe('AuthenticationError', () => {
  it('sets code to INVALID_API_KEY', () => {
    const error = new AuthenticationError({ provider: 'paystack', message: 'bad key' });
    expect(error.code).toBe('INVALID_API_KEY');
    expect(error.name).toBe('AuthenticationError');
    expect(error).toBeInstanceOf(NgPayError);
  });
});

describe('ValidationError', () => {
  it('captures field name', () => {
    const error = new ValidationError({
      provider: 'paystack',
      message: 'Invalid email',
      field: 'email',
    });
    expect(error.field).toBe('email');
    expect(error.code).toBe('INVALID_PARAMS');
  });
});

describe('RateLimitError', () => {
  it('captures retryAfter', () => {
    const error = new RateLimitError({
      provider: 'paystack',
      message: 'Rate limited',
      retryAfter: 60,
    });
    expect(error.retryAfter).toBe(60);
    expect(error.statusCode).toBe(429);
  });
});

describe('TimeoutError', () => {
  it('creates timeout error with correct message', () => {
    const error = new TimeoutError('paystack', 30_000);
    expect(error.message).toBe('Request to paystack timed out after 30000ms');
    expect(error.code).toBe('TIMEOUT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────

describe('Type guards', () => {
  it('isNgPayError identifies NgPayError', () => {
    const error = new NgPayError({ provider: 'p', code: 'UNKNOWN', message: 'm' });
    expect(isNgPayError(error)).toBe(true);
    expect(isNgPayError(new Error('regular'))).toBe(false);
    expect(isNgPayError('string')).toBe(false);
    expect(isNgPayError(null)).toBe(false);
  });

  it('isRateLimitError identifies RateLimitError', () => {
    const rateLimitErr = new RateLimitError({ provider: 'p', message: 'm' });
    const regularErr = new NgPayError({ provider: 'p', code: 'UNKNOWN', message: 'm' });
    expect(isRateLimitError(rateLimitErr)).toBe(true);
    expect(isRateLimitError(regularErr)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HttpClient — secret scrubbing & non-enumerable auth
// ─────────────────────────────────────────────────────────────────────────────

import { HttpClient } from '../http/client.js';

describe('HttpClient security', () => {
  it('does not expose auth token via JSON.stringify', () => {
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      provider: 'test',
      auth: { type: 'bearer', token: 'sk_live_supersecret' },
    });

    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain('sk_live_supersecret');
    expect(serialized).not.toContain('bearer');
  });

  it('does not expose auth token via Object.keys', () => {
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      provider: 'test',
      auth: { type: 'bearer', token: 'sk_live_supersecret' },
    });

    const keys = Object.keys(client);
    expect(keys).not.toContain('_auth');
  });

  it('does not expose Basic credentials via JSON.stringify', () => {
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      provider: 'test',
      auth: { type: 'basic', username: 'MK_TEST_mykey', password: 'mysecret' },
    });

    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain('MK_TEST_mykey');
    expect(serialized).not.toContain('mysecret');
  });

  it('does not expose updated auth after setAuth', () => {
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      provider: 'test',
      auth: { type: 'none' },
    });

    client.setAuth({ type: 'bearer', token: 'new_live_token' });

    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain('new_live_token');
    const keys = Object.keys(client);
    expect(keys).not.toContain('_auth');
  });
});

describe('sanitizeForError (via network errors)', () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  it('network error raw field does not contain auth header value', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      provider: 'test',
      auth: { type: 'bearer', token: 'sk_live_supersecret' },
      maxRetries: 0,
    });

    try {
      await client.get('/test');
    } catch (err) {
      expect(err).toBeInstanceOf(NgPayError);
      const raw = JSON.stringify((err as NgPayError).raw);
      expect(raw).not.toContain('sk_live_supersecret');
      expect(raw).not.toContain('Authorization');
    }
  });
});
