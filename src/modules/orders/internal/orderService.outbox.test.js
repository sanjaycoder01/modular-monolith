const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { disconnectAll } = require('../../../shared/db/connections');
const { initUsersModule } = require('../../users');
const { initInventoryModule } = require('../../inventory');
const { initOrdersModule, placeOrder } = require('../index');

/**
 * Transactional Outbox: OrderCreated is persisted in the same MongoDB
 * transaction as the order (+ db_transactions). Worker comes later.
 */
describe('placeOrder transactional outbox', () => {
  let User;
  let Product;
  let Order;
  let DbTransaction;
  let Outbox;
  let connection;
  let userId;
  let productId;

  before(async () => {
    ({ User } = await initUsersModule());
    ({ Product } = await initInventoryModule());
    ({ connection, Order, DbTransaction, Outbox } = await initOrdersModule());

    const user = await User.create({
      name: 'Outbox Tester',
      email: `outbox-${Date.now()}@example.com`,
      passwordHash: 'hash',
      address: { line1: '1 Outbox St', city: 'Pune', pincode: '411001' },
    });
    userId = user._id;

    const product = await Product.create({
      name: `Outbox Widget ${Date.now()}`,
      type: 'gadgets',
      price: 1500,
      total: 50,
    });
    productId = product._id;
  });

  after(async () => {
    if (userId) await User.deleteOne({ _id: userId });
    if (productId) await Product.deleteOne({ _id: productId });
    await disconnectAll();
  });

  async function cleanupOrder(orderId) {
    await Order.deleteOne({ _id: orderId });
    await DbTransaction.deleteOne({ orderId });
    await Outbox.deleteOne({ aggregateId: orderId, eventType: 'OrderCreated' });
  }

  it('1) successful order creates order + db_transactions + PENDING OrderCreated outbox', async () => {
    const key = `outbox-ok-${new mongoose.Types.ObjectId()}`;
    const order = await placeOrder({
      userId,
      idempotencyKey: key,
      items: [{ productId, quantity: 2 }],
    });

    const storedOrder = await Order.findById(order.orderId).lean();
    const txnRow = await DbTransaction.findOne({ orderId: order.orderId }).lean();
    const events = await Outbox.find({
      aggregateId: order.orderId,
      eventType: 'OrderCreated',
    }).lean();

    assert.ok(storedOrder, 'order should exist');
    assert.ok(txnRow, 'db_transactions row should exist');
    assert.equal(events.length, 1, 'exactly one OrderCreated outbox event');

    const event = events[0];
    assert.equal(event.eventType, 'OrderCreated');
    assert.equal(event.aggregateType, 'Order');
    assert.equal(String(event.aggregateId), String(order.orderId));
    assert.equal(String(event.userId), String(userId));
    assert.equal(event.status, 'PENDING');
    assert.equal(event.attempts, 0);
    assert.equal(event.publishedAt, null);
    assert.equal(String(event.payload.orderId), String(order.orderId));
    assert.equal(String(event.payload.userId), String(userId));
    assert.equal(event.payload.idempotencyKey, key);
    assert.equal(event.payload.totalAmount, 3000);
    assert.equal(event.payload.status, 'PENDING');
    assert.equal(event.payload.items.length, 1);
    assert.equal(String(event.payload.items[0].productId), String(productId));
    assert.equal(event.payload.items[0].quantity, 2);
    assert.equal(event.payload.shippingAddress, undefined);

    await cleanupOrder(order.orderId);
  });

  it('2) transaction failure leaves no order, db_transactions, or outbox event', async () => {
    const session = await connection.startSession();
    let attemptedOrderId;

    try {
      await assert.rejects(
        () =>
          session.withTransaction(async () => {
            const [order] = await Order.create(
              [
                {
                  userId,
                  idempotencyKey: `outbox-fail-${new mongoose.Types.ObjectId()}`,
                  items: [
                    {
                      productId,
                      productName: 'Outbox Fail',
                      unitPrice: 1500,
                      quantity: 1,
                    },
                  ],
                  totalAmount: 1500,
                  status: 'PENDING',
                  shippingAddress: {
                    line1: '1 Outbox St',
                    city: 'Pune',
                    pincode: '411001',
                  },
                },
              ],
              { session }
            );

            attemptedOrderId = order._id;

            await Outbox.create(
              [
                {
                  eventType: 'OrderCreated',
                  aggregateType: 'Order',
                  aggregateId: order._id,
                  userId,
                  payload: {
                    orderId: order._id,
                    userId,
                    totalAmount: 1500,
                    status: 'PENDING',
                    items: [],
                  },
                  status: 'PENDING',
                  attempts: 0,
                },
              ],
              { session }
            );

            // Fail after order + outbox inserts → whole txn aborts
            throw new Error('simulated outbox transaction failure');
          }),
        (err) => /simulated outbox transaction failure/.test(err.message)
      );
    } finally {
      await session.endSession();
    }

    assert.ok(attemptedOrderId);
    assert.equal(await Order.findById(attemptedOrderId).lean(), null);
    assert.equal(
      await DbTransaction.findOne({ orderId: attemptedOrderId }).lean(),
      null
    );
    assert.equal(
      await Outbox.findOne({
        aggregateId: attemptedOrderId,
        eventType: 'OrderCreated',
      }).lean(),
      null
    );
  });

  it('3) concurrent same idempotency key → one order and one OrderCreated event', async () => {
    const key = `outbox-same-${new mongoose.Types.ObjectId()}`;
    const payload = {
      userId,
      idempotencyKey: key,
      items: [{ productId, quantity: 1 }],
    };

    const soldBefore = (await Product.findById(productId).lean()).sold;

    const [r1, r2] = await Promise.all([
      placeOrder(payload),
      placeOrder(payload),
    ]);

    assert.equal(String(r1.orderId), String(r2.orderId));
    assert.equal(
      [r1.replayed, r2.replayed].filter(Boolean).length,
      1,
      'exactly one response should be a replay'
    );

    const orderCount = await Order.countDocuments({
      userId,
      idempotencyKey: key,
    });
    assert.equal(orderCount, 1);

    const eventCount = await Outbox.countDocuments({
      aggregateId: r1.orderId,
      eventType: 'OrderCreated',
    });
    assert.equal(eventCount, 1, 'exactly one OrderCreated outbox event');

    const soldAfter = (await Product.findById(productId).lean()).sold;
    assert.equal(soldAfter - soldBefore, 1, 'stock deducted once');

    await cleanupOrder(r1.orderId);
  });

  it('4) different idempotency keys → two orders and two OrderCreated events', async () => {
    const keyA = `outbox-diff-a-${new mongoose.Types.ObjectId()}`;
    const keyB = `outbox-diff-b-${new mongoose.Types.ObjectId()}`;

    const [a, b] = await Promise.all([
      placeOrder({
        userId,
        idempotencyKey: keyA,
        items: [{ productId, quantity: 1 }],
      }),
      placeOrder({
        userId,
        idempotencyKey: keyB,
        items: [{ productId, quantity: 1 }],
      }),
    ]);

    assert.notEqual(String(a.orderId), String(b.orderId));

    const eventCount = await Outbox.countDocuments({
      eventType: 'OrderCreated',
      aggregateId: { $in: [a.orderId, b.orderId] },
    });
    assert.equal(eventCount, 2);

    await cleanupOrder(a.orderId);
    await cleanupOrder(b.orderId);
  });
});
