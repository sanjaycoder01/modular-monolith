/**
 * Dedicated process: reclaim stuck outbox rows (PROCESSING → PENDING).
 * Run alongside the API / publish worker (npm start).
 *
 *   npm run worker:outbox-stale
 */
require('dotenv').config();
const { disconnectAll } = require('../shared/db/connections');
const { initOrdersModule } = require('../modules/orders');
const {
  createOutboxStaleReclaimRunnerFromEnv,
} = require('../modules/orders/internal/outboxStaleReclaim');
const { logger } = require('../shared/logging/logger');

async function main() {
  if (
    process.env.OUTBOX_STALE_WORKER_ENABLED === '0' ||
    process.env.OUTBOX_STALE_WORKER_ENABLED === 'false'
  ) {
    logger.info(
      'orders.outbox.staleReclaim disabled via OUTBOX_STALE_WORKER_ENABLED'
    );
    process.exit(0);
  }

  const { Outbox } = await initOrdersModule();
  const runner = createOutboxStaleReclaimRunnerFromEnv(() => Outbox);
  runner.start();

  const shutdown = async (signal) => {
    logger.info('orders.outbox.staleReclaim shutdown', { signal });
    runner.stop();
    await disconnectAll();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(async (err) => {
  logger.error('orders.outbox.staleReclaim failed to start', {
    message: err.message,
  });
  await disconnectAll().catch(() => {});
  process.exit(1);
});