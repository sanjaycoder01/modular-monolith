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
const { logger } = require('../../../shared/logging/logger');

function isIdempotencyDuplicateKeyError(err) {
  if (err.code !== 11000) return false;
  const keyPattern = err.keyPattern || {};
  return Boolean(keyPattern.idempotencyKey || keyPattern.userId);
}

/**
 * Place an order using only other modules' front doors.
 *
 * Idempotency: same userId + idempotencyKey returns the existing order.
 *
 * MongoDB transaction (same database: orders_db):
 *   1) insert into `orders`
 *   2) insert into `db_transactions` with that orderId
 * Both commit together, or both roll back.
 *
 * Inventory reserve stays OUTSIDE this transaction (different DB / module).
 * If the transaction fails after reserve, we still releaseStock().
 */
function createOrderService({
  getOrderModel,
  getDbTransactionModel,
  getConnection,
}) {
  async function placeOrder({ userId, items, idempotencyKey }) {
    if (!userId) {
      throw httpError(400, 'userId is required');
    }

    const key =
      typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (!key) {
      throw httpError(400, 'idempotencyKey is required');
    }

    logger.info('orders.placeOrder start', {
      userId: String(userId),
      idempotencyKey: key,
      itemCount: Array.isArray(items) ? items.length : 0,
    });

    const Order = getOrderModel();
    const DbTransaction = getDbTransactionModel();
    const connection = getConnection();

    // Retry path: return the same order, create nothing
    const existing = await Order.findOne({
      userId,
      idempotencyKey: key,
    }).lean();
    if (existing) {
      logger.info('orders.placeOrder replay', {
        orderId: String(existing._id),
        idempotencyKey: key,
      });
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

    // 2. Reserve stock — first step that changes data (outside txn; other DB)
    const toReserve = lines.map(({ productId, quantity }) => ({
      productId,
      quantity,
    }));
    await inventory.reserveStock(toReserve);

    // 3. Transaction: order + db_transactions record (all-or-nothing)
    const session = await connection.startSession();
    let createdOrder;

    try {
      await session.withTransaction(async () => {
        // Array form is required when passing { session }
        const [order] = await Order.create(
          [
            {
              userId: user.userId,
              idempotencyKey: key,
              items: lines,
              totalAmount,
              status: 'PENDING',
              shippingAddress: user.address,
            },
          ],
          { session }
        );

        await DbTransaction.create(
          [
            {
              orderId: order._id,
              userId: user.userId,
              idempotencyKey: key,
              operation: 'ORDER_CREATE',
            },
          ],
          { session }
        );

        createdOrder = order;
      });

      logger.info('orders.placeOrder created', {
        orderId: String(createdOrder._id),
        totalAmount,
        status: createdOrder.status,
      });
      return toOrderDto(createdOrder);
    } catch (err) {
      logger.error('orders.placeOrder failed; releasing stock', {
        message: err.message,
        code: err.code,
      });
      await inventory.releaseStock(toReserve);

      // Concurrent create with same key: other request won — replay it
      if (isIdempotencyDuplicateKeyError(err)) {
        const replay = await Order.findOne({
          userId,
          idempotencyKey: key,
        }).lean();
        if (replay) {
          logger.info('orders.placeOrder concurrent replay', {
            orderId: String(replay._id),
            idempotencyKey: key,
          });
          return toOrderDto(replay, { replayed: true });
        }
      }

      throw err;
    } finally {
      await session.endSession();
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

    logger.info('orders.transitionOrderStatus start', {
      orderId: String(orderId),
      nextStatus,
    });

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

    logger.info('orders.transitionOrderStatus success', {
      orderId: String(updated._id),
      from: order.status,
      to: updated.status,
    });
    return toOrderDto(updated);
  }

  return { placeOrder, transitionOrderStatus };
}

module.exports = { createOrderService };
