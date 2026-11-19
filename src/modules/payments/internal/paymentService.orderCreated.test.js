const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { disconnectAll } = require('../../../shared/db/connections');
const {
  initPaymentsModule,
  getPaymentModel,
  handleOrderCreatedEvent,
} = require('../index');

describe('handleOrderCreatedEvent', () => {
  let Payment;
  const orderId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  before(async () => {
    ({ Payment } = await initPaymentsModule());
  });

  after(async () => {
    await Payment.deleteMany({ orderId });
    await disconnectAll();
  });

  it('creates attempt-1 INITIATED payment for an order', async () => {
    const result = await handleOrderCreatedEvent({
      orderId,
      userId,
      totalAmount: 4200,
    });

    assert.equal(String(result.orderId), String(orderId));
    assert.equal(String(result.userId), String(userId));
    assert.equal(result.attempt, 1);
    assert.equal(result.amount, 4200);
    assert.equal(result.status, 'INITIATED');
    assert.equal(result.method, 'COD');
    assert.equal(result.replayed, undefined);

    const count = await Payment.countDocuments({ orderId, attempt: 1 });
    assert.equal(count, 1);
  });

  it('replays idempotently for duplicate OrderCreated delivery', async () => {
    const second = await handleOrderCreatedEvent({
      orderId,
      userId,
      totalAmount: 4200,
    });

    assert.equal(second.replayed, true);
    assert.equal(
      String(second.paymentId),
      String((await Payment.findOne({ orderId, attempt: 1 }).lean())._id)
    );

    const count = await Payment.countDocuments({ orderId, attempt: 1 });
    assert.equal(count, 1);
  });
});