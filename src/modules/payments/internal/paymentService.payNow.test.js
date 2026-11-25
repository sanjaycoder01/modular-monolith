const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { disconnectAll } = require('../../../shared/db/connections');
const { initOrdersModule } = require('../../orders');
const {
  initPaymentsModule,
  getPaymentModel,
  getPaymentAttemptModel,
  handleOrderCreatedEvent,
  payNow,
  runPaymentsOutboxWorkerOnce,
} = require('../index');

describe('payNow', () => {
  let Order;
  let Payment;
  let PaymentAttempt;
  const userId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();

  before(async () => {
    ({ Order } = await initOrdersModule());
    ({ Payment, PaymentAttempt } = await initPaymentsModule());

    await Order.create({
      _id: orderId,
      userId,
      idempotencyKey: 'pay-test-order',
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          productName: 'Test',
          unitPrice: 2100,
          quantity: 2,
        },
      ],
      totalAmount: 4200,
      status: 'PENDING',
      shippingAddress: { line1: '1 Test St', city: 'Testville', pincode: '110001' },
    });

    await handleOrderCreatedEvent({
      orderId,
      userId,
      totalAmount: 4200,
    });
  });

  after(async () => {
    await PaymentAttempt.deleteMany({ orderId });
    await Payment.deleteMany({ orderId });
    await Order.deleteOne({ _id: orderId });
    await disconnectAll();
  });

  it('charges via mock gateway and confirms order through outbox', async () => {
    const attempt = await payNow({
      orderId,
      userId,
      idempotencyKey: 'pay-1',
      simulateOutcome: 'SUCCESS',
    });

    assert.equal(attempt.status, 'SUCCEEDED');
    assert.ok(attempt.gatewayTransactionId);

    const payment = await Payment.findOne({ orderId }).lean();
    assert.equal(payment.status, 'SUCCEEDED');

    await runPaymentsOutboxWorkerOnce();

    const order = await Order.findById(orderId).lean();
    assert.equal(order.status, 'CONFIRMED');
  });

  it('replays the same attempt for duplicate Idempotency-Key', async () => {
    const second = await payNow({
      orderId,
      userId,
      idempotencyKey: 'pay-1',
      simulateOutcome: 'SUCCESS',
    });

    assert.equal(second.replayed, true);

    const count = await PaymentAttempt.countDocuments({
      paymentId: (await Payment.findOne({ orderId }).lean())._id,
    });
    assert.equal(count, 1);
  });
});