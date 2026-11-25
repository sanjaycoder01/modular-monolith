/**
 * Demo: first Pay Now fails, second succeeds.
 * Leaves two rows in payment_attempts; payment ends SUCCEEDED.
 *
 * Run: npm run demo:payment-retry
 */
require('dotenv').config();
const { disconnectAll } = require('../shared/db/connections');
const { initUsersModule } = require('../modules/users');
const { initInventoryModule } = require('../modules/inventory');
const {
  initOrdersModule,
  placeOrder,
  runOutboxWorkerOnce,
} = require('../modules/orders');
const {
  initPaymentsModule,
  getPaymentModel,
  getPaymentAttemptModel,
  payNow,
  runPaymentsOutboxWorkerOnce,
} = require('../modules/payments');

async function findOrCreateDemoUser(User) {
  const email = 'demo@example.com';
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name: 'Demo User',
      email,
      passwordHash: 'not-a-real-hash',
      phone: '9999999999',
      address: {
        line1: '12 Demo Street',
        city: 'Pune',
        pincode: '411001',
      },
    });
  }
  return user;
}

async function findOrCreateDemoProduct(Product) {
  let product = await Product.findOne({ name: 'Demo Widget' });
  if (!product) {
    product = await Product.create({
      name: 'Demo Widget',
      type: 'gadgets',
      price: 499,
      total: 20,
    });
  }
  return product;
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const { User } = await initUsersModule();
  const { Product } = await initInventoryModule();
  await initPaymentsModule();
  const { Order } = await initOrdersModule();

  const user = await findOrCreateDemoUser(User);
  const product = await findOrCreateDemoProduct(Product);

  const runId = Date.now();
  printSection('1) Place order');
  const order = await placeOrder({
    userId: user._id,
    idempotencyKey: `demo-payment-retry-${runId}`,
    items: [{ productId: product._id, quantity: 1 }],
  });
  console.log('orderId:', order.orderId, 'status:', order.status);

  printSection('2) Outbox → create Payment (CREATED)');
  await runOutboxWorkerOnce();

  const Payment = getPaymentModel();
  const paymentBefore = await Payment.findOne({ orderId: order.orderId }).lean();
  console.log('payment:', {
    paymentId: String(paymentBefore._id),
    status: paymentBefore.status,
    attemptCount: paymentBefore.attemptCount,
    amount: paymentBefore.amount,
  });

  printSection('3) Pay Now #1 — simulate FAILED');
  const attempt1 = await payNow({
    orderId: order.orderId,
    userId: user._id,
    idempotencyKey: `pay-attempt-1-${runId}`,
    simulateOutcome: 'FAILED',
  });
  console.log('attempt1:', {
    paymentAttemptId: String(attempt1.paymentAttemptId),
    attemptNumber: attempt1.attemptNumber,
    status: attempt1.status,
    failureReason: attempt1.failureReason,
  });

  const paymentAfterFail = await Payment.findOne({ orderId: order.orderId }).lean();
  console.log('payment after fail:', {
    status: paymentAfterFail.status,
    attemptCount: paymentAfterFail.attemptCount,
  });

  printSection('4) Pay Now #2 — simulate SUCCESS');
  const attempt2 = await payNow({
    orderId: order.orderId,
    userId: user._id,
    idempotencyKey: `pay-attempt-2-${runId}`,
    simulateOutcome: 'SUCCESS',
  });
  console.log('attempt2:', {
    paymentAttemptId: String(attempt2.paymentAttemptId),
    attemptNumber: attempt2.attemptNumber,
    status: attempt2.status,
    gatewayTransactionId: attempt2.gatewayTransactionId,
  });

  printSection('5) Payments outbox → confirm order');
  await runPaymentsOutboxWorkerOnce();

  const paymentFinal = await Payment.findOne({ orderId: order.orderId }).lean();
  const PaymentAttempt = getPaymentAttemptModel();
  const attempts = await PaymentAttempt.find({ paymentId: paymentFinal._id })
    .sort({ attemptNumber: 1 })
    .lean();
  const orderDoc = await Order.findById(order.orderId).lean();

  printSection('Final DB state');
  console.log('payments (1 document):', {
    paymentId: String(paymentFinal._id),
    status: paymentFinal.status,
    attemptCount: paymentFinal.attemptCount,
    amount: paymentFinal.amount,
  });
  console.log('payment_attempts (' + attempts.length + ' documents):');
  for (const a of attempts) {
    console.log('  -', {
      attemptNumber: a.attemptNumber,
      status: a.status,
      failureReason: a.failureReason || null,
      gatewayTransactionId: a.gatewayTransactionId || null,
    });
  }
  console.log('order:', {
    orderId: String(orderDoc._id),
    status: orderDoc.status,
  });
}

main()
  .then(async () => {
    await disconnectAll();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await disconnectAll().catch(() => {});
    process.exit(1);
  });