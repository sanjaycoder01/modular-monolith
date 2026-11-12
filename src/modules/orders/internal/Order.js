const { Schema } = require('mongoose');

/**
 * Orders module owns `orders` in orders_db.
 * userId / productId are IDs only — no populate or $lookup across modules.
 * productName, unitPrice, shippingAddress are snapshots at order time.
 */
const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    productName: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const shippingAddressSchema = new Schema(
  {
    line1: { type: String, required: true },
    city: { type: String, required: true },
    pincode: { type: String, required: true },
  },
  { _id: false }
);

const ORDER_STATUSES = ['PENDING', 'PAID', 'SHIPPED', 'CANCELLED'];

const orderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: [(v) => v.length > 0, 'Order must have at least one item'],
    },
    totalAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      required: true,
      enum: ORDER_STATUSES,
      default: 'PENDING',
    },
    shippingAddress: { type: shippingAddressSchema, required: true },
  },
  {
    timestamps: true,
    collection: 'orders',
  }
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1 });

function createOrderModel(connection) {
  return connection.models.Order || connection.model('Order', orderSchema);
}

module.exports = { orderSchema, createOrderModel, ORDER_STATUSES };
