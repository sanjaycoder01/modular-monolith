# Techniques glossary

| Term | How we use it here |
|------|---------------------|
| **Modular monolith** | Payments owns its collections; cross-module calls go through `index.js` only (ESLint enforced). |
| **Transactional outbox** | Payment result and `PaymentSucceeded`/`PaymentFailed` event commit together in `payments_db`. |
| **Idempotency key** | HTTP `Idempotency-Key` on Pay Now; Order placement already uses `userId + idempotencyKey`. |
| **Conditional update** | `findOneAndUpdate` filters include current `status` to prevent lost updates under concurrency. |
| **MongoDB multi-document transaction** | Used inside a single module DB when attempt + payment + outbox must commit atomically. |
| **Duplicate key (11000) replay** | After concurrent insert, load the winner row and return it with `replayed: true`. |
| **Paise integer money** | All amounts are safe integers; no floats. |
| **Snapshot amount** | Payment.amount set at OrderCreated; validated again at Pay Now against Orders API. |
| **Reconciliation** | Read mock gateway ledger to finish attempts left in UNKNOWN/TIMEOUT/PROCESSING. |
| **State machine** | Explicit allowed transitions; invalid jumps throw typed errors mapped to HTTP status. |