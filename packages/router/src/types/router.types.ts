import type { NgPayErrorCode } from "@ng-pay/core";

// ─────────────────────────────────────────────────────────────────────────────
// Public types for @ng-pay/router
// ─────────────────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

/**
 * How the router selects which provider to use for each request.
 *
 * - `priority`           Try providers in the order they were passed to the constructor.
 *                        Skip any whose circuit is open. Fall back to the next in order.
 * - `round-robin`        Rotate the starting provider on each request so load spreads
 *                        evenly. Falls over to subsequent providers if the chosen one fails.
 * - `fastest`            Prefer the provider with the lowest average latency observed in
 *                        the current window. Falls over on failure.
 * - `lowest-failure-rate` Prefer the provider with the highest success rate in the current
 *                        window. Falls over on failure.
 */
export type RoutingStrategy =
  | "priority"
  | "round-robin"
  | "fastest"
  | "lowest-failure-rate";

export interface RouterConfig {
  /**
   * How to order candidates on each call.
   * @default 'priority'
   */
  strategy?: RoutingStrategy;

  /**
   * Failure rate (0–1) above which the circuit opens for a provider.
   * Applied over the observation window once `minRequestsToOpen` is met.
   * @default 0.5
   */
  failureThreshold?: number;

  /**
   * Minimum number of requests in the observation window before the
   * circuit can trip open.
   * @default 3
   */
  minRequestsToOpen?: number;

  /**
   * How long (ms) to keep the circuit open before allowing a probe request.
   * @default 60_000
   */
  circuitResetMs?: number;

  /**
   * Size of the sliding window (number of recent requests) used for
   * success-rate and latency calculations.
   * @default 20
   */
  windowSize?: number;

  /**
   * Called whenever a provider fails and the router falls over to the next one.
   */
  onFailover?: (event: FailoverEvent) => void;
}

/** Per-provider health snapshot returned by `router.getStats()`. */
export interface ProviderStats {
  provider: string;
  /** Current circuit breaker state. */
  circuitState: CircuitState;
  /** Number of requests in the current observation window. */
  totalRequests: number;
  /** Success rate in the current window (0–1). 1 if no data yet. */
  successRate: number;
  /** Average latency in ms for requests in the current window. 0 if no data. */
  avgLatencyMs: number;
  /** Details of the most recent failure, if any. */
  lastFailure?: {
    code: NgPayErrorCode;
    message: string;
    at: Date;
  };
}

/** Emitted when the router fails over from one provider to another. */
export interface FailoverEvent {
  /** Name of the provider that failed. */
  from: string;
  /** Name of the provider that will be tried next. `undefined` if no more candidates. */
  to: string | undefined;
  /** The error that triggered the failover. */
  error: unknown;
  /** ISO-8601 timestamp. */
  at: string;
}
