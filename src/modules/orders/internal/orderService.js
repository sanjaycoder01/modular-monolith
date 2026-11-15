const users = require('../../users');
const inventory = require('../../inventory');
const {
  httpError,
  OrderNotFoundError,
  OrderStatusConflictError,
} = require('./errors');
const { toOrderItemDto } = require('./dto/OrderItemDto');
const { toOrderDto } = require('./dto/OrderDto');
const { assertValidTransition } = require('./orderStateMachine');

function isIdempotencyDuplicateKeyError(err) {
  if (err.code !== 11000) return false;
  const keyPattern = err.keyPattern || {};
  return Boolean(keyPattern.idempotencyKey || keyPattern.userId);
}

/**
 * Place an order using only other modules' front doors.
 *
 * Idempotency: same userId + idempotencyKey returns the existing order
 * (no second stock reservation, no second document).
 *
 * Order of steps (risky work last):
 * 1. Replay check (read-only)
 * 2. Look up user + products (read-only)
 * 3. Reserve stock (first write)
 * 4. Save order; if that fails, release stock
 *    (duplicate-key race → release stock and replay existing)
 */
function createOrderService(getOrderModel) {
  async function placeOrder({ userId, items, idempotencyKey }) {
    if (!userId) {
      throw httpError(400, 'userId is required');
    }

    const key =
      typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (!key) {
      throw httpError(400, 'idempotencyKey is required');
    }

    const Order = getOrderModel();

    // Retry path: return the same order, create nothing
    const existing = await Order.findOne({
      userId,
      idempotencyKey: key,
    }).lean();
    if (existing) {
      return toOrderDto(existing, { replayed: true });
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
      const mapKey = String(item.productId);
      const prev = merged.get(mapKey);
      if (prev) {
        prev.quantity += quantity;
      } else {
        merged.set(mapKey, { productId: item.productId, quantity });
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
      const order = await Order.create({
        userId: user.userId,
        idempotencyKey: key,
        items: lines,
        totalAmount,
        status: 'PENDING',
        shippingAddress: user.address,
      });
      return toOrderDto(order);
    } catch (err) {
      await inventory.releaseStock(toReserve);

      // Concurrent create with same key: other request won — replay it
      if (isIdempotencyDuplicateKeyError(err)) {
        const replay = await Order.findOne({
          userId,
          idempotencyKey: key,
        }).lean();
        if (replay) {
          return toOrderDto(replay, { replayed: true });
        }
      }

      throw err;
    }
  }

  /**
   * Transition an order to nextStatus via the state machine.
   * Uses a conditional update on { _id, status } so concurrent callers
   * cannot both succeed from a stale status.
   */
  async function transitionOrderStatus(orderId, nextStatus) {
    if (!orderId) {
      throw httpError(400, 'orderId is required');
    }
    if (!nextStatus) {
      throw httpError(400, 'nextStatus is required');
    }

    const Order = getOrderModel();
    const order = await Order.findById(orderId).lean();

    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    assertValidTransition(order.status, nextStatus);

    const updated = await Order.findOneAndUpdate(
      { _id: orderId, status: order.status },
      { $set: { status: nextStatus } },
      { returnDocument: 'after' }
    );

    if (!updated) {
      const latest = await Order.findById(orderId).lean();
      if (!latest) {
        throw new OrderNotFoundError(orderId);
      }
      throw new OrderStatusConflictError(orderId);
    }

    return toOrderDto(updated);
  }

  return { placeOrder, transitionOrderStatus };
}

module.exports = { createOrderService };
