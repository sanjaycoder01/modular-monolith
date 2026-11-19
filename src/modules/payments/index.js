const { getModuleConnection } = require('../../shared/db/connections');
const { createPaymentModel, PAYMENT_STATUSES } = require('./internal/Payment');
const { createPaymentService } = require('./internal/paymentService');

let Payment;
let paymentService;

async function initPaymentsModule() {
  const connection = await getModuleConnection('payments');
  Payment = createPaymentModel(connection);

  // Drop legacy unique-on-orderId-only index so FAILED retries can insert attempt+1
  try {
    await Payment.collection.dropIndex('orderId_1');
  } catch (err) {
    if (err.codeName !== 'IndexNotFound' && err.code !== 27) {
      throw err;
    }
  }

  await Payment.createIndexes();
  paymentService = createPaymentService({ getPaymentModel });
  return { connection, Payment };
}

function getPaymentModel() {
  if (!Payment) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
  return Payment;
}

function assertPaymentReady() {
  if (!paymentService) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
}

/**
 * Public API — consume OrderCreated (idempotent payment initiation).
 */
async function handleOrderCreatedEvent(input) {
  assertPaymentReady();
  return paymentService.handleOrderCreatedEvent(input);
}

module.exports = {
  initPaymentsModule,
  getPaymentModel,
  handleOrderCreatedEvent,
  PAYMENT_STATUSES,
};
