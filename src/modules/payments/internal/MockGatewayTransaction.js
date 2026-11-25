const { Schema } = require('mongoose');

const GATEWAY_OUTCOMES = [
  'SUCCESS',
  'FAILED',
  'TIMEOUT',
  'UNKNOWN',
  'DELAYED_RESPONSE',
];

const LEDGER_STATUSES = ['PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'UNKNOWN'];

const mockGatewayTransactionSchema = new Schema(
  {
    gatewayTransactionId: { type: String, required: true, trim: true },
    paymentId: { type: Schema.Types.ObjectId, required: true },
    paymentAttemptId: { type: Schema.Types.ObjectId, required: true },
    orderId: { type: Schema.Types.ObjectId, required: true },
    amount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: 'amount must be a non-negative safe integer in paise',
      },
    },
    requestedOutcome: { type: String, enum: GATEWAY_OUTCOMES, default: null },
    status: {
      type: String,
      required: true,
      enum: LEDGER_STATUSES,
      default: 'PROCESSING',
    },
    failureReason: { type: String, trim: true, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'mock_gateway_transactions',
  }
);

mockGatewayTransactionSchema.index(
  { gatewayTransactionId: 1 },
  { unique: true }
);
mockGatewayTransactionSchema.index({ paymentAttemptId: 1 }, { unique: true });

function createMockGatewayTransactionModel(connection) {
  return (
    connection.models.MockGatewayTransaction ||
    connection.model('MockGatewayTransaction', mockGatewayTransactionSchema)
  );
}

module.exports = {
  mockGatewayTransactionSchema,
  createMockGatewayTransactionModel,
  GATEWAY_OUTCOMES,
  LEDGER_STATUSES,
};