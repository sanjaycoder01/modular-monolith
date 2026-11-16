const express = require('express');
const { getModuleConnection } = require('../../shared/db/connections');
const { createOrderModel, ORDER_STATUSES } = require('./internal/Order');
const { createDbTransactionModel } = require('./internal/DbTransaction');
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
const { logger } = require('../../shared/logging/logger');

let connection;
let Order;
let DbTransaction;
let orderService;

function getOrderModel() {
  if (!Order) {
    throw new Error(
      'Orders module not initialized. Call initOrdersModule() first.'
    );
  }
  return Order;
}

function getDbTransactionModel() {
  if (!DbTransaction) {
    throw new Error(
      'Orders module not initialized. Call initOrdersModule() first.'
    );
  }
  return DbTransaction;
}

function getConnection() {
  if (!connection) {
    throw new Error(
      'Orders module not initialized. Call initOrdersModule() first.'
    );
  }
  return connection;
}

async function initOrdersModule() {
  connection = await getModuleConnection('orders');
  Order = createOrderModel(connection);
  DbTransaction = createDbTransactionModel(connection);
  await Order.createIndexes();
  await DbTransaction.createIndexes();
  orderService = createOrderService({
    getOrderModel,
    getDbTransactionModel,
    getConnection,
  });
  return { connection, Order, DbTransaction };
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
      logger.info('HTTP POST /orders', {
        userId: req.body?.userId,
        idempotencyKey,
      });
      const order = await placeOrder({ ...req.body, idempotencyKey });
      const statusCode = order.replayed ? 200 : 201;
      logger.info('HTTP POST /orders success', {
        orderId: String(order.orderId),
        statusCode,
        replayed: Boolean(order.replayed),
      });
      res.status(statusCode).json(order);
    } catch (err) {
      const status = statusFromError(err);
      logger.error('HTTP POST /orders failed', {
        status,
        message: err.message,
        code: err.code,
      });
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
