const {
  ProductNotFoundError,
  InsufficientStockError,
  InvalidStockItemsError,
} = require('./errors');
const { toProductForOrderDto } = require('./dto/ProductForOrderDto');
const { logger } = require('../../../shared/logging/logger');

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
    logger.info('inventory.getProductForOrder start', {
      productId: String(productId),
    });

    const Product = getProductModel();
    const product = await Product.findById(productId).lean();

    if (!product) {
      logger.warn('inventory.getProductForOrder not found', {
        productId: String(productId),
      });
      throw new ProductNotFoundError(productId);
    }

    const dto = toProductForOrderDto(product);
    logger.info('inventory.getProductForOrder success', {
      productId: String(dto.productId),
      unitPrice: dto.unitPrice,
    });
    return dto;
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

    logger.info('inventory.reserveStock start', {
      items: normalized.map((i) => ({
        productId: String(i.productId),
        quantity: i.quantity,
      })),
    });

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
            logger.warn('inventory.reserveStock product missing', {
              productId: String(item.productId),
            });
            throw new ProductNotFoundError(item.productId);
          }
          logger.warn('inventory.reserveStock insufficient', {
            productId: String(item.productId),
            quantity: item.quantity,
          });
          throw new InsufficientStockError(item.productId, item.quantity);
        }

        reserved.push(item);
      }

      logger.info('inventory.reserveStock success', {
        reservedCount: reserved.length,
      });
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

    logger.info('inventory.releaseStock start', {
      items: normalized.map((i) => ({
        productId: String(i.productId),
        quantity: i.quantity,
      })),
    });

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

    logger.info('inventory.releaseStock success', {
      releasedCount: normalized.length,
    });
    return { released: normalized };
  }

  return { getProductForOrder, reserveStock, releaseStock };
}

module.exports = { createInventoryService };
