# State machines and invariants

## Payment aggregate

```
CREATED ──pay──► IN_PROGRESS ──success──► SUCCEEDED (terminal)
                    │
                    ├──fail (retryable)──► CREATED (attemptCount++)
                    └──fail (final)──────► FAILED (terminal)
```

**Invariants**

1. At most **one** Payment per `orderId` (unique index).
2. `amount` is copied from OrderCreated once; Pay Now **re-validates** against `orders.getOrderForPayment` and rejects mismatches.
3. `SUCCEEDED` and `FAILED` are terminal — no new attempts.
4. Only `CREATED` or retryable failed state may start a new attempt (implemented via conditional `findOneAndUpdate` on Payment).

## PaymentAttempt

```
INITIATED ──► PROCESSING ──► SUCCEEDED | FAILED | TIMEOUT | UNKNOWN
```

- A **retry** always inserts a **new** document with `attemptNumber = previous + 1`. Previous rows are immutable history.
- `clientIdempotencyKey` duplicates return the same attempt (API idempotency for double-click).
- `gatewayTransactionId` is assigned when the mock gateway accepts the charge (unique sparse index prevents double-settlement).

## Mock gateway outcomes

| Simulated outcome | Attempt terminal status | Payment next step |
|-------------------|-------------------------|-------------------|
| SUCCESS | SUCCEEDED | Payment → SUCCEEDED, emit PaymentSucceeded |
| FAILED | FAILED | Retry if under `PAYMENT_MAX_ATTEMPTS`, else Payment → FAILED |
| TIMEOUT | TIMEOUT | Reconcile or manual retry |
| UNKNOWN | UNKNOWN | Reconcile against ledger |
| DELAYED_RESPONSE | (same as configured base outcome, after delay) | Tests slow paths |

Header/body `simulateOutcome` is **test-only**; production path uses env `MOCK_GATEWAY_DEFAULT_OUTCOME` or random weighted draws in tests.

## Concurrency

| Scenario | Mechanism |
|----------|-----------|
| Two Pay Now clicks, same key | Unique `{ paymentId, clientIdempotencyKey }` → replay same attempt |
| Two Pay Now, different keys | Second conditional update fails if Payment already `IN_PROGRESS` |
| Two SUCCESS from gateway | First finalize wins `findOneAndUpdate` on Payment `status: IN_PROGRESS`; second sees `SUCCEEDED` and replays |
| Duplicate outbox delivery | Orders handler uses conditional transition + idempotent replay if already `CONFIRMED` |