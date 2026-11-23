const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { disconnectAll } = require('../../../shared/db/connections');
const { initOrdersModule } = require('../index');
const { reclaimStaleOutboxEvents } = require('./outboxStaleReclaim');

describe('outbox stale reclaim', () => {
  let Outbox;
  let userId;

  before(async () => {
    ({ Outbox } = await initOrdersModule());
    userId = new mongoose.Types.ObjectId();
  });

  after(async () => {
    await Outbox.deleteMany({ userId });
    await disconnectAll();
  });

  it('reclaims PROCESSING rows older than staleProcessingMs', async () => {
    const orderId = new mongoose.Types.ObjectId();
    const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000);

    await Outbox.create({
      eventType: 'OrderCreated',
      aggregateType: 'Order',
      aggregateId: orderId,
      userId,
      payload: { orderId, totalAmount: 100 },
      status: 'PROCESSING',
      attempts: 0,
    });

    await Outbox.collection.updateOne(
      { aggregateId: orderId },
      { $set: { updatedAt: staleUpdatedAt } }
    );

    const { modifiedCount } = await reclaimStaleOutboxEvents(
      () => Outbox,
      5 * 60 * 1000
    );
    assert.equal(modifiedCount, 1);

    const row = await Outbox.findOne({ aggregateId: orderId }).lean();
    assert.equal(row.status, 'PENDING');
    assert.match(row.lastError, /Reclaimed stale PROCESSING lock/);

    await Outbox.deleteOne({ aggregateId: orderId });
  });

  it('does not reclaim recent PROCESSING rows', async () => {
    const orderId = new mongoose.Types.ObjectId();

    await Outbox.create({
      eventType: 'OrderCreated',
      aggregateType: 'Order',
      aggregateId: orderId,
      userId,
      payload: { orderId, totalAmount: 100 },
      status: 'PROCESSING',
      attempts: 0,
    });

    const { modifiedCount } = await reclaimStaleOutboxEvents(
      () => Outbox,
      5 * 60 * 1000
    );
    assert.equal(modifiedCount, 0);

    const row = await Outbox.findOne({ aggregateId: orderId }).lean();
    assert.equal(row.status, 'PROCESSING');

    await Outbox.deleteOne({ aggregateId: orderId });
  });
});