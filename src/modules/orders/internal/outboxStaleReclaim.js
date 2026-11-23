const { logger } = require('../../../shared/logging/logger');

const DEFAULT_STALE_PROCESSING_MS = 5 * 60 * 1000;
const DEFAULT_STALE_RECLAIM_POLL_MS = 30 * 1000;

function readPositiveInt(envValue, fallback) {
  const n = Number(envValue);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * Reset PROCESSING rows stuck longer than staleProcessingMs back to PENDING.
 * @param {() => import('mongoose').Model} getOutboxModel
 * @param {number} staleProcessingMs
 * @returns {Promise<{ modifiedCount: number }>}
 */
async function reclaimStaleOutboxEvents(getOutboxModel, staleProcessingMs) {
  const Outbox = getOutboxModel();
  const staleBefore = new Date(Date.now() - staleProcessingMs);
  const result = await Outbox.updateMany(
    { status: 'PROCESSING', updatedAt: { $lt: staleBefore } },
    {
      $set: {
        status: 'PENDING',
        lastError: 'Reclaimed stale PROCESSING lock',
      },
    }
  );

  if (result.modifiedCount > 0) {
    logger.warn('orders.outbox.staleReclaim reclaimed processing locks', {
      count: result.modifiedCount,
      staleProcessingMs,
    });
  }

  return { modifiedCount: result.modifiedCount };
}

/**
 * Standalone poll loop — only stale PROCESSING recovery (no publish).
 * @param {() => import('mongoose').Model} getOutboxModel
 * @param {{ pollIntervalMs?: number, staleProcessingMs?: number }} [options]
 */
function createOutboxStaleReclaimRunner(getOutboxModel, options = {}) {
  const pollIntervalMs =
    options.pollIntervalMs ?? DEFAULT_STALE_RECLAIM_POLL_MS;
  const staleProcessingMs =
    options.staleProcessingMs ?? DEFAULT_STALE_PROCESSING_MS;

  let timer = null;
  let ticking = false;

  async function tick() {
    if (ticking) {
      return { modifiedCount: 0, skipped: true };
    }

    ticking = true;
    try {
      return {
        ...(await reclaimStaleOutboxEvents(
          getOutboxModel,
          staleProcessingMs
        )),
        skipped: false,
      };
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (timer) return;

    logger.info('orders.outbox.staleReclaim worker start', {
      pollIntervalMs,
      staleProcessingMs,
    });

    timer = setInterval(() => {
      tick().catch((err) => {
        logger.error('orders.outbox.staleReclaim tick failed', {
          message: err.message,
        });
      });
    }, pollIntervalMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    tick().catch((err) => {
      logger.error('orders.outbox.staleReclaim initial tick failed', {
        message: err.message,
      });
    });
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    logger.info('orders.outbox.staleReclaim worker stopped');
  }

  return { tick, start, stop };
}

function createOutboxStaleReclaimRunnerFromEnv(getOutboxModel) {
  return createOutboxStaleReclaimRunner(getOutboxModel, {
    pollIntervalMs: readPositiveInt(
      process.env.OUTBOX_STALE_RECLAIM_POLL_MS,
      DEFAULT_STALE_RECLAIM_POLL_MS
    ),
    staleProcessingMs: readPositiveInt(
      process.env.OUTBOX_STALE_PROCESSING_MS,
      DEFAULT_STALE_PROCESSING_MS
    ),
  });
}

module.exports = {
  reclaimStaleOutboxEvents,
  createOutboxStaleReclaimRunner,
  createOutboxStaleReclaimRunnerFromEnv,
  DEFAULT_STALE_PROCESSING_MS,
  DEFAULT_STALE_RECLAIM_POLL_MS,
  readPositiveInt,
};