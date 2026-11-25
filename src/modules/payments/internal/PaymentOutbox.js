const { Schema } = require('mongoose');

const OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'PUBLISHED'];
const PAYMENT_OUTBOX_EVENT_TYPES = ['PaymentSucceeded', 'PaymentFailed'];

const paymentOutboxSchema = new Schema(
  {
    eventType: {
      type: String,
      required: true,
      enum: PAYMENT_OUTBOX_EVENT_TYPES,
    },
    aggregateType: {
      type: String,
      required: true,
      enum: ['Payment'],
      default: 'Payment',
    },
    aggregateId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    orderId: {
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
    publishedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    nextRetryAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    collection: 'outbox',
  }
);

paymentOutboxSchema.index(
  { aggregateType: 1, aggregateId: 1, eventType: 1 },
  { unique: true }
);
paymentOutboxSchema.index({ status: 1, createdAt: 1 });
paymentOutboxSchema.index({ status: 1, nextRetryAt: 1 });

function createPaymentOutboxModel(connection) {
  return (
    connection.models.PaymentOutbox ||
    connection.model('PaymentOutbox', paymentOutboxSchema)
  );
}

module.exports = {
  paymentOutboxSchema,
  createPaymentOutboxModel,
  OUTBOX_STATUSES,
  PAYMENT_OUTBOX_EVENT_TYPES,
};