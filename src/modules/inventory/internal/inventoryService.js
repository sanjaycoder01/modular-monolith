const {
  ProductNotFoundError,
  InsufficientStockError,
  InvalidStockItemsError,
} = require('./errors');

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new InvalidStockItemsError('items must be a non-empty array');
  }

  const byProductId = new Map();

  for (const item of items) {
    if (!item || item.productId == null) {
      throw new InvalidStockItemsError('each item needs productId');
    }
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new InvalidStockItemsError(
        'each item.quantity must be an integer >= 1'
      );
    }

    const key = String(item.productId);
    const prev = byProductId.get(key);
    if (prev) {
      prev.quantity += quantity;
    } else {
      byProductId.set(key, { productId: item.productId, quantity });
    }
  }

  // Stable order reduces chance of multi-doc update deadlocks
  return [...byProductId.values()].sort((a, b) =>
    String(a.productId).localeCompare(String(b.productId))
  );
}

/**
 * Inventory public operations for Orders (and later Payment failure paths).
 */
function createInventoryService(getProductModel) {
  async function getProductForOrder(productId) {
    const Product = getProductModel();
    const product = await Product.findById(productId).lean();

    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    return {
      productId: product._id,
      name: product.name,
      unitPrice: product.price,
    };
  }

  /**
   * Atomically move qty from remaining → sold.
   * On any failure, previously reserved items are released.
   * @param {{ productId: any, quantity: number }[]} items
   */
  async function reserveStock(items) {
    const Product = getProductModel();
    const normalized = normalizeItems(items);
    const reserved = [];

    try {
      for (const item of normalized) {
        const updated = await Product.findOneAndUpdate(
          {
            _id: item.productId,
            remaining: { $gte: item.quantity },
          },
          {
            $inc: { sold: item.quantity, remaining: -item.quantity },
          },
          { returnDocument: 'after' }
        );

        if (!updated) {
          const exists = await Product.exists({ _id: item.productId });
          if (!exists) {
            throw new ProductNotFoundError(item.productId);
          }
          throw new InsufficientStockError(item.productId, item.quantity);
        }

        reserved.push(item);
      }

      return { reserved: normalized };
    } catch (err) {
      if (reserved.length > 0) {
        await releaseStock(reserved);
      }
      throw err;
    }
  }

  /**
   * Undo a reservation: move qty from sold → remaining.
   * @param {{ productId: any, quantity: number }[]} items
   */
  async function releaseStock(items) {
    const Product = getProductModel();
    const normalized = normalizeItems(items);

    for (const item of normalized) {
      const updated = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          sold: { $gte: item.quantity },
        },
        {
          $inc: { sold: -item.quantity, remaining: item.quantity },
        },
        { returnDocument: 'after' }
      );

      if (!updated) {
        const exists = await Product.exists({ _id: item.productId });
        if (!exists) {
          throw new ProductNotFoundError(item.productId);
        }
        throw new InvalidStockItemsError(
          `Cannot release ${item.quantity} for product ${item.productId}`
        );
      }
    }

    return { released: normalized };
  }

  return { getProductForOrder, reserveStock, releaseStock };
}

module.exports = { createInventoryService };
