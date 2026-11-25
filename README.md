# modular-monolith

Small e-commerce app for learning **modular monolith** architecture with MongoDB.

## Core rules

1. Each collection is owned by exactly one module — only that module reads/writes it.
2. Separate databases per module, each with its own connection.
3. Modules reference each other by **ID only** — no `populate` or `$lookup` across modules.
4. Cross-module data comes from public APIs or event payloads.
5. Orders/shipments store **snapshots** so old records stay stable if product price or address changes later.
6. Module internals live under `internal/` (schemas, later services/repos) — other modules import only the module's public `index.js`.
7. ESLint enforces that: `npm run lint` fails if any module `require`s another module's `internal/`.

## Databases & collections

| Module     | Database       | Collection  | Key indexes                                      |
|------------|----------------|-------------|--------------------------------------------------|
| Users      | `users_db`     | `users`     | unique `email` (stored lowercased + trimmed)     |
| Inventory  | `inventory_db` | `products`  | `type`, `name`                                   |
| Orders     | `orders_db`    | `orders`    | `userId+createdAt`, `status`                     |
| Payments   | `payments_db`  | `payments`, `payment_attempts`, `mock_gateway_transactions`, `outbox` | unique `orderId` on payments; unique `{ paymentId, attemptNumber }` |
| Shipping   | `shipping_db`  | `shipments` | unique `orderId`, sparse `trackingNumber`        |

### How they relate (IDs only)

```
users._id ───────────┐
products._id ────────┤ referenced by ID only
                     ▼
                  orders ──orderId──► payments (1) ──► payment_attempts (many)
                     └────orderId──► shipments
```

No arrow means “joined in a query”. Each arrow is a stored ID; other data arrives via API/events.

## Public APIs (front doors)

| Module    | Function                         | Returns / effect                                      |
|-----------|----------------------------------|-------------------------------------------------------|
| Users     | `getUserForOrder(userId)`        | `{ userId, name, address }`                           |
| Inventory | `getProductForOrder(productId)`  | `{ productId, name, unitPrice }`                      |
| Inventory | `reserveStock(items)`            | atomic `sold++` / `remaining--` (rolls back on fail)  |
| Inventory | `releaseStock(items)`            | undo a reservation                                    |
| Payments  | `handleOrderCreatedEvent(...)`   | idempotent `CREATED` payment for an order |
| Payments  | `POST /payments/pay`             | Pay Now (mock gateway, idempotent) |
| Orders    | `handlePaymentSucceededEvent`    | idempotent `PENDING` → `CONFIRMED` |
| Orders    | `runOutboxWorkerOnce()`          | poll/claim/publish pending outbox events (also auto-started on `npm start`) |

Orders (and others) may only call these via `require('../users')` / `require('../inventory')` — never `internal/`.

## Setup

```bash
cp .env.example .env
npm install
npm run db:init
npm run seed
npm start
```

Requires MongoDB running locally (`mongodb://127.0.0.1:27017`).

### First flow: `POST /orders`

```bash
curl -s -X POST localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-1' \
  -d '{"userId":"<userId>","items":[{"productId":"<productId>","quantity":2}]}'
```

Steps inside `placeOrder`: look up user/products → reserve stock → **MongoDB transaction** (insert `orders` + `db_transactions` + `outbox` OrderCreated) → release stock if that fails.

### Learning: MongoDB multi-document transaction + transactional outbox

When an order is created, Orders opens a session and runs:

1. insert into `orders_db.orders`
2. insert into `orders_db.db_transactions` (with `orderId`, `userId`, `idempotencyKey`)
3. insert into `orders_db.outbox` an `OrderCreated` event (`status: PENDING`)

All three **commit together** or **all roll back**. Requires a replica set (this project uses `rs0`).

The outbox stores the event durably with the order so a worker can publish it without losing events on crash.

### Outbox workers

**Publish worker** (in-process with `npm start`): `startOutboxWorker()` polls `orders_db.outbox`, claims `PENDING` rows (`PROCESSING`), calls Payments for `OrderCreated`, then marks `PUBLISHED`. Disable with `OUTBOX_WORKER_ENABLED=false`.

**Stale reclaim worker** (separate process): run `npm run worker:outbox-stale`. It only resets stuck `PROCESSING` rows (e.g. crash mid-publish) back to `PENDING` after `OUTBOX_STALE_PROCESSING_MS`. Poll interval: `OUTBOX_STALE_RECLAIM_POLL_MS`. Disable with `OUTBOX_STALE_WORKER_ENABLED=false`.

For full reliability locally, run both the API and the stale worker.

Inventory reserve stays outside the transaction (different module/DB); on txn failure we still `releaseStock()`.

## Project layout

```
src/
  workers/outbox-stale-worker.js  # PROCESSING → PENDING reclaim (separate process)
  shared/db/connections.js   # one connection per module DB
  modules/
    users/
      index.js               # getUserForOrder
      internal/               # User schema + userService
    inventory/
      index.js               # getProductForOrder, reserveStock, releaseStock
      internal/               # Product schema + inventoryService
    orders/
      index.js
      internal/Order.js
    payments/
      index.js
      internal/Payment.js, PaymentAttempt.js, mockPaymentGateway.js
    shipping/
      index.js
      internal/Shipment.js
  scripts/init-databases.js
```
