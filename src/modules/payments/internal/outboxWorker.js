const { logger } = require('../../../shared/logging/logger');
const { publishPaymentOutboxEvent } = require('./outboxPublisher');

const DEFAULT_POLL_MS = 2000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_RETRY_BASE_MS = 5000;
const DEFAULT_RETRY_MAX_MS = 5 * 60 * 1000;

function readPositiveInt(envValue, fallback) {
  const n = Number(envValue);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function computeRetryDelayMs(attemptsAfterFailure, baseMs, maxMs) {
  const exponent = Math.max(0, attemptsAfterFailure - 1);
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

function createPaymentOutboxWorker(deps) {
  const getOutboxModel = deps.getOutboxModel;
  const publishEvent = deps.publishEvent || publishPaymentOutboxEvent;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const retryBaseMs = deps.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const retryMaxMs = deps.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;

  let timer = null;
  let ticking = false;

  function pendingClaimFilter(now) {
    return {
      status: 'PENDING',
      $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
    };
  }

  async function claimNextEvent() {
    const Outbox = getOutboxModel();
    const now = new Date();
    return Outbox.findOneAndUpdate(
      pendingClaimFilter(now),
      { $set: { status: 'PROCESSING' } },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    );
  }

  async function markPublished(eventId) {
    const Outbox = getOutboxModel();
    await Outbox.findOneAndUpdate(
      { _id: eventId, status: 'PROCESSING' },
      {
        $set: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          lastError: null,
          nextRetryAt: null,
        },
      }
    );
  }

  async function scheduleRetry(event, err) {
    const Outbox = getOutboxModel();
    const nextAttempts = (event.attempts || 0) + 1;
    const delayMs = computeRetryDelayMs(nextAttempts, retryBaseMs, retryMaxMs);
    const nextRetryAt = new Date(Date.now() + delayMs);
    const lastError =
      err && err.message ? String(err.message).slice(0, 500) : 'publish failed';

    await Outbox.findOneAndUpdate(
      { _id: event._id, status: 'PROCESSING' },
      {
        $set: {
          status: 'PENDING',
          lastError,
          nextRetryAt,
        },
        $inc: { attempts: 1 },
      }
    );

    logger.warn('payments.outbox.worker scheduled retry', {
      outboxId: String(event._id),
      attempts: nextAttempts,
      nextRetryAt: nextRetryAt.toISOString(),
      message: lastError,
    });
  }

  async function processClaimedEvent(event) {
    try {
      await publishEvent(event);
      await markPublished(event._id);
      logger.info('payments.outbox.worker published', {
        outboxId: String(event._id),
        eventType: event.eventType,
        aggregateId: String(event.aggregateId),
      });
    } catch (err) {
      logger.error('payments.outbox.worker publish failed', {
        outboxId: String(event._id),
        message: err.message,
        code: err.code,
      });
      await scheduleRetry(event, err);
    }
  }

  async function tick() {
    if (ticking) {
      return { processed: 0, skipped: true };
    }

    ticking = true;
    let processed = 0;

    try {
      while (processed < batchSize) {
        const event = await claimNextEvent();
        if (!event) break;
        await processClaimedEvent(event);
        processed += 1;
      }
    } finally {
      ticking = false;
    }

    return { processed, skipped: false };
  }

  function start() {
    if (timer) return;

    logger.info('payments.outbox.worker start', {
      pollIntervalMs,
      batchSize,
    });

    timer = setInterval(() => {
      tick().catch((err) => {
        logger.error('payments.outbox.worker tick failed', {
          message: err.message,
        });
      });
    }, pollIntervalMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    tick().catch((err) => {
      logger.error('payments.outbox.worker initial tick failed', {
        message: err.message,
      });
    });
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    logger.info('payments.outbox.worker stopped');
  }

  return {
    claimNextEvent,
    processClaimedEvent,
    tick,
    start,
    stop,
  };
}

function createPaymentOutboxWorkerFromEnv(getOutboxModel) {
  return createPaymentOutboxWorker({
    getOutboxModel,
    pollIntervalMs: readPositiveInt(
      process.env.PAYMENTS_OUTBOX_WORKER_POLL_MS,
      DEFAULT_POLL_MS
    ),
    batchSize: readPositiveInt(
      process.env.PAYMENTS_OUTBOX_WORKER_BATCH_SIZE,
      DEFAULT_BATCH_SIZE
    ),
    retryBaseMs: readPositiveInt(
      process.env.PAYMENTS_OUTBOX_RETRY_BASE_MS,
      DEFAULT_RETRY_BASE_MS
    ),
    retryMaxMs: readPositiveInt(
      process.env.PAYMENTS_OUTBOX_RETRY_MAX_MS,
      DEFAULT_RETRY_MAX_MS
    ),
  });
}

module.exports = {
  createPaymentOutboxWorker,
  createPaymentOutboxWorkerFromEnv,
};