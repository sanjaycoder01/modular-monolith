const express = require('express');
const { getModuleConnection } = require('../../shared/db/connections');
const { createPaymentModel, PAYMENT_STATUSES } = require('./internal/Payment');
const {
  createPaymentAttemptModel,
  ATTEMPT_STATUSES,
} = require('./internal/PaymentAttempt');
const { createMockGatewayTransactionModel } = require('./internal/MockGatewayTransaction');
const {
  createPaymentOutboxModel,
  OUTBOX_STATUSES,
} = require('./internal/PaymentOutbox');
const { createPaymentService } = require('./internal/paymentService');
const { createPaymentOutboxWorkerFromEnv } = require('./internal/outboxWorker');
const {
  createPaymentReconciliationWorkerFromEnv,
} = require('./internal/paymentReconciliationWorker');
const { statusFromError } = require('./internal/errors');
const { logger } = require('../../shared/logging/logger');

let connection;
let Payment;
let PaymentAttempt;
let PaymentOutbox;
let MockGatewayTransaction;
let paymentService;
let paymentsOutboxWorker;
let paymentsReconciliationWorker;

function getPaymentModel() {
  if (!Payment) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
  return Payment;
}

function getPaymentAttemptModel() {
  if (!PaymentAttempt) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
  return PaymentAttempt;
}

function getPaymentOutboxModel() {
  if (!PaymentOutbox) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
  return PaymentOutbox;
}

function getConnection() {
  if (!connection) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
  return connection;
}

async function dropLegacyPaymentIndexes() {
  try {
    await Payment.collection.dropIndex('orderId_1_attempt_1');
  } catch (err) {
    if (err.codeName !== 'IndexNotFound' && err.code !== 27) {
      throw err;
    }
  }
  try {
    await Payment.collection.dropIndex('orderId_1');
  } catch (err) {
    if (err.codeName !== 'IndexNotFound' && err.code !== 27) {
      throw err;
    }
  }
}

async function initPaymentsModule() {
  connection = await getModuleConnection('payments');
  Payment = createPaymentModel(connection);
  PaymentAttempt = createPaymentAttemptModel(connection);
  PaymentOutbox = createPaymentOutboxModel(connection);
  MockGatewayTransaction = createMockGatewayTransactionModel(connection);

  await dropLegacyPaymentIndexes();

  await Payment.createIndexes();
  await PaymentAttempt.createIndexes();
  await PaymentOutbox.createIndexes();
  await MockGatewayTransaction.createIndexes();

  paymentService = createPaymentService({
    getPaymentModel,
    getPaymentAttemptModel,
    getPaymentOutboxModel,
    getMockGatewayTransactionModel: () => MockGatewayTransaction,
    getConnection,
  });

  paymentsOutboxWorker = createPaymentOutboxWorkerFromEnv(getPaymentOutboxModel);
  paymentsReconciliationWorker = createPaymentReconciliationWorkerFromEnv(
    (options) => paymentService.reconcileStuckPaymentAttempts(options)
  );

  return {
    connection,
    Payment,
    PaymentAttempt,
    PaymentOutbox,
    MockGatewayTransaction,
  };
}

function assertPaymentReady() {
  if (!paymentService) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
}

async function handleOrderCreatedEvent(input) {
  assertPaymentReady();
  return paymentService.handleOrderCreatedEvent(input);
}

async function payNow(input) {
  assertPaymentReady();
  return paymentService.payNow(input);
}

async function reconcilePaymentAttempt(paymentAttemptId) {
  assertPaymentReady();
  return paymentService.reconcilePaymentAttempt(paymentAttemptId);
}

async function handleMockGatewayWebhook(input) {
  assertPaymentReady();
  return paymentService.handleMockGatewayWebhook(input);
}

async function runPaymentsReconciliationOnce() {
  if (!paymentsReconciliationWorker) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
  return paymentsReconciliationWorker.tick();
}

function startPaymentsReconciliationWorker() {
  if (!paymentsReconciliationWorker) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
  const enabled = process.env.PAYMENT_RECONCILE_WORKER_ENABLED;
  if (enabled === '0' || enabled === 'false') {
    logger.info(
      'payments.reconcile.worker disabled via PAYMENT_RECONCILE_WORKER_ENABLED'
    );
    return;
  }
  paymentsReconciliationWorker.start();
}

function stopPaymentsReconciliationWorker() {
  if (paymentsReconciliationWorker) {
    paymentsReconciliationWorker.stop();
  }
}

function startPaymentsOutboxWorker() {
  if (!paymentsOutboxWorker) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
  const enabled = process.env.PAYMENTS_OUTBOX_WORKER_ENABLED;
  if (enabled === '0' || enabled === 'false') {
    logger.info(
      'payments.outbox.worker disabled via PAYMENTS_OUTBOX_WORKER_ENABLED'
    );
    return;
  }
  paymentsOutboxWorker.start();
}

function stopPaymentsOutboxWorker() {
  if (paymentsOutboxWorker) {
    paymentsOutboxWorker.stop();
  }
}

async function runPaymentsOutboxWorkerOnce() {
  if (!paymentsOutboxWorker) {
    throw new Error(
      'Payments module not initialized. Call initPaymentsModule() first.'
    );
  }
  return paymentsOutboxWorker.tick();
}

function registerRoutes(app) {
  const router = express.Router();

  router.post('/pay', async (req, res) => {
    try {
      const idempotencyKey =
        req.get('Idempotency-Key') || req.body?.idempotencyKey;
      logger.info('HTTP POST /payments/pay', {
        orderId: req.body?.orderId,
        userId: req.body?.userId,
        idempotencyKey,
      });
      const result = await payNow({
        orderId: req.body?.orderId,
        userId: req.body?.userId,
        idempotencyKey,
        simulateOutcome: req.body?.simulateOutcome,
      });
      const statusCode = result.replayed ? 200 : 201;
      res.status(statusCode).json(result);
    } catch (err) {
      const status = statusFromError(err);
      logger.error('HTTP POST /payments/pay failed', {
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

  router.post('/webhooks/mock', async (req, res) => {
    try {
      const webhookSecret =
        req.get('X-Webhook-Secret') || req.body?.webhookSecret;
      const gatewayTransactionId =
        req.body?.gatewayTransactionId || req.body?.transactionId;
      const result = await handleMockGatewayWebhook({
        gatewayTransactionId,
        webhookSecret,
      });
      res.json(result);
    } catch (err) {
      const status = statusFromError(err);
      logger.error('HTTP POST /payments/webhooks/mock failed', {
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

  router.post('/attempts/:attemptId/reconcile', async (req, res) => {
    try {
      const result = await reconcilePaymentAttempt(req.params.attemptId);
      res.json(result);
    } catch (err) {
      const status = statusFromError(err);
      res.status(status).json({
        error: err.message,
        code: err.code,
      });
    }
  });

  app.use('/payments', router);
}

module.exports = {
  initPaymentsModule,
  getPaymentModel,
  getPaymentAttemptModel,
  handleOrderCreatedEvent,
  payNow,
  reconcilePaymentAttempt,
  handleMockGatewayWebhook,
  registerRoutes,
  startPaymentsOutboxWorker,
  stopPaymentsOutboxWorker,
  runPaymentsOutboxWorkerOnce,
  startPaymentsReconciliationWorker,
  stopPaymentsReconciliationWorker,
  runPaymentsReconciliationOnce,
  PAYMENT_STATUSES,
  ATTEMPT_STATUSES,
  OUTBOX_STATUSES,
};