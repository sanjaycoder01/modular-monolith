# Payment module (online payments)

This folder documents how the Payment module is designed and which reliability techniques it reuses from the rest of the monolith.

| Doc | Contents |
|-----|----------|
| [01-architecture-and-integration.md](./01-architecture-and-integration.md) | Module boundaries, schemas, indexes, outbox flows |
| [02-state-machines-and-invariants.md](./02-state-machines-and-invariants.md) | Payment / PaymentAttempt transitions, concurrency rules |
| [03-reliability-and-failure-scenarios.md](./03-reliability-and-failure-scenarios.md) | Idempotency, retries, UNKNOWN, reconciliation |
| [04-techniques-glossary.md](./04-techniques-glossary.md) | Short definitions (outbox, conditional updates, etc.) |

Implementation follows the same conventions as Orders: one MongoDB database per module, public APIs only via `index.js`, amounts in **integer paise**, correlation IDs in logs.