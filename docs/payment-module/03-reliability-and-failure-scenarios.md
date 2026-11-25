# Reliability and failure scenarios

## 1. Double Pay Now (same idempotency key)

**Technique:** client idempotency key stored on `PaymentAttempt`; unique compound index with `paymentId`.

**Behavior:** Second request returns the first attempt DTO with `replayed: true` and does not call the gateway again.

## 2. Failed attempt, customer retries

**Technique:** new `PaymentAttempt` row; Payment returns to `CREATED` when failure is retryable and `attemptCount < PAYMENT_MAX_ATTEMPTS`.

**Behavior:** Failed attempts remain in the DB for audit; charge is not duplicated on the same `gatewayTransactionId`.

## 3. Gateway SUCCESS, API crash before persist

**Technique:** mock gateway ledger row reaches `SUCCESS` before the HTTP handler returns; `gatewayTransactionId` is persisted on the attempt immediately after the gateway call; attempt stuck in `PROCESSING`.

**Behavior:**

- `POST /payments/webhooks/mock` (with `MOCK_WEBHOOK_SECRET`) — async confirmation from the PSP.
- `reconcilePaymentAttempt` or the **reconciliation worker** loads ledger by `gatewayTransactionId` or `paymentAttemptId`, then runs the same `finalizeSuccess` path idempotently.
- Test/dev: `simulateOutcome: "CRASH_AFTER_SUCCESS"` on Pay Now skips finalize after a successful gateway call.

## 4. Customer tampers with amount

**Technique:** Pay Now ignores body amount; loads `totalAmount` from Orders public API and compares to Payment.amount.

**Behavior:** `409 PAYMENT_AMOUNT_MISMATCH` if OrderCreated snapshot diverges from current order (should not happen in normal flow).

## 5. Concurrent successful attempts

**Technique:** conditional updates on Payment (`status: IN_PROGRESS` → `SUCCEEDED`); duplicate finalize catches `11000` on outbox unique index and replays.

**Behavior:** At most one `PaymentSucceeded` outbox row per payment.

## 6. Payment succeeds, order confirmation fails

**Technique:** transactional outbox in `payments_db`; worker retries with exponential backoff (same as Orders worker).

**Behavior:** Orders consumer is idempotent — confirming an already-`CONFIRMED` order is a replay.

## Correlation and logging

All payment service paths log `orderId`, `paymentId`, `attemptNumber`, and `gatewayTransactionId` when known, via the shared correlation ID middleware.