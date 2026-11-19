const payments = require('../../payments');
const { logger } = require('../../../shared/logging/logger');

/**
 * In-process "publish" for outbox events — calls other modules' public APIs.
 * @param {import('mongoose').Document} event — claimed Outbox document
 */
async function publishOutboxEvent(event) {
  const doc = typeof event.toObject === 'function' ? event.toObject() : event;

  logger.info('orders.outbox.publish start', {
    outboxId: String(doc._id),
    eventType: doc.eventType,
    aggregateId: String(doc.aggregateId),
  });

  if (doc.eventType === 'OrderCreated') {
    const payload = doc.payload || {};
    await payments.handleOrderCreatedEvent({
      orderId: doc.aggregateId,
      userId: doc.userId,
      totalAmount: payload.totalAmount,
      items: payload.items,
    });
    logger.info('orders.outbox.publish success', {
      outboxId: String(doc._id),
      eventType: doc.eventType,
    });
    return;
  }

  throw new Error(`Unsupported outbox eventType: ${doc.eventType}`);
}

module.exports = { publishOutboxEvent };