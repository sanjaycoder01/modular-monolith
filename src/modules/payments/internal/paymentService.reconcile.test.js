const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { disconnectAll } = require('../../../shared/db/connections');
const { initOrdersModule, getOrderModel } = require('../../orders');
const {
  initPaymentsModule,
  getPaymentModel,
  getPaymentAttemptModel,
  handleOrderCreatedEvent,
  payNow,
  reconcilePaymentAttempt,
  handleMockGatewayWebhook,
  runPaymentsOutboxWorkerOnce,
} = require('../index');

describe('payment reconciliation and webhook', () => {
  let Order;
  let Payment;
  let PaymentAttempt;
  const userId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();
  const prevWebhookSecret = process.env.MOCK_WEBHOOK_SECRET;

  before(async () => {
    process.env.MOCK_WEBHOOK_SECRET = 'test-webhook-secret';
    ({ Order } = await initOrdersModule());
    ({ Payment, PaymentAttempt } = await initPaymentsModule());

    await Order.create({
      _id: orderId,
      userId,
      idempotencyKey: 'reconcile-test-order',
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          productName: 'Widget',
          unitPrice: 1000,
          quantity: 1,
        },
      ],
      totalAmount: 1000,
      status: 'PENDING',
      shippingAddress: { line1: '1 St', city: 'City', pincode: '110001' },
    });

    await handleOrderCreatedEvent({
      orderId,
      userId,
      totalAmount: 1000,
    });
  });

  after(async () => {
    process.env.MOCK_WEBHOOK_SECRET = prevWebhookSecret;
    await PaymentAttempt.deleteMany({ orderId });
    await Payment.deleteMany({ orderId });
    await Order.deleteOne({ _id: orderId });
    await disconnectAll();
  });

  it('CRASH_AFTER_SUCCESS leaves PROCESSING; reconcile completes payment', async () => {
    const runId = Date.now();
    const stuck = await payNow({
      orderId,
      userId,
      idempotencyKey: `crash-${runId}`,
      simulateOutcome: 'CRASH_AFTER_SUCCESS',
    });

    assert.equal(stuck.status, 'PROCESSING');
    assert.ok(stuck.gatewayTransactionId);
    assert.equal(stuck.simulatedCrash, true);

    const paymentMid = await Payment.findOne({ orderId }).lean();
    assert.equal(paymentMid.status, 'IN_PROGRESS');

    const finalized = await reconcilePaymentAttempt(stuck.paymentAttemptId);
    assert.equal(finalized.status, 'SUCCEEDED');

    const payment = await Payment.findOne({ orderId }).lean();
    assert.equal(payment.status, 'SUCCEEDED');

    await runPaymentsOutboxWorkerOnce();
    const order = await Order.findById(orderId).lean();
    assert.equal(order.status, 'CONFIRMED');
  });

  it('mock webhook finalizes stuck attempt idempotently', async () => {
    const runId = Date.now() + 1;
    const order = await Order.findById(orderId).lean();
    if (order.status === 'CONFIRMED') {
      await Order.findByIdAndUpdate(orderId, { $set: { status: 'PENDING' } });
    }

    const payment = await Payment.findOne({ orderId }).lean();
    await Payment.findByIdAndUpdate(payment._id, {
      $set: { status: 'CREATED', attemptCount: payment.attemptCount },
    });

    const stuck = await payNow({
      orderId,
      userId,
      idempotencyKey: `webhook-${runId}`,
      simulateOutcome: 'CRASH_AFTER_SUCCESS',
    });

    const webhook1 = await handleMockGatewayWebhook({
      gatewayTransactionId: stuck.gatewayTransactionId,
      webhookSecret: 'test-webhook-secret',
    });
    assert.equal(webhook1.status, 'SUCCEEDED');
    assert.equal(webhook1.viaWebhook, true);

    const webhook2 = await handleMockGatewayWebhook({
      gatewayTransactionId: stuck.gatewayTransactionId,
      webhookSecret: 'test-webhook-secret',
    });
    assert.equal(webhook2.replayed, true);
  });
});