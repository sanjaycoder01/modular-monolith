const { Schema } = require('mongoose');

/**
 * Transactional outbox in orders_db.
 * Written in the SAME MongoDB transaction as Order.create so either:
 *   - order + db_transactions + outbox event all commit, or
 *   - all roll back
 *
 * A future worker will claim PENDING rows and mark them PUBLISHED.
 * Collection name: outbox
 */
const OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'PUBLISHED'];

const outboxSchema = new Schema(
  {
    eventType: {
      type: String,
      required: true,
      enum: ['OrderCreated'],
    },
    aggregateType: {
      type: String,
      required: true,
      enum: ['Order'],
      default: 'Order',
    },
    aggregateId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: OUTBOX_STATUSES,
      default: 'PENDING',
    },
    attempts: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    nextRetryAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    collection: 'outbox',
  }
);

// One OrderCreated event per order (dedupe / integrity)
outboxSchema.index(
  { aggregateType: 1, aggregateId: 1, eventType: 1 },
  { unique: true }
);
// Worker poll: pending (and retryable) events in insertion order
outboxSchema.index({ status: 1, createdAt: 1 });
outboxSchema.index({ status: 1, nextRetryAt: 1 });

function createOutboxModel(connection) {
  return (
    connection.models.Outbox || connection.model('Outbox', outboxSchema)
  );
}

module.exports = {
  outboxSchema,
  createOutboxModel,
  OUTBOX_STATUSES,
};
