const { Schema } = require('mongoose');

/**
 * Inventory module owns `products` in inventory_db.
 * remaining must stay in sync with total - sold via atomic updates.
 * On create, remaining is derived as total - sold so callers only set total/sold.
 */
const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true }, // category
    price: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },
    sold: { type: Number, required: true, min: 0, default: 0 },
    remaining: { type: Number, required: true, min: 0 },
  },
  {
    timestamps: true,
    collection: 'products',
  }
);

productSchema.pre('validate', function () {
  if (this.isNew) {
    const total = this.total ?? 0;
    const sold = this.sold ?? 0;
    this.remaining = total - sold;
  }
});

productSchema.index({ type: 1 });
productSchema.index({ name: 1 });

function createProductModel(connection) {
  return (
    connection.models.Product || connection.model('Product', productSchema)
  );
}

module.exports = { productSchema, createProductModel };
