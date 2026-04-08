import { NgPayError, RateLimitError, TimeoutError } from '../errors/index.js';

export type AuthStrategy =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'custom'; header: string; value: string }
  | { type: 'none' };

export interface HttpClientConfig {
  baseUrl: string;
  provider: string;
  auth: AuthStrategy;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export interface HttpResponse<T = unknown> {
  data: T;
  statusCode: number;
  headers: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry logic
// ─────────────────────────────────────────────────────────────────────────────

const RETRYABLE_CODES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exponential + jitter, 30_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret scrubbing
// Auth headers (Bearer tokens, Basic credentials) must NEVER appear in error
// context — they would be captured by Sentry, Datadog, CloudWatch, etc.
// ─────────────────────────────────────────────────────────────────────────────

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-secret-key',
  'cookie',
  'set-cookie',
]);

/**
 * Sanitizes an error before storing it in NgPayError.raw.
 * Strips auth headers from any Error-like objects so secrets
 * cannot leak into logging/monitoring systems.
 */
function sanitizeForError(err: unknown): unknown {
  if (err instanceof Error) {
    // Only keep the safe, non-secret parts of the error
    return { message: err.message, name: err.name, code: (err as NodeJS.ErrnoException).code };
  }
  if (typeof err === 'object' && err !== null) {
    return scrubObject(err as Record<string, unknown>);
  }
  return err;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = scrubObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Client
// ─────────────────────────────────────────────────────────────────────────────

export class HttpClient {
  private readonly config: Required<HttpClientConfig>;
  // Non-enumerable so the token never appears in console.log,
  // JSON.stringify, Object.keys, or stack traces
  private declare _auth: AuthStrategy;

  constructor(config: HttpClientConfig) {
    const { auth, ...safeConfig } = config;
  
    // Strip undefined values so they don't clobber defaults
    const definedConfig = Object.fromEntries(
      Object.entries(safeConfig).filter(([, v]) => v !== undefined)
    );
  
    this.config = {
      timeoutMs: 30_000,
      maxRetries: 3,
      retryDelayMs: 1_000,
      headers: {},
      ...definedConfig,
    } as Required<HttpClientConfig>;

    Object.defineProperty(this, '_auth', {
      value: auth,
      writable: true,
      enumerable: false,   // hidden from JSON.stringify and Object.keys
      configurable: false,
    });
  }

  /** Replace auth mid-session (e.g. after Monnify OAuth token exchange) */
  setAuth(auth: AuthStrategy): void {
    Object.defineProperty(this, '_auth', {
      value: auth,
      writable: true,
      enumerable: false,
      configurable: false,
    });
  }

  async request<T = unknown>(options: RequestOptions): Promise<HttpResponse<T>> {
    const url = this.buildUrl(options.path, options.query);
    const headers = this.buildHeaders(options.headers);

    let lastError: NgPayError | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = getBackoffDelay(attempt - 1, this.config.retryDelayMs);
        await sleep(delay);
      }

      try {
        const response = await this.fetchWithTimeout(url, {
          method: options.method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

        const responseHeaders = this.extractHeaders(response.headers);

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('retry-after') ?? '60', 10);
          throw new RateLimitError({
            provider: this.config.provider,
            message: `Rate limited by ${this.config.provider}. Retry after ${retryAfter}s`,
            statusCode: 429,
            retryAfter,
          });
        }

        let data: T;
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          data = await response.json() as T;
        } else {
          const text = await response.text();
          data = text as unknown as T;
        }

        if (!response.ok) {
          const error = new NgPayError({
            provider: this.config.provider,
            code: this.codeFromStatus(response.status),
            message: `HTTP ${response.status} from ${this.config.provider}`,
            statusCode: response.status,
            // Response body is safe to expose — it's from the provider, not us.
            // It should never contain our own credentials.
            raw: data,
          });

          if (RETRYABLE_CODES.has(response.status) && response.status !== 429 && attempt < this.config.maxRetries) {
            lastError = error;
            continue;
          }

          throw error;
        }

        return { data, statusCode: response.status, headers: responseHeaders };

      } catch (err) {
        if (err instanceof NgPayError) {
          if (err instanceof RateLimitError) throw err;
          lastError = err;
          if (attempt < this.config.maxRetries) continue;
          throw err;
        }

        if (err instanceof Error) {
          const networkError = new NgPayError({
            provider: this.config.provider,
            code: 'NETWORK_ERROR',
            message: `Network error reaching ${this.config.provider}: ${err.message}`,
            // Sanitize — the native Error object can reference the request
            // context which may include Authorization headers
            raw: sanitizeForError(err),
          });
          lastError = networkError;
          if (attempt < this.config.maxRetries) continue;
          throw networkError;
        }

        throw err;
      }
    }

    throw lastError ?? new NgPayError({
      provider: this.config.provider,
      code: 'UNKNOWN',
      message: 'Unknown error',
    });
  }

  async get<T>(path: string, query?: RequestOptions['query']): Promise<HttpResponse<T>> {
    return this.request<T>({ method: 'GET', path, query });
  }

  async post<T>(path: string, body?: unknown): Promise<HttpResponse<T>> {
    return this.request<T>({ method: 'POST', path, body });
  }

  async put<T>(path: string, body?: unknown): Promise<HttpResponse<T>> {
    return this.request<T>({ method: 'PUT', path, body });
  }

  async delete<T>(path: string): Promise<HttpResponse<T>> {
    return this.request<T>({ method: 'DELETE', path });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TimeoutError(this.config.provider, this.config.timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${base}${cleanPath}`;
    if (!query) return url;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const queryString = params.toString();
    return queryString ? `${url}?${queryString}` : url;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const authHeader = this.resolveAuthHeader();
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'ng-pay-sdk/0.1.0 (https://github.com/ng-pay/sdk)',
      ...authHeader,
      ...this.config.headers,
      ...extra,
    };
  }

  private resolveAuthHeader(): Record<string, string> {
    const auth = this._auth;
    switch (auth.type) {
      case 'bearer':
        return { Authorization: `Bearer ${auth.token}` };
      case 'basic': {
        const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
      }
      case 'custom':
        return { [auth.header]: auth.value };
      case 'none':
        return {};
    }
  }

  private extractHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => { result[key] = value; });
    return result;
  }

  private codeFromStatus(status: number): NgPayError['code'] {
    if (status === 401 || status === 403) return 'UNAUTHORIZED';
    if (status === 400) return 'INVALID_PARAMS';
    if (status === 404) return 'PAYMENT_NOT_FOUND';
    if (status === 422) return 'INVALID_PARAMS';
    if (status === 429) return 'RATE_LIMITED';
    if (status >= 500) return 'PROVIDER_ERROR';
    return 'UNKNOWN';
  }
}
