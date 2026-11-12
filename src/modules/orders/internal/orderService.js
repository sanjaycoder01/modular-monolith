const users = require('../../users');
const inventory = require('../../inventory');
const { httpError } = require('./errors');
const { toOrderItemDto } = require('./dto/OrderItemDto');
const { toOrderDto } = require('./dto/OrderDto');

/**
 * Place an order using only other modules' front doors.
 *
 * Order of steps (risky work last):
 * 1. Look up user + products (read-only)
 * 2. Reserve stock (first write)
 * 3. Save order; if that fails, release stock
 *
 * Gap: crash between reserve and save leaves reserved stock with no order.
 * That needs expiry/reconciliation later — try/catch cannot fix it.
 */
function createOrderService(getOrderModel) {
  async function placeOrder({ userId, items }) {
    if (!userId) {
      throw httpError(400, 'userId is required');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw httpError(400, 'Order must have at least one item');
    }

    // Merge duplicate product lines so we don't reserve the same stock twice
    const merged = new Map();
    for (const item of items) {
      if (!item || item.productId == null) {
        throw httpError(400, 'Each item needs productId');
      }
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw httpError(400, 'Quantity must be a positive integer');
      }
      const key = String(item.productId);
      const prev = merged.get(key);
      if (prev) {
        prev.quantity += quantity;
      } else {
        merged.set(key, { productId: item.productId, quantity });
      }
    }

    // 1. Lookups — nothing to undo yet (DTOs from other modules' front doors)
    const user = await users.getUserForOrder(userId);
    const lines = [];
    for (const { productId, quantity } of merged.values()) {
      const product = await inventory.getProductForOrder(productId);
      lines.push(toOrderItemDto(product, quantity));
    }

    const totalAmount = lines.reduce(
      (sum, line) => sum + line.unitPrice * line.quantity,
      0
    );

    // 2. Reserve stock — first step that changes data
    const toReserve = lines.map(({ productId, quantity }) => ({
      productId,
      quantity,
    }));
    await inventory.reserveStock(toReserve);

    // 3. Save order; 4. undo reservation if save fails
    try {
      const Order = getOrderModel();
      const order = await Order.create({
        userId: user.userId,
        items: lines,
        totalAmount,
        status: 'PENDING',
        shippingAddress: user.address,
      });
      return toOrderDto(order);
    } catch (err) {
      await inventory.releaseStock(toReserve);
      throw err;
    }
  }

  return { placeOrder };
}

module.exports = { createOrderService };
