const { Schema } = require('mongoose');

/**
 * One Payment per order (online only). Retries are separate PaymentAttempt rows.
 * amount is integer paise, snapshotted from OrderCreated.
 */
const PAYMENT_STATUSES = ['CREATED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED'];

const paymentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    amount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: 'amount must be a non-negative safe integer in paise',
      },
    },
    currency: { type: String, required: true, default: 'INR', trim: true },
    status: {
      type: String,
      required: true,
      enum: PAYMENT_STATUSES,
      default: 'CREATED',
    },
    attemptCount: { type: Number, required: true, min: 0, default: 0 },
  },
  {
    timestamps: true,
    collection: 'payments',
  }
);

paymentSchema.index({ orderId: 1 }, { unique: true });
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1 });

function createPaymentModel(connection) {
  return (
    connection.models.Payment || connection.model('Payment', paymentSchema)
  );
}

module.exports = {
  paymentSchema,
  createPaymentModel,
  PAYMENT_STATUSES,
};