import { isNgPayError } from "@ng-pay/core";
import type {
  NgPayProvider,
  NgPayErrorCode,
  PaymentParams,
  PaymentResponse,
  VerificationResponse,
  VirtualAccountParams,
  VirtualAccount,
  TransferRecipientParams,
  TransferRecipient,
  TransferParams,
  TransferResponse,
  Bank,
  AccountDetails,
  WebhookEvent,
} from "@ng-pay/core";
import type {
  RouterConfig,
  RoutingStrategy,
  ProviderStats,
  FailoverEvent,
} from "./types/router.types.js";
import { ProviderRegistry } from "./registry.js";

// ─────────────────────────────────────────────────────────────────────────────
// Non-retryable error codes
//
// These indicate a bad call (invalid params, duplicate reference, etc.) — not
// a provider outage. Retrying on another provider would just fail again with
// the same logical error, so we throw immediately.
// ─────────────────────────────────────────────────────────────────────────────

const NON_RETRYABLE = new Set<NgPayErrorCode>([
  "INVALID_API_KEY",
  "UNAUTHORIZED",
  "INVALID_PARAMS",
  "MISSING_REQUIRED_FIELD",
  "INVALID_AMOUNT",
  "INVALID_REFERENCE",
  "DUPLICATE_REFERENCE",
  "PAYMENT_ALREADY_VERIFIED",
  "RECIPIENT_NOT_FOUND",
  "INVALID_WEBHOOK_SIGNATURE",
]);

// ─────────────────────────────────────────────────────────────────────────────
// ProviderRouter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A drop-in `NgPayProvider` implementation that wraps multiple providers with
 * automatic failover, a per-provider circuit breaker, and configurable routing
 * strategies.
 *
 * ```ts
 * const router = new ProviderRouter(
 *   [new PaystackProvider({ secretKey: '...' }), new FlutterwaveProvider({ secretKey: '...' })],
 *   { strategy: 'priority', onFailover: (e) => logger.warn('failover', e) },
 * );
 *
 * // Same API as any single provider
 * const payment = await router.initializePayment({ ... });
 * const stats   = router.getStats(); // uptime, latency, success rate per provider
 * ```
 */
export class ProviderRouter implements NgPayProvider {
  public readonly name = "router";

  private readonly providers: NgPayProvider[];
  private readonly strategy: RoutingStrategy;
  private readonly onFailover: ((e: FailoverEvent) => void) | undefined;
  private readonly registry: ProviderRegistry;
  /** Monotonically-increasing counter used by the round-robin strategy. */
  private rrIndex = 0;

  constructor(providers: NgPayProvider[], config: RouterConfig = {}) {
    if (providers.length === 0) {
      throw new Error("ProviderRouter requires at least one provider");
    }
    this.providers = providers;
    this.strategy = config.strategy ?? "priority";
    this.onFailover = config.onFailover;
    this.registry = new ProviderRegistry(config);
  }

  // ─── Health dashboard ──────────────────────────────────────────────────────

  /**
   * Returns a health snapshot for every registered provider:
   * circuit state, success rate, average latency, and last failure.
   *
   * Suitable for feeding a monitoring dashboard or alerting system.
   */
  getStats(): ProviderStats[] {
    return this.registry.getStats(this.providers.map((p) => p.name));
  }

  // ─── Core failover engine ──────────────────────────────────────────────────

  /**
   * Executes `op` against each candidate provider in strategy order.
   *
   * Failover rules:
   * - Non-retryable errors (bad params, duplicate reference, etc.) throw immediately.
   * - Retryable errors (provider down, timeout, rate-limit) → record failure,
   *   fire `onFailover`, try the next candidate.
   * - If every candidate fails, re-throws the last error.
   */
  private async _withFailover<T>(
    op: (provider: NgPayProvider) => Promise<T>,
  ): Promise<T> {
    const candidates = this._selectCandidates();
    let lastError: unknown;

    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i]!;
      const start = Date.now();
      try {
        const result = await op(provider);
        this.registry.recordSuccess(provider.name, Date.now() - start);
        return result;
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;

        // Non-retryable: the call itself is bad — fail immediately
        if (isNgPayError(err) && NON_RETRYABLE.has(err.code)) {
          throw err;
        }

        const code: NgPayErrorCode = isNgPayError(err) ? err.code : "UNKNOWN";
        const message = err instanceof Error ? err.message : String(err);
        this.registry.recordFailure(provider.name, latencyMs, code, message);
        lastError = err;

        const next = candidates[i + 1];
        this.onFailover?.({
          from: provider.name,
          to: next?.name,
          error: err,
          at: new Date().toISOString(),
        });
      }
    }

    throw lastError;
  }

  /**
   * Builds an ordered list of candidate providers for the current request
   * according to the active routing strategy.
   *
   * Circuit-open providers are filtered out. If ALL providers have open
   * circuits we still return the full list so callers can observe the errors
   * rather than silently receiving zero candidates.
   */
  private _selectCandidates(): NgPayProvider[] {
    const available = (): NgPayProvider[] =>
      this.providers.filter((p) => this.registry.isAvailable(p.name));

    switch (this.strategy) {
      case "priority": {
        const avail = available();
        return avail.length > 0 ? avail : [...this.providers];
      }

      case "round-robin": {
        const n = this.providers.length;
        const start = this.rrIndex % n;
        this.rrIndex++;
        const rotated = [
          ...this.providers.slice(start),
          ...this.providers.slice(0, start),
        ];
        const avail = rotated.filter((p) => this.registry.isAvailable(p.name));
        return avail.length > 0 ? avail : rotated;
      }

      case "fastest": {
        const avail = available();
        const pool = avail.length > 0 ? avail : [...this.providers];
        return pool.sort(
          (a, b) =>
            this.registry.rank(a.name).latency -
            this.registry.rank(b.name).latency,
        );
      }

      case "lowest-failure-rate": {
        const avail = available();
        const pool = avail.length > 0 ? avail : [...this.providers];
        return pool.sort(
          (a, b) =>
            this.registry.rank(b.name).successRate -
            this.registry.rank(a.name).successRate,
        );
      }
    }
  }

  // ─── NgPayProvider delegate methods ───────────────────────────────────────

  initializePayment(params: PaymentParams): Promise<PaymentResponse> {
    return this._withFailover((p) => p.initializePayment(params));
  }

  verifyPayment(reference: string): Promise<VerificationResponse> {
    return this._withFailover((p) => p.verifyPayment(reference));
  }

  createVirtualAccount(params: VirtualAccountParams): Promise<VirtualAccount> {
    return this._withFailover((p) => p.createVirtualAccount(params));
  }

  createTransferRecipient(
    params: TransferRecipientParams,
  ): Promise<TransferRecipient> {
    return this._withFailover((p) => p.createTransferRecipient(params));
  }

  initiateTransfer(params: TransferParams): Promise<TransferResponse> {
    return this._withFailover((p) => p.initiateTransfer(params));
  }

  verifyTransfer(reference: string): Promise<TransferResponse> {
    return this._withFailover((p) => p.verifyTransfer(reference));
  }

  getBanks(country?: string): Promise<Bank[]> {
    return this._withFailover((p) => p.getBanks(country));
  }

  resolveAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<AccountDetails> {
    return this._withFailover((p) => p.resolveAccount(accountNumber, bankCode));
  }

  /**
   * Webhook verification is provider-specific: the request arrives from a
   * known provider's servers. Try each provider; return `true` if any accepts
   * the signature (exactly as a switch statement on the inbound X-Provider
   * header would, but without requiring the caller to know which provider sent it).
   */
  verifyWebhook(payload: unknown, signature: string): boolean {
    return this.providers.some((p) => {
      try {
        return p.verifyWebhook(payload, signature);
      } catch {
        return false;
      }
    });
  }

  /**
   * Parses the webhook payload by trying each provider.
   * Returns the first non-`unknown` event type found; falls back to the first
   * provider's parse result if none produce a recognised event type.
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    for (const p of this.providers) {
      try {
        const event = p.parseWebhookEvent(payload);
        if (event.event !== "unknown") return event;
      } catch {
        // try next
      }
    }
    // All returned 'unknown' — return first provider's result
    return this.providers[0]!.parseWebhookEvent(payload);
  }
}
