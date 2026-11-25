const { Schema } = require('mongoose');

const ATTEMPT_STATUSES = [
  'INITIATED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'TIMEOUT',
  'UNKNOWN',
];

const paymentAttemptSchema = new Schema(
  {
    paymentId: { type: Schema.Types.ObjectId, required: true },
    orderId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    attemptNumber: { type: Number, required: true, min: 1 },
    amount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: 'amount must be a non-negative safe integer in paise',
      },
    },
    gateway: { type: String, required: true, default: 'MOCK', trim: true },
    gatewayTransactionId: { type: String, trim: true, default: null },
    clientIdempotencyKey: { type: String, trim: true, default: null },
    status: {
      type: String,
      required: true,
      enum: ATTEMPT_STATUSES,
      default: 'INITIATED',
    },
    failureReason: { type: String, trim: true, default: null },
    simulateOutcome: { type: String, trim: true, default: null },
  },
  {
    timestamps: true,
    collection: 'payment_attempts',
  }
);

paymentAttemptSchema.index(
  { paymentId: 1, attemptNumber: 1 },
  { unique: true }
);
paymentAttemptSchema.index(
  { paymentId: 1, clientIdempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { clientIdempotencyKey: { $type: 'string' } },
  }
);
paymentAttemptSchema.index(
  { gatewayTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { gatewayTransactionId: { $type: 'string' } },
  }
);
paymentAttemptSchema.index({ paymentId: 1, createdAt: -1 });
paymentAttemptSchema.index({ status: 1 });

function createPaymentAttemptModel(connection) {
  return (
    connection.models.PaymentAttempt ||
    connection.model('PaymentAttempt', paymentAttemptSchema)
  );
}

module.exports = {
  paymentAttemptSchema,
  createPaymentAttemptModel,
  ATTEMPT_STATUSES,
};