const { Schema } = require('mongoose');

/**
 * Learning / audit collection in orders_db.
 * Written in the SAME MongoDB transaction as Order.create so either:
 *   - both documents commit, or
 *   - both roll back
 *
 * Collection name: db_transactions
 */
const dbTransactionSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    idempotencyKey: { type: String, required: true, trim: true },
    operation: {
      type: String,
      required: true,
      enum: ['ORDER_CREATE'],
      default: 'ORDER_CREATE',
    },
    note: {
      type: String,
      default:
        'Created inside a MongoDB multi-document transaction with the order',
    },
  },
  {
    timestamps: true,
    collection: 'db_transactions',
  }
);

dbTransactionSchema.index({ orderId: 1 }, { unique: true });
dbTransactionSchema.index({ userId: 1, createdAt: -1 });

function createDbTransactionModel(connection) {
  return (
    connection.models.DbTransaction ||
    connection.model('DbTransaction', dbTransactionSchema)
  );
}

module.exports = { dbTransactionSchema, createDbTransactionModel };
