const { logger } = require('../../../shared/logging/logger');

const DEFAULT_POLL_MS = 30000;
const DEFAULT_STALE_MS = 5000;
const DEFAULT_BATCH_SIZE = 20;

function readPositiveInt(envValue, fallback) {
  const n = Number(envValue);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * @param {{
 *   reconcileStuck: (options: { staleMs: number, batchSize: number }) => Promise<{ processed: number, skipped: number }>,
 *   pollIntervalMs?: number,
 *   staleMs?: number,
 *   batchSize?: number,
 * }} deps
 */
function createPaymentReconciliationWorker(deps) {
  const reconcileStuck = deps.reconcileStuck;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  const staleMs = deps.staleMs ?? DEFAULT_STALE_MS;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;

  let timer = null;
  let ticking = false;

  async function tick() {
    if (ticking) {
      return { processed: 0, skipped: 0, skippedTick: true };
    }

    ticking = true;
    try {
      const result = await reconcileStuck({ staleMs, batchSize });
      if (result.processed > 0) {
        logger.info('payments.reconcile.worker tick', result);
      }
      return { ...result, skippedTick: false };
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (timer) return;

    logger.info('payments.reconcile.worker start', {
      pollIntervalMs,
      staleMs,
      batchSize,
    });

    timer = setInterval(() => {
      tick().catch((err) => {
        logger.error('payments.reconcile.worker tick failed', {
          message: err.message,
        });
      });
    }, pollIntervalMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    tick().catch((err) => {
      logger.error('payments.reconcile.worker initial tick failed', {
        message: err.message,
      });
    });
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    logger.info('payments.reconcile.worker stopped');
  }

  return { tick, start, stop };
}

function createPaymentReconciliationWorkerFromEnv(reconcileStuck) {
  return createPaymentReconciliationWorker({
    reconcileStuck,
    pollIntervalMs: readPositiveInt(
      process.env.PAYMENT_RECONCILE_WORKER_POLL_MS,
      DEFAULT_POLL_MS
    ),
    staleMs: readPositiveInt(
      process.env.PAYMENT_RECONCILE_STALE_MS,
      DEFAULT_STALE_MS
    ),
    batchSize: readPositiveInt(
      process.env.PAYMENT_RECONCILE_BATCH_SIZE,
      DEFAULT_BATCH_SIZE
    ),
  });
}

module.exports = {
  createPaymentReconciliationWorker,
  createPaymentReconciliationWorkerFromEnv,
};