const { Schema } = require('mongoose');

/**
 * Payments module owns `payments` in payments_db.
 * Unique { orderId, attempt } allows retries after FAILED without
 * double-charging the same attempt (duplicate events share attempt #).
 */
const PAYMENT_METHODS = ['UPI', 'CARD', 'COD'];
const PAYMENT_STATUSES = ['INITIATED', 'CAPTURED', 'FAILED', 'REFUNDED'];

const paymentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    attempt: { type: Number, required: true, min: 1, default: 1 },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, required: true, enum: PAYMENT_METHODS },
    status: {
      type: String,
      required: true,
      enum: PAYMENT_STATUSES,
      default: 'INITIATED',
    },
    gatewayRef: { type: String, trim: true },
    failureReason: { type: String, trim: true },
  },
  {
    timestamps: true,
    collection: 'payments',
  }
);

// Idempotent per attempt; FAILED can retry as attempt+1
paymentSchema.index({ orderId: 1, attempt: 1 }, { unique: true });
paymentSchema.index({ orderId: 1, createdAt: -1 });
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
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
};
