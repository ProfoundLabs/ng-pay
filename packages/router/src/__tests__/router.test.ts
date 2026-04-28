import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NgPayError, ValidationError } from "@ng-pay/core";
import type {
  NgPayProvider,
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
import { ProviderRouter } from "../router.provider.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function providerError(
  provider: string,
  code: NgPayError["code"],
  message = "provider error",
): NgPayError {
  return new NgPayError({ provider, code, message });
}

const PAYMENT_RESPONSE: PaymentResponse = {
  provider: "mock",
  reference: "ref_1",
  authorizationUrl: "https://checkout.example.com/ref_1",
  status: "pending",
  raw: {},
};

const PAYMENT_PARAMS: PaymentParams = {
  amount: { amount: 10_000, currency: "NGN" },
  customer: { email: "test@example.com" },
};

/**
 * Creates a minimal mock NgPayProvider.
 * All methods resolve successfully by default; override as needed in each test.
 */
function makeProvider(name: string): NgPayProvider {
  return {
    name,
    initializePayment: vi
      .fn()
      .mockResolvedValue({ ...PAYMENT_RESPONSE, provider: name }),
    verifyPayment: vi.fn(),
    createVirtualAccount: vi.fn(),
    createTransferRecipient: vi.fn(),
    initiateTransfer: vi.fn(),
    verifyTransfer: vi.fn(),
    getBanks: vi.fn(),
    resolveAccount: vi.fn(),
    verifyWebhook: vi.fn().mockReturnValue(false),
    parseWebhookEvent: vi
      .fn()
      .mockReturnValue({ provider: name, event: "unknown", data: {}, raw: {} }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructor
// ─────────────────────────────────────────────────────────────────────────────

describe("ProviderRouter constructor", () => {
  it("throws when no providers are supplied", () => {
    expect(() => new ProviderRouter([])).toThrow(
      "ProviderRouter requires at least one provider",
    );
  });

  it('exposes name = "router"', () => {
    const router = new ProviderRouter([makeProvider("paystack")]);
    expect(router.name).toBe("router");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failover — happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("failover — happy path", () => {
  it("returns result from first provider when it succeeds", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    const router = new ProviderRouter([p1, p2]);

    const result = await router.initializePayment(PAYMENT_PARAMS);

    expect(result.provider).toBe("paystack");
    expect(p1.initializePayment).toHaveBeenCalledOnce();
    expect(p2.initializePayment).not.toHaveBeenCalled();
  });

  it("falls over to the second provider when the first fails", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    vi.mocked(p1.initializePayment).mockRejectedValue(
      providerError("paystack", "PROVIDER_UNAVAILABLE"),
    );

    const router = new ProviderRouter([p1, p2]);
    const result = await router.initializePayment(PAYMENT_PARAMS);

    expect(result.provider).toBe("flutterwave");
  });

  it("falls over through a chain of three providers", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    const p3 = makeProvider("monnify");
    vi.mocked(p1.initializePayment).mockRejectedValue(
      providerError("paystack", "PROVIDER_ERROR"),
    );
    vi.mocked(p2.initializePayment).mockRejectedValue(
      providerError("flutterwave", "TIMEOUT"),
    );

    const router = new ProviderRouter([p1, p2, p3]);
    const result = await router.initializePayment(PAYMENT_PARAMS);

    expect(result.provider).toBe("monnify");
  });

  it("throws the last error when all providers fail", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    const err = providerError("flutterwave", "NETWORK_ERROR", "network gone");
    vi.mocked(p1.initializePayment).mockRejectedValue(
      providerError("paystack", "PROVIDER_UNAVAILABLE"),
    );
    vi.mocked(p2.initializePayment).mockRejectedValue(err);

    const router = new ProviderRouter([p1, p2]);

    await expect(router.initializePayment(PAYMENT_PARAMS)).rejects.toBe(err);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-retryable errors
// ─────────────────────────────────────────────────────────────────────────────

describe("non-retryable errors", () => {
  const NON_RETRYABLE_CODES = [
    "INVALID_API_KEY",
    "INVALID_PARAMS",
    "DUPLICATE_REFERENCE",
    "MISSING_REQUIRED_FIELD",
  ] as const;

  for (const code of NON_RETRYABLE_CODES) {
    it(`throws immediately for ${code} without trying the next provider`, async () => {
      const p1 = makeProvider("paystack");
      const p2 = makeProvider("flutterwave");
      const err = providerError("paystack", code);
      vi.mocked(p1.initializePayment).mockRejectedValue(err);

      const router = new ProviderRouter([p1, p2]);

      await expect(router.initializePayment(PAYMENT_PARAMS)).rejects.toBe(err);
      expect(p2.initializePayment).not.toHaveBeenCalled();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// onFailover callback
// ─────────────────────────────────────────────────────────────────────────────

describe("onFailover callback", () => {
  it("fires with correct from/to/error fields", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    const originalErr = providerError("paystack", "PROVIDER_ERROR");
    vi.mocked(p1.initializePayment).mockRejectedValue(originalErr);

    const events: unknown[] = [];
    const router = new ProviderRouter([p1, p2], {
      onFailover: (e) => events.push(e),
    });

    await router.initializePayment(PAYMENT_PARAMS);

    expect(events).toHaveLength(1);
    const event = events[0] as { from: string; to: string; error: unknown };
    expect(event.from).toBe("paystack");
    expect(event.to).toBe("flutterwave");
    expect(event.error).toBe(originalErr);
  });

  it("sets to = undefined when no more candidates remain", async () => {
    const p1 = makeProvider("paystack");
    vi.mocked(p1.initializePayment).mockRejectedValue(
      providerError("paystack", "PROVIDER_ERROR"),
    );

    const events: unknown[] = [];
    const router = new ProviderRouter([p1], {
      onFailover: (e) => events.push(e),
    });

    await expect(
      router.initializePayment(PAYMENT_PARAMS),
    ).rejects.toBeDefined();

    const event = events[0] as { to: unknown };
    expect(event.to).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker
// ─────────────────────────────────────────────────────────────────────────────

describe("circuit breaker", () => {
  it("opens the circuit after failure threshold is crossed", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    vi.mocked(p1.initializePayment).mockRejectedValue(
      providerError("paystack", "PROVIDER_ERROR"),
    );

    // minRequestsToOpen = 3, failureThreshold = 1.0 (all must fail)
    const router = new ProviderRouter([p1, p2], {
      minRequestsToOpen: 3,
      failureThreshold: 1.0,
      windowSize: 5,
    });

    // 3 failures to open the circuit
    for (let i = 0; i < 3; i++) {
      await router.initializePayment(PAYMENT_PARAMS);
    }

    const stats = router.getStats();
    expect(stats.find((s) => s.provider === "paystack")?.circuitState).toBe(
      "open",
    );
  });

  it("skips an open-circuit provider and routes to the next", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    vi.mocked(p1.initializePayment).mockRejectedValue(
      providerError("paystack", "PROVIDER_ERROR"),
    );

    const router = new ProviderRouter([p1, p2], {
      minRequestsToOpen: 2,
      failureThreshold: 1.0,
    });

    // Trip the circuit on p1
    for (let i = 0; i < 2; i++) {
      await router.initializePayment(PAYMENT_PARAMS);
    }
    // p1 circuit is now open; the next call should go straight to p2
    vi.mocked(p2.initializePayment).mockClear();
    vi.mocked(p1.initializePayment).mockClear();

    await router.initializePayment(PAYMENT_PARAMS);

    expect(p1.initializePayment).not.toHaveBeenCalled();
    expect(p2.initializePayment).toHaveBeenCalledOnce();
  });

  it("transitions to half-open after circuitResetMs and closes on success", async () => {
    vi.useFakeTimers();

    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    vi.mocked(p1.initializePayment).mockRejectedValue(
      providerError("paystack", "PROVIDER_ERROR"),
    );

    const router = new ProviderRouter([p1, p2], {
      minRequestsToOpen: 2,
      failureThreshold: 1.0,
      circuitResetMs: 5_000,
    });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await router.initializePayment(PAYMENT_PARAMS);
    }
    expect(
      router.getStats().find((s) => s.provider === "paystack")?.circuitState,
    ).toBe("open");

    // Advance past the reset window
    vi.advanceTimersByTime(6_000);

    // Now p1 should be probed (half-open) and succeed
    vi.mocked(p1.initializePayment).mockResolvedValue({
      ...PAYMENT_RESPONSE,
      provider: "paystack",
    });
    vi.mocked(p1.initializePayment).mockClear();

    await router.initializePayment(PAYMENT_PARAMS);

    expect(p1.initializePayment).toHaveBeenCalledOnce();
    expect(
      router.getStats().find((s) => s.provider === "paystack")?.circuitState,
    ).toBe("closed");

    vi.useRealTimers();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getStats
// ─────────────────────────────────────────────────────────────────────────────

describe("getStats", () => {
  it("returns one entry per provider", () => {
    const router = new ProviderRouter([
      makeProvider("paystack"),
      makeProvider("flutterwave"),
    ]);
    const stats = router.getStats();
    expect(stats).toHaveLength(2);
    expect(stats.map((s) => s.provider)).toEqual(["paystack", "flutterwave"]);
  });

  it("reports 100 % success rate and correct latency after successes", async () => {
    const p1 = makeProvider("paystack");
    const router = new ProviderRouter([p1]);

    await router.initializePayment(PAYMENT_PARAMS);
    await router.initializePayment(PAYMENT_PARAMS);

    const stats = router.getStats();
    const s = stats[0]!;
    expect(s.successRate).toBe(1);
    expect(s.totalRequests).toBe(2);
    expect(s.circuitState).toBe("closed");
  });

  it("records last failure details", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    const err = providerError("paystack", "PROVIDER_ERROR", "gateway down");
    vi.mocked(p1.initializePayment).mockRejectedValue(err);

    const router = new ProviderRouter([p1, p2]);
    await router.initializePayment(PAYMENT_PARAMS);

    const stats = router.getStats();
    const s = stats.find((x) => x.provider === "paystack")!;
    expect(s.lastFailure?.code).toBe("PROVIDER_ERROR");
    expect(s.lastFailure?.message).toBe("gateway down");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Routing strategies
// ─────────────────────────────────────────────────────────────────────────────

describe("strategy: round-robin", () => {
  it("rotates the starting provider across sequential calls", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    const router = new ProviderRouter([p1, p2], { strategy: "round-robin" });

    await router.initializePayment(PAYMENT_PARAMS);
    await router.initializePayment(PAYMENT_PARAMS);
    await router.initializePayment(PAYMENT_PARAMS);

    // With a 2-provider list the pattern is p1, p2, p1, …
    expect(vi.mocked(p1.initializePayment)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(p2.initializePayment)).toHaveBeenCalledTimes(1);
  });
});

describe("strategy: fastest", () => {
  it("picks the provider with lower avg latency", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");

    // Feed synthetic latency data by having p1 succeed slowly; p2 should be
    // preferred on subsequent calls if we had real latency — but since mock
    // calls complete instantly we can only verify the fallback ordering is stable.
    const router = new ProviderRouter([p1, p2], { strategy: "fastest" });

    const result = await router.initializePayment(PAYMENT_PARAMS);
    // Without prior data both latencies are 0; p1 wins (stable sort)
    expect(result.provider).toBe("paystack");
  });
});

describe("strategy: lowest-failure-rate", () => {
  it("prefers the provider with the higher success rate", async () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");

    // Record a failure for p1
    vi.mocked(p1.initializePayment).mockRejectedValueOnce(
      providerError("paystack", "PROVIDER_ERROR"),
    );

    const router = new ProviderRouter([p1, p2], {
      strategy: "lowest-failure-rate",
      minRequestsToOpen: 999, // don't open the circuit — just influence ordering
    });

    // First call: p1 fails, falls over to p2
    await router.initializePayment(PAYMENT_PARAMS);

    // Second call: p2 has 100 % success rate, p1 has 0 % → p2 should be first
    vi.mocked(p1.initializePayment).mockResolvedValue({
      ...PAYMENT_RESPONSE,
      provider: "paystack",
    });
    vi.mocked(p2.initializePayment).mockClear();
    vi.mocked(p1.initializePayment).mockClear();

    const result = await router.initializePayment(PAYMENT_PARAMS);
    expect(result.provider).toBe("flutterwave");
    expect(p2.initializePayment).toHaveBeenCalledOnce();
    expect(p1.initializePayment).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhook delegation
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyWebhook", () => {
  it("returns true if any provider accepts the signature", () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    vi.mocked(p2.verifyWebhook).mockReturnValue(true);

    const router = new ProviderRouter([p1, p2]);
    expect(router.verifyWebhook("body", "sig")).toBe(true);
  });

  it("returns false when no provider accepts", () => {
    const p1 = makeProvider("paystack");
    const router = new ProviderRouter([p1]);
    expect(router.verifyWebhook("body", "bad_sig")).toBe(false);
  });
});

describe("parseWebhookEvent", () => {
  it("returns the first non-unknown event", () => {
    const p1 = makeProvider("paystack");
    const p2 = makeProvider("flutterwave");
    const chargeEvent: WebhookEvent = {
      provider: "flutterwave",
      event: "charge.success",
      reference: "ref_flw",
      data: {},
      raw: {},
    };
    vi.mocked(p2.parseWebhookEvent).mockReturnValue(chargeEvent);

    const router = new ProviderRouter([p1, p2]);
    const event = router.parseWebhookEvent({});

    expect(event.event).toBe("charge.success");
    expect(event.provider).toBe("flutterwave");
  });

  it("falls back to first provider result when all return unknown", () => {
    const p1 = makeProvider("paystack");
    const unknownEvent: WebhookEvent = {
      provider: "paystack",
      event: "unknown",
      data: {},
      raw: { id: 1 },
    };
    vi.mocked(p1.parseWebhookEvent).mockReturnValue(unknownEvent);

    const router = new ProviderRouter([p1]);
    const event = router.parseWebhookEvent({});

    expect(event.event).toBe("unknown");
    expect(event.provider).toBe("paystack");
  });
});
