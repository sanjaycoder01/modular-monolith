/**
 * Periodic reconciliation for stuck payment attempts (PROCESSING / UNKNOWN / TIMEOUT).
 *
 *   npm run worker:payment-reconcile
 */
require('dotenv').config();
const { disconnectAll } = require('../shared/db/connections');
const {
  initPaymentsModule,
  startPaymentsReconciliationWorker,
  stopPaymentsReconciliationWorker,
} = require('../modules/payments');
const { logger } = require('../shared/logging/logger');

async function main() {
  if (
    process.env.PAYMENT_RECONCILE_WORKER_ENABLED === '0' ||
    process.env.PAYMENT_RECONCILE_WORKER_ENABLED === 'false'
  ) {
    logger.info(
      'payments.reconcile.worker disabled via PAYMENT_RECONCILE_WORKER_ENABLED'
    );
    process.exit(0);
  }

  await initPaymentsModule();
  startPaymentsReconciliationWorker();

  const shutdown = async (signal) => {
    logger.info('payments.reconcile.worker shutdown', { signal });
    stopPaymentsReconciliationWorker();
    await disconnectAll();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(async (err) => {
  logger.error('payments.reconcile.worker failed to start', {
    message: err.message,
  });
  await disconnectAll().catch(() => {});
  process.exit(1);
});