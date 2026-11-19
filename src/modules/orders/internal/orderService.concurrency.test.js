const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { disconnectAll } = require('../../../shared/db/connections');
const { initUsersModule } = require('../../users');
const { initInventoryModule } = require('../../inventory');
const {
  initOrdersModule,
  placeOrder,
  transitionOrderStatus,
} = require('../index');

/**
 * Concurrency tests for checkout / order updates.
 * These fire real overlapping Promise.all calls against MongoDB.
 */
describe('placeOrder / transition concurrency', () => {
  let User;
  let Product;
  let Order;
  let DbTransaction;
  let Outbox;
  let connection;
  let userA;
  let userB;
  let productPlenty;
  let productLastOne;

  before(async () => {
    ({ User } = await initUsersModule());
    ({ Product } = await initInventoryModule());
    ({ connection, Order, DbTransaction, Outbox } = await initOrdersModule());

    const stamp = Date.now();
    userA = await User.create({
      name: 'Concurrent User A',
      email: `conc-a-${stamp}@example.com`,
      passwordHash: 'hash',
      address: { line1: '1 Race St', city: 'Pune', pincode: '411001' },
    });
    userB = await User.create({
      name: 'Concurrent User B',
      email: `conc-b-${stamp}@example.com`,
      passwordHash: 'hash',
      address: { line1: '2 Race St', city: 'Pune', pincode: '411002' },
    });

    productPlenty = await Product.create({
      name: `Plenty Widget ${stamp}`,
      type: 'gadgets',
      price: 1000,
      total: 100,
    });

    productLastOne = await Product.create({
      name: `Last One Widget ${stamp}`,
      type: 'gadgets',
      price: 2500,
      total: 1,
    });
  });

  after(async () => {
    if (userA) await User.deleteOne({ _id: userA._id });
    if (userB) await User.deleteOne({ _id: userB._id });
    if (productPlenty) await Product.deleteOne({ _id: productPlenty._id });
    if (productLastOne) await Product.deleteOne({ _id: productLastOne._id });
    await disconnectAll();
  });

  it('1) two simultaneous requests with the SAME Idempotency-Key create one order', async () => {
    const key = `conc-same-${new mongoose.Types.ObjectId()}`;
    const payload = {
      userId: userA._id,
      idempotencyKey: key,
      items: [{ productId: productPlenty._id, quantity: 1 }],
    };

    const soldBefore = (await Product.findById(productPlenty._id).lean()).sold;

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
      userId: userA._id,
      idempotencyKey: key,
    });
    assert.equal(orderCount, 1, 'no duplicate orders');

    const txnCount = await DbTransaction.countDocuments({
      orderId: r1.orderId,
    });
    assert.equal(txnCount, 1, 'exactly one db_transactions row');

    const outboxCount = await Outbox.countDocuments({
      aggregateId: r1.orderId,
      eventType: 'OrderCreated',
    });
    assert.equal(outboxCount, 1, 'exactly one OrderCreated outbox event');

    const soldAfter = (await Product.findById(productPlenty._id).lean()).sold;
    assert.equal(
      soldAfter - soldBefore,
      1,
      'stock deducted once, not twice'
    );

    await Order.deleteOne({ _id: r1.orderId });
    await DbTransaction.deleteOne({ orderId: r1.orderId });
    await Outbox.deleteOne({
      aggregateId: r1.orderId,
      eventType: 'OrderCreated',
    });
  });

  it('2) two simultaneous requests with DIFFERENT Idempotency-Keys create two orders', async () => {
    const keyA = `conc-diff-a-${new mongoose.Types.ObjectId()}`;
    const keyB = `conc-diff-b-${new mongoose.Types.ObjectId()}`;

    const soldBefore = (await Product.findById(productPlenty._id).lean()).sold;

    const [a, b] = await Promise.all([
      placeOrder({
        userId: userA._id,
        idempotencyKey: keyA,
        items: [{ productId: productPlenty._id, quantity: 1 }],
      }),
      placeOrder({
        userId: userA._id,
        idempotencyKey: keyB,
        items: [{ productId: productPlenty._id, quantity: 1 }],
      }),
    ]);

    assert.notEqual(String(a.orderId), String(b.orderId));

    const count = await Order.countDocuments({
      userId: userA._id,
      idempotencyKey: { $in: [keyA, keyB] },
    });
    assert.equal(count, 2);

    const soldAfter = (await Product.findById(productPlenty._id).lean()).sold;
    assert.equal(soldAfter - soldBefore, 2);

    const outboxCount = await Outbox.countDocuments({
      eventType: 'OrderCreated',
      aggregateId: { $in: [a.orderId, b.orderId] },
    });
    assert.equal(outboxCount, 2, 'one OrderCreated outbox event per order');

    await Order.deleteMany({ _id: { $in: [a.orderId, b.orderId] } });
    await DbTransaction.deleteMany({
      orderId: { $in: [a.orderId, b.orderId] },
    });
    await Outbox.deleteMany({
      eventType: 'OrderCreated',
      aggregateId: { $in: [a.orderId, b.orderId] },
    });
  });

  it('3) two users racing for the LAST inventory item: one wins, one gets insufficient stock', async () => {
    // Reset last-one product to remaining=1
    await Product.updateOne(
      { _id: productLastOne._id },
      { $set: { total: 1, sold: 0, remaining: 1 } }
    );

    const results = await Promise.allSettled([
      placeOrder({
        userId: userA._id,
        idempotencyKey: `last-a-${new mongoose.Types.ObjectId()}`,
        items: [{ productId: productLastOne._id, quantity: 1 }],
      }),
      placeOrder({
        userId: userB._id,
        idempotencyKey: `last-b-${new mongoose.Types.ObjectId()}`,
        items: [{ productId: productLastOne._id, quantity: 1 }],
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'exactly one order succeeds');
    assert.equal(rejected.length, 1, 'exactly one order fails');
    assert.equal(rejected[0].reason.code, 'INSUFFICIENT_STOCK');

    const winner = fulfilled[0].value;
    const stock = await Product.findById(productLastOne._id).lean();
    assert.equal(stock.remaining, 0);
    assert.equal(stock.sold, 1);

    const orderCount = await Order.countDocuments({
      'items.productId': productLastOne._id,
    });
    assert.equal(orderCount, 1, 'no overselling / duplicate last-item orders');

    await Order.deleteOne({ _id: winner.orderId });
    await DbTransaction.deleteOne({ orderId: winner.orderId });
    await Outbox.deleteOne({
      aggregateId: winner.orderId,
      eventType: 'OrderCreated',
    });
  });

  it('4) multiple concurrent status transitions: only one PENDING → CONFIRMED wins', async () => {
    const created = await Order.create({
      userId: userA._id,
      idempotencyKey: `status-race-${new mongoose.Types.ObjectId()}`,
      items: [
        {
          productId: productPlenty._id,
          productName: 'Status Race',
          unitPrice: 1000,
          quantity: 1,
        },
      ],
      totalAmount: 1000,
      status: 'PENDING',
      shippingAddress: {
        line1: '1 Race St',
        city: 'Pune',
        pincode: '411001',
      },
    });

    const results = await Promise.allSettled([
      transitionOrderStatus(created._id, 'CONFIRMED'),
      transitionOrderStatus(created._id, 'CONFIRMED'),
      transitionOrderStatus(created._id, 'CONFIRMED'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 2);
    assert.equal(fulfilled[0].value.status, 'CONFIRMED');

    for (const r of rejected) {
      assert.ok(
        r.reason.code === 'ORDER_STATUS_CONFLICT' ||
          r.reason.code === 'INVALID_ORDER_TRANSITION'
      );
    }

    const stored = await Order.findById(created._id).lean();
    assert.equal(stored.status, 'CONFIRMED');

    await Order.deleteOne({ _id: created._id });
  });

  it('5) transaction failure mid-checkout leaves no order, db_transactions, or outbox', async () => {
    const session = await connection.startSession();
    let attemptedOrderId;

    try {
      await assert.rejects(
        () =>
          session.withTransaction(async () => {
            const [order] = await Order.create(
              [
                {
                  userId: userA._id,
                  idempotencyKey: `txn-fail-${new mongoose.Types.ObjectId()}`,
                  items: [
                    {
                      productId: productPlenty._id,
                      productName: 'Txn Fail',
                      unitPrice: 1000,
                      quantity: 1,
                    },
                  ],
                  totalAmount: 1000,
                  status: 'PENDING',
                  shippingAddress: {
                    line1: '1 Race St',
                    city: 'Pune',
                    pincode: '411001',
                  },
                },
              ],
              { session }
            );

            attemptedOrderId = order._id;

            // Fail before writing db_transactions / outbox → whole txn aborts
            throw new Error('simulated checkout transaction failure');
          }),
        (err) => /simulated checkout transaction failure/.test(err.message)
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
});
