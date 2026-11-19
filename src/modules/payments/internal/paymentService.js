const { logger } = require('../../../shared/logging/logger');

/**
 * @param {import('./Payment').Payment} payment
 */
function toPaymentDto(payment) {
  const doc =
    typeof payment.toObject === 'function' ? payment.toObject() : payment;
  const dto = {
    paymentId: doc._id,
    orderId: doc.orderId,
    userId: doc.userId,
    attempt: doc.attempt,
    amount: doc.amount,
    method: doc.method,
    status: doc.status,
    gatewayRef: doc.gatewayRef,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (doc.replayed) {
    dto.replayed = true;
  }
  return dto;
}

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

/**
 * Payments consumer for OrderCreated — idempotent on { orderId, attempt: 1 }.
 */
function createPaymentService({ getPaymentModel }) {
  /**
   * @param {{ orderId: any, userId: any, totalAmount: number, items?: unknown[] }} input
   */
  async function handleOrderCreatedEvent({ orderId, userId, totalAmount }) {
    if (orderId == null) {
      throw new Error('orderId is required');
    }
    if (userId == null) {
      throw new Error('userId is required');
    }
    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      throw new Error('totalAmount must be a non-negative number');
    }

    logger.info('payments.handleOrderCreatedEvent start', {
      orderId: String(orderId),
      userId: String(userId),
      totalAmount,
    });

    const Payment = getPaymentModel();
    const existing = await Payment.findOne({ orderId, attempt: 1 }).lean();
    if (existing) {
      logger.info('payments.handleOrderCreatedEvent replay', {
        orderId: String(orderId),
        paymentId: String(existing._id),
      });
      return toPaymentDto({ ...existing, replayed: true });
    }

    try {
      const [payment] = await Payment.create([
        {
          orderId,
          userId,
          attempt: 1,
          amount: totalAmount,
          method: 'COD',
          status: 'INITIATED',
        },
      ]);

      logger.info('payments.handleOrderCreatedEvent created', {
        orderId: String(orderId),
        paymentId: String(payment._id),
      });
      return toPaymentDto(payment);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const replay = await Payment.findOne({ orderId, attempt: 1 }).lean();
        if (replay) {
          logger.info('payments.handleOrderCreatedEvent concurrent replay', {
            orderId: String(orderId),
            paymentId: String(replay._id),
          });
          return toPaymentDto({ ...replay, replayed: true });
        }
      }
      logger.error('payments.handleOrderCreatedEvent failed', {
        orderId: String(orderId),
        message: err.message,
        code: err.code,
      });
      throw err;
    }
  }

  return { handleOrderCreatedEvent };
}

module.exports = { createPaymentService, toPaymentDto };