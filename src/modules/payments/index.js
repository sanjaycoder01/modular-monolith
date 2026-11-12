const { getModuleConnection } = require('../../shared/db/connections');
const { createPaymentModel } = require('./internal/Payment');

let Payment;

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

module.exports = { initPaymentsModule, getPaymentModel };
