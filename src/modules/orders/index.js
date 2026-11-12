const express = require('express');
const { getModuleConnection } = require('../../shared/db/connections');
const { createOrderModel } = require('./internal/Order');
const { createOrderService } = require('./internal/orderService');
const { statusFromError } = require('./internal/errors');

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

async function placeOrder(input) {
  if (!orderService) {
    throw new Error(
      'Orders module not initialized. Call initOrdersModule() first.'
    );
  }
  return orderService.placeOrder(input);
}

function registerRoutes(app) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const order = await placeOrder(req.body);
      res.status(201).json(order);
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
  registerRoutes,
};
