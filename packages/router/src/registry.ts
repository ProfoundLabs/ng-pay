import type { NgPayErrorCode } from "@ng-pay/core";
import type {
  CircuitState,
  ProviderStats,
  RouterConfig,
} from "./types/router.types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────────────────────────────────────────

interface Sample {
  success: boolean;
  latencyMs: number;
}

interface ProviderState {
  /** Sliding window of up to `windowSize` recent samples. */
  samples: Sample[];
  circuitState: CircuitState;
  circuitOpenedAt?: number;
  /**
   * Whether a half-open probe request is already in flight.
   * Only one concurrent probe is allowed so the circuit doesn't get hammered.
   */
  halfOpenInFlight: boolean;
  lastFailure?: {
    code: NgPayErrorCode;
    message: string;
    at: Date;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ProviderRegistry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks per-provider health metrics and applies the circuit-breaker pattern.
 *
 * Circuit states:
 *  closed    → normal operation
 *  open      → provider is considered unhealthy; requests are blocked
 *  half-open → one probe request is allowed to test recovery
 */
export class ProviderRegistry {
  private readonly states = new Map<string, ProviderState>();

  private readonly failureThreshold: number;
  private readonly minRequestsToOpen: number;
  private readonly circuitResetMs: number;
  private readonly windowSize: number;

  constructor(config: RouterConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 0.5;
    this.minRequestsToOpen = config.minRequestsToOpen ?? 3;
    this.circuitResetMs = config.circuitResetMs ?? 60_000;
    this.windowSize = config.windowSize ?? 20;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private state(provider: string): ProviderState {
    let s = this.states.get(provider);
    if (!s) {
      s = { samples: [], circuitState: "closed", halfOpenInFlight: false };
      this.states.set(provider, s);
    }
    return s;
  }

  /** Transition an open circuit to half-open if the reset window has elapsed. */
  private maybeTransitionToHalfOpen(s: ProviderState): void {
    if (
      s.circuitState === "open" &&
      Date.now() - (s.circuitOpenedAt ?? 0) >= this.circuitResetMs
    ) {
      s.circuitState = "half-open";
      s.halfOpenInFlight = false;
    }
  }

  /** Push a sample into the sliding window, discarding oldest if full. */
  private pushSample(s: ProviderState, sample: Sample): void {
    s.samples.push(sample);
    if (s.samples.length > this.windowSize) {
      s.samples.shift();
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns `true` if a new request should be allowed to this provider.
   * Also handles the open → half-open transition.
   */
  isAvailable(provider: string): boolean {
    const s = this.state(provider);

    if (s.circuitState === "closed") return true;

    this.maybeTransitionToHalfOpen(s);

    if (s.circuitState === "open") return false;

    // half-open: permit only one concurrent probe
    if (s.halfOpenInFlight) return false;
    s.halfOpenInFlight = true;
    return true;
  }

  /** Record a successful request and its latency. */
  recordSuccess(provider: string, latencyMs: number): void {
    const s = this.state(provider);
    this.pushSample(s, { success: true, latencyMs });

    if (s.circuitState === "half-open") {
      // Probe succeeded — close the circuit
      s.circuitState = "closed";
      s.halfOpenInFlight = false;
    }
  }

  /** Record a failed request and apply circuit-breaker logic. */
  recordFailure(
    provider: string,
    latencyMs: number,
    code: NgPayErrorCode,
    message: string,
  ): void {
    const s = this.state(provider);
    this.pushSample(s, { success: false, latencyMs });
    s.lastFailure = { code, message, at: new Date() };

    if (s.circuitState === "half-open") {
      // Probe failed — reopen immediately
      s.circuitState = "open";
      s.circuitOpenedAt = Date.now();
      s.halfOpenInFlight = false;
      return;
    }

    if (s.circuitState === "closed") {
      const n = s.samples.length;
      if (n >= this.minRequestsToOpen) {
        const failures = s.samples.filter((x) => !x.success).length;
        if (failures / n >= this.failureThreshold) {
          s.circuitState = "open";
          s.circuitOpenedAt = Date.now();
        }
      }
    }
  }

  /**
   * Returns the average latency and success rate for a provider,
   * used by ranking strategies.
   */
  rank(provider: string): { latency: number; successRate: number } {
    const s = this.state(provider);
    const n = s.samples.length;
    if (n === 0) return { latency: 0, successRate: 1 };
    const latency = s.samples.reduce((acc, x) => acc + x.latencyMs, 0) / n;
    const successRate = s.samples.filter((x) => x.success).length / n;
    return { latency, successRate };
  }

  /** Snapshot stats for a list of providers. */
  getStats(providers: string[]): ProviderStats[] {
    return providers.map((name) => {
      const s = this.state(name);
      // Refresh circuit state so callers see up-to-date half-open transitions
      this.maybeTransitionToHalfOpen(s);

      const n = s.samples.length;
      const successes = s.samples.filter((x) => x.success).length;
      return {
        provider: name,
        circuitState: s.circuitState,
        totalRequests: n,
        successRate: n === 0 ? 1 : successes / n,
        avgLatencyMs:
          n === 0 ? 0 : s.samples.reduce((acc, x) => acc + x.latencyMs, 0) / n,
        lastFailure: s.lastFailure,
      };
    });
  }
}
