const express = require('express');
const { getModuleConnection } = require('../../shared/db/connections');
const { createOrderModel, ORDER_STATUSES } = require('./internal/Order');
const { createOrderService } = require('./internal/orderService');
const {
  statusFromError,
  OrderNotFoundError,
  InvalidOrderTransitionError,
  OrderStatusConflictError,
} = require('./internal/errors');
const {
  ORDER_TRANSITIONS,
  canTransition,
} = require('./internal/orderStateMachine');

let Order;
let orderService;

function getOrderModel() {
  if (!Order) {
    throw new Error(
      'Orders module not initialized. Call initOrdersModule() first.'
    );
  }
  return Order;
}

async function initOrdersModule() {
  const connection = await getModuleConnection('orders');
  Order = createOrderModel(connection);
  await Order.createIndexes();
  orderService = createOrderService(getOrderModel);
  return { connection, Order };
}

function assertReady() {
  if (!orderService) {
    throw new Error(
      'Orders module not initialized. Call initOrdersModule() first.'
    );
  }
}

async function placeOrder(input) {
  assertReady();
  return orderService.placeOrder(input);
}

/**
 * Public API — advance an order through the owned state machine.
 * @param {string|import('mongoose').Types.ObjectId} orderId
 * @param {string} nextStatus
 */
async function transitionOrderStatus(orderId, nextStatus) {
  assertReady();
  return orderService.transitionOrderStatus(orderId, nextStatus);
}

function registerRoutes(app) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const idempotencyKey =
        req.get('Idempotency-Key') || req.body?.idempotencyKey;
      const order = await placeOrder({ ...req.body, idempotencyKey });
      const statusCode = order.replayed ? 200 : 201;
      res.status(statusCode).json(order);
    } catch (err) {
      const status = statusFromError(err);
      res.status(status).json({
        error: err.message,
        code: err.code,
      });
    }
  });

  app.use('/orders', router);
}

module.exports = {
  initOrdersModule,
  placeOrder,
  transitionOrderStatus,
  registerRoutes,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  canTransition,
  OrderNotFoundError,
  InvalidOrderTransitionError,
  OrderStatusConflictError,
};
