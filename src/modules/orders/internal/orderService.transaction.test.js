const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { disconnectAll } = require('../../../shared/db/connections');
const { initUsersModule } = require('../../users');
const { initInventoryModule } = require('../../inventory');
const { initOrdersModule, placeOrder } = require('../index');

/**
 * Demonstrates MongoDB multi-document transactions:
 * - COMMIT: order + db_transactions + outbox event all exist
 * - ROLLBACK: if anything fails inside withTransaction, nothing is kept
 */
describe('order create MongoDB transaction', () => {
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
      name: 'Txn Tester',
      email: `txn-${Date.now()}@example.com`,
      passwordHash: 'hash',
      address: { line1: '1 Txn St', city: 'Pune', pincode: '411001' },
    });
    userId = user._id;

    const product = await Product.create({
      name: `Txn Widget ${Date.now()}`,
      type: 'gadgets',
      price: 1000,
      total: 20,
    });
    productId = product._id;
  });

  after(async () => {
    if (userId) await User.deleteOne({ _id: userId });
    if (productId) await Product.deleteOne({ _id: productId });
    await disconnectAll();
  });

  it('COMMITS: creates order, db_transactions row, and outbox event together', async () => {
    const key = `txn-commit-${new mongoose.Types.ObjectId()}`;
    const order = await placeOrder({
      userId,
      idempotencyKey: key,
      items: [{ productId, quantity: 1 }],
    });

    const storedOrder = await Order.findById(order.orderId).lean();
    const txnRow = await DbTransaction.findOne({ orderId: order.orderId }).lean();
    const outboxEvent = await Outbox.findOne({
      aggregateId: order.orderId,
      eventType: 'OrderCreated',
    }).lean();

    assert.ok(storedOrder, 'order should exist after commit');
    assert.ok(txnRow, 'db_transactions row should exist after commit');
    assert.ok(outboxEvent, 'outbox OrderCreated should exist after commit');
    assert.equal(String(txnRow.orderId), String(order.orderId));
    assert.equal(String(txnRow.userId), String(userId));
    assert.equal(txnRow.idempotencyKey, key);
    assert.equal(txnRow.operation, 'ORDER_CREATE');
    assert.equal(outboxEvent.status, 'PENDING');
    assert.equal(String(outboxEvent.aggregateId), String(order.orderId));
    assert.equal(String(outboxEvent.userId), String(userId));

    await Order.deleteOne({ _id: order.orderId });
    await DbTransaction.deleteOne({ orderId: order.orderId });
    await Outbox.deleteOne({ _id: outboxEvent._id });
  });

  it('ROLLS BACK: order is not kept if transaction throws mid-way', async () => {
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
                  idempotencyKey: `txn-rollback-${new mongoose.Types.ObjectId()}`,
                  items: [
                    {
                      productId,
                      productName: 'Rollback Demo',
                      unitPrice: 1000,
                      quantity: 1,
                    },
                  ],
                  totalAmount: 1000,
                  status: 'PENDING',
                  shippingAddress: {
                    line1: '1 Txn St',
                    city: 'Pune',
                    pincode: '411001',
                  },
                },
              ],
              { session }
            );

            attemptedOrderId = order._id;

            // Simulate failure AFTER order insert, BEFORE/instead of
            // writing db_transactions — MongoDB aborts the whole txn.
            throw new Error('simulated failure inside transaction');
          }),
        (err) => /simulated failure/.test(err.message)
      );
    } finally {
      await session.endSession();
    }

    assert.ok(attemptedOrderId, 'order id should have been assigned in-memory');
    const storedOrder = await Order.findById(attemptedOrderId).lean();
    const txnRow = await DbTransaction.findOne({
      orderId: attemptedOrderId,
    }).lean();
    const outboxEvent = await Outbox.findOne({
      aggregateId: attemptedOrderId,
      eventType: 'OrderCreated',
    }).lean();

    assert.equal(storedOrder, null, 'order must be rolled back');
    assert.equal(txnRow, null, 'db_transactions row must not exist');
    assert.equal(outboxEvent, null, 'outbox event must not exist');
  });
});
