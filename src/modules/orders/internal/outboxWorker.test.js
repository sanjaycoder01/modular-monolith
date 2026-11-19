const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { disconnectAll } = require('../../../shared/db/connections');
const { initUsersModule } = require('../../users');
const { initInventoryModule } = require('../../inventory');
const { initPaymentsModule, getPaymentModel } = require('../../payments');
const {
  initOrdersModule,
  placeOrder,
  runOutboxWorkerOnce,
} = require('../index');
const { createOutboxWorker } = require('./outboxWorker');

describe('outbox worker', () => {
  let User;
  let Product;
  let Order;
  let DbTransaction;
  let Outbox;
  let userId;
  let productId;
  let getOutboxModel;

  before(async () => {
    ({ User } = await initUsersModule());
    ({ Product } = await initInventoryModule());
    await initPaymentsModule();
    ({ Order, DbTransaction, Outbox } = await initOrdersModule());
    getOutboxModel = () => Outbox;

    const user = await User.create({
      name: 'Worker Tester',
      email: `worker-${Date.now()}@example.com`,
      passwordHash: 'hash',
      address: { line1: '1 Worker St', city: 'Pune', pincode: '411001' },
    });
    userId = user._id;

    const product = await Product.create({
      name: `Worker Widget ${Date.now()}`,
      type: 'gadgets',
      price: 2000,
      total: 50,
    });
    productId = product._id;
  });

  after(async () => {
    if (userId) await User.deleteOne({ _id: userId });
    if (productId) await Product.deleteOne({ _id: productId });
    await disconnectAll();
  });

  async function cleanupOrderArtifacts(orderId) {
    const Payment = getPaymentModel();
    await Payment.deleteMany({ orderId });
    await Order.deleteOne({ _id: orderId });
    await DbTransaction.deleteOne({ orderId });
    await Outbox.deleteOne({
      aggregateId: orderId,
      eventType: 'OrderCreated',
    });
  }

  it('publishes PENDING OrderCreated to Payments and marks outbox PUBLISHED', async () => {
    const key = `worker-ok-${new mongoose.Types.ObjectId()}`;
    const order = await placeOrder({
      userId,
      idempotencyKey: key,
      items: [{ productId, quantity: 1 }],
    });

    const pending = await Outbox.findOne({
      aggregateId: order.orderId,
      eventType: 'OrderCreated',
    }).lean();
    assert.equal(pending.status, 'PENDING');

    let published = await Outbox.findOne({
      aggregateId: order.orderId,
      eventType: 'OrderCreated',
    }).lean();
    for (let i = 0; i < 15 && published.status !== 'PUBLISHED'; i += 1) {
      await runOutboxWorkerOnce();
      published = await Outbox.findOne({
        aggregateId: order.orderId,
        eventType: 'OrderCreated',
      }).lean();
    }
    assert.equal(published.status, 'PUBLISHED');
    assert.ok(published.publishedAt);

    const Payment = getPaymentModel();
    const payment = await Payment.findOne({
      orderId: order.orderId,
      attempt: 1,
    }).lean();
    assert.ok(payment);
    assert.equal(payment.status, 'INITIATED');
    assert.equal(payment.amount, 2000);
    assert.equal(String(payment.userId), String(userId));

    await cleanupOrderArtifacts(order.orderId);
  });

  it('claim is exclusive: two workers cannot claim the same outbox row', async () => {
    const key = `worker-claim-${new mongoose.Types.ObjectId()}`;
    const order = await placeOrder({
      userId,
      idempotencyKey: key,
      items: [{ productId, quantity: 1 }],
    });

    const row = await Outbox.findOne({
      aggregateId: order.orderId,
      eventType: 'OrderCreated',
    }).lean();
    assert.ok(row);

    const [first, second] = await Promise.all([
      Outbox.findOneAndUpdate(
        { _id: row._id, status: 'PENDING' },
        { $set: { status: 'PROCESSING' } },
        { returnDocument: 'after' }
      ),
      Outbox.findOneAndUpdate(
        { _id: row._id, status: 'PENDING' },
        { $set: { status: 'PROCESSING' } },
        { returnDocument: 'after' }
      ),
    ]);

    const claimed = [first, second].filter(Boolean);
    assert.equal(claimed.length, 1);
    assert.equal(String(claimed[0].aggregateId), String(order.orderId));
    assert.equal(claimed[0].status, 'PROCESSING');

    await Outbox.updateOne(
      { _id: claimed[0]._id },
      { $set: { status: 'PENDING' } }
    );
    await cleanupOrderArtifacts(order.orderId);
  });

  it('duplicate publish remains idempotent (one payment row)', async () => {
    const key = `worker-dupe-${new mongoose.Types.ObjectId()}`;
    const order = await placeOrder({
      userId,
      idempotencyKey: key,
      items: [{ productId, quantity: 1 }],
    });

    await runOutboxWorkerOnce();

    await Outbox.updateOne(
      { aggregateId: order.orderId, eventType: 'OrderCreated' },
      {
        $set: {
          status: 'PENDING',
          publishedAt: null,
          nextRetryAt: null,
        },
      }
    );

    await runOutboxWorkerOnce();

    const Payment = getPaymentModel();
    const paymentCount = await Payment.countDocuments({
      orderId: order.orderId,
      attempt: 1,
    });
    assert.equal(paymentCount, 1);

    await cleanupOrderArtifacts(order.orderId);
  });

  it('on handler failure, increments attempts and schedules retry', async () => {
    const key = `worker-fail-${new mongoose.Types.ObjectId()}`;
    const order = await placeOrder({
      userId,
      idempotencyKey: key,
      items: [{ productId, quantity: 1 }],
    });

    const failingWorker = createOutboxWorker({
      getOutboxModel,
      publishEvent: async () => {
        throw new Error('simulated publish failure');
      },
    });

    const before = Date.now();
    await failingWorker.tick();

    const row = await Outbox.findOne({
      aggregateId: order.orderId,
      eventType: 'OrderCreated',
    }).lean();

    assert.equal(row.status, 'PENDING');
    assert.equal(row.attempts, 1);
    assert.match(row.lastError, /simulated publish failure/);
    assert.ok(row.nextRetryAt);
    assert.ok(row.nextRetryAt.getTime() >= before);

    const Payment = getPaymentModel();
    assert.equal(
      await Payment.countDocuments({ orderId: order.orderId }),
      0
    );

    await cleanupOrderArtifacts(order.orderId);
  });
});