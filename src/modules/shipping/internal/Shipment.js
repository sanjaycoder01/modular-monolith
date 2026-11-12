const { Schema } = require('mongoose');

/**
 * Shipping module owns `shipments` in shipping_db.
 * address + items are copied from the order/event — not live references.
 */
const addressSchema = new Schema(
  {
    line1: { type: String, required: true },
    city: { type: String, required: true },
    pincode: { type: String, required: true },
  },
  { _id: false }
);

const shipmentItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const SHIPMENT_STATUSES = ['PENDING', 'PACKED', 'SHIPPED', 'DELIVERED'];

const shipmentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    address: { type: addressSchema, required: true },
    items: {
      type: [shipmentItemSchema],
      required: true,
      validate: [(v) => v.length > 0, 'Shipment must have at least one item'],
    },
    status: {
      type: String,
      required: true,
      enum: SHIPMENT_STATUSES,
      default: 'PENDING',
    },
    trackingNumber: { type: String, trim: true },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'shipments',
  }
);

shipmentSchema.index({ orderId: 1 }, { unique: true });
shipmentSchema.index({ userId: 1, createdAt: -1 });
shipmentSchema.index({ status: 1 });
shipmentSchema.index({ trackingNumber: 1 }, { sparse: true });

function createShipmentModel(connection) {
  return (
    connection.models.Shipment ||
    connection.model('Shipment', shipmentSchema)
  );
}

module.exports = {
  shipmentSchema,
  createShipmentModel,
  SHIPMENT_STATUSES,
};
