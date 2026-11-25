const { logger } = require('../../../shared/logging/logger');

/**
 * In-process publish for payments_db outbox → Orders module APIs.
 * @param {import('mongoose').Document} event
 */
async function publishPaymentOutboxEvent(event) {
  const orders = require('../../orders');
  const doc = typeof event.toObject === 'function' ? event.toObject() : event;
  const payload = doc.payload || {};

  logger.info('payments.outbox.publish start', {
    outboxId: String(doc._id),
    eventType: doc.eventType,
    aggregateId: String(doc.aggregateId),
  });

  if (doc.eventType === 'PaymentSucceeded') {
    await orders.handlePaymentSucceededEvent({
      orderId: doc.orderId,
      userId: doc.userId,
      paymentId: doc.aggregateId,
      amount: payload.amount,
    });
  } else if (doc.eventType === 'PaymentFailed') {
    await orders.handlePaymentFailedEvent({
      orderId: doc.orderId,
      userId: doc.userId,
      paymentId: doc.aggregateId,
      reason: payload.reason,
    });
  } else {
    throw new Error(`Unsupported payment outbox eventType: ${doc.eventType}`);
  }

  logger.info('payments.outbox.publish success', {
    outboxId: String(doc._id),
    eventType: doc.eventType,
  });
}

module.exports = { publishPaymentOutboxEvent };