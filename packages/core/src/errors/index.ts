// ─────────────────────────────────────────────────────────────────────────────
// NgPay Error Hierarchy
// Every provider's raw error gets normalized into one of these.
// ─────────────────────────────────────────────────────────────────────────────

export type NgPayErrorCode =
  // Authentication
  | 'INVALID_API_KEY'
  | 'UNAUTHORIZED'
  // Request
  | 'INVALID_PARAMS'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_AMOUNT'
  | 'INVALID_REFERENCE'
  | 'DUPLICATE_REFERENCE'
  // Business logic
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_ALREADY_VERIFIED'
  | 'INSUFFICIENT_BALANCE'
  | 'ACCOUNT_NOT_FOUND'
  | 'BANK_NOT_FOUND'
  | 'RECIPIENT_NOT_FOUND'
  | 'TRANSFER_LIMIT_EXCEEDED'
  // Webhook
  | 'INVALID_WEBHOOK_SIGNATURE'
  // Provider / network
  | 'PROVIDER_ERROR'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  // Unknown
  | 'UNKNOWN';

export class NgPayError extends Error {
  public readonly provider: string;
  public readonly code: NgPayErrorCode;
  public readonly statusCode?: number;   // HTTP status if applicable
  public readonly raw: unknown;          // Original provider error — always keep this

  constructor(options: {
    provider: string;
    code: NgPayErrorCode;
    message: string;
    statusCode?: number;
    raw?: unknown;
  }) {
    super(options.message);
    this.name = 'NgPayError';
    this.provider = options.provider;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.raw = options.raw;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      provider: this.provider,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}

// Specific subtypes — makes error handling cleaner for consumers

export class AuthenticationError extends NgPayError {
  constructor(options: Omit<ConstructorParameters<typeof NgPayError>[0], 'code'>) {
    super({ ...options, code: 'INVALID_API_KEY' });
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends NgPayError {
  public readonly field?: string;

  constructor(options: Omit<ConstructorParameters<typeof NgPayError>[0], 'code'> & { field?: string }) {
    super({ ...options, code: 'INVALID_PARAMS' });
    this.name = 'ValidationError';
    this.field = options.field;
  }
}

export class ProviderError extends NgPayError {
  constructor(options: Omit<ConstructorParameters<typeof NgPayError>[0], 'code'>) {
    super({ ...options, code: 'PROVIDER_ERROR' });
    this.name = 'ProviderError';
  }
}

export class WebhookSignatureError extends NgPayError {
  constructor(provider: string) {
    super({
      provider,
      code: 'INVALID_WEBHOOK_SIGNATURE',
      message: `Invalid webhook signature from ${provider}`,
    });
    this.name = 'WebhookSignatureError';
  }
}

export class RateLimitError extends NgPayError {
  public readonly retryAfter?: number; // seconds

  constructor(options: Omit<ConstructorParameters<typeof NgPayError>[0], 'code'> & { retryAfter?: number }) {
    super({ ...options, code: 'RATE_LIMITED', statusCode: 429 });
    this.name = 'RateLimitError';
    this.retryAfter = options.retryAfter;
  }
}

export class TimeoutError extends NgPayError {
  constructor(provider: string, timeoutMs: number) {
    super({
      provider,
      code: 'TIMEOUT',
      message: `Request to ${provider} timed out after ${timeoutMs}ms`,
    });
    this.name = 'TimeoutError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Type guard helpers
// ─────────────────────────────────────────────────────────────────────────────

export function isNgPayError(error: unknown): error is NgPayError {
  return error instanceof NgPayError;
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

export function isAuthError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}
