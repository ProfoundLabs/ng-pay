# @ng-pay/router

Intelligent provider routing, failover, and circuit-breaking for the [ng-pay](https://github.com/ProfoundLabs/ng-pay) unified Nigerian fintech SDK.

## Installation

```bash
npm install @ng-pay/core @ng-pay/router
```

## Quick start

```typescript
import { ProviderRouter } from '@ng-pay/router';
import { PaystackProvider } from '@ng-pay/paystack';
import { FlutterwaveProvider } from '@ng-pay/flutterwave';

const router = new ProviderRouter(
  [
    new PaystackProvider({ secretKey: process.env.PAYSTACK_SECRET_KEY! }),
    new FlutterwaveProvider({ secretKey: process.env.FLW_SECRET_KEY! }),
  ],
  { strategy: 'priority' },
);

// Same API as any single NgPayProvider
const payment = await router.initializePayment({ ... });
```

## Configuration

```typescript
const router = new ProviderRouter(providers, {
  strategy: "priority", // 'priority' | 'round-robin' | 'fastest' | 'lowest-failure-rate'
  failureThreshold: 0.5, // failure rate (0–1) that trips the circuit open (default: 0.5)
  minRequestsToOpen: 3, // min requests before the circuit can trip (default: 3)
  circuitResetMs: 60_000, // ms before a tripped circuit allows a probe (default: 60_000)
  windowSize: 20, // sliding window size for metrics (default: 20)
  onFailover: (event) => {
    // called whenever a provider fails over
    console.warn("Failover", event);
  },
});
```

## Routing strategies

| Strategy              | Behaviour                                                               |
| --------------------- | ----------------------------------------------------------------------- |
| `priority`            | Try providers in declaration order; skip ones with open circuits        |
| `round-robin`         | Rotate the starting provider on each call for even load distribution    |
| `fastest`             | Prefer the provider with the lowest observed average latency            |
| `lowest-failure-rate` | Prefer the provider with the highest success rate in the current window |

## Circuit breaker

Each provider gets its own circuit breaker with three states:

- **closed** — normal operation; all requests pass through
- **open** — provider is considered unhealthy; requests are skipped
- **half-open** — one probe request is allowed after `circuitResetMs` to test recovery

## Health dashboard

```typescript
const stats = router.getStats();
// [
//   { provider: 'paystack', circuitState: 'closed', successRate: 0.98, avgLatencyMs: 120, totalRequests: 50 },
//   { provider: 'flutterwave', circuitState: 'open', successRate: 0.1, avgLatencyMs: 450, totalRequests: 10 },
// ]
```

## Exported types

```typescript
import type {
  RouterConfig,
  RoutingStrategy,
  ProviderStats,
  FailoverEvent,
  CircuitState,
} from "@ng-pay/router";
```
