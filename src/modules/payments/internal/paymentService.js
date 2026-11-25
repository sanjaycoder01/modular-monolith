const { logger } = require('../../../shared/logging/logger');
const {
  httpError,
  PaymentNotFoundError,
  PaymentAttemptNotFoundError,
  PaymentConflictError,
  PaymentAmountMismatchError,
  PaymentOwnershipError,
} = require('./errors');
const {
  processMockPayment,
  getLedgerByGatewayTransactionId,
} = require('./mockPaymentGateway');

function readMaxAttempts() {
  const n = Number(process.env.PAYMENT_MAX_ATTEMPTS);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.floor(n);
}

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

function toPaymentDto(payment, extras = {}) {
  const doc =
    typeof payment.toObject === 'function' ? payment.toObject() : payment;
  const dto = {
    paymentId: doc._id,
    orderId: doc.orderId,
    userId: doc.userId,
    amount: doc.amount,
    currency: doc.currency,
    status: doc.status,
    attemptCount: doc.attemptCount,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...extras,
  };
  if (doc.replayed) dto.replayed = true;
  return dto;
}

function attemptToPlain(attempt) {
  return typeof attempt.toObject === 'function' ? attempt.toObject() : attempt;
}

function toPaymentAttemptDto(attempt, extras = {}) {
  const doc = attemptToPlain(attempt);
  const dto = {
    paymentAttemptId: doc._id,
    paymentId: doc.paymentId,
    orderId: doc.orderId,
    userId: doc.userId,
    attemptNumber: doc.attemptNumber,
    amount: doc.amount,
    gateway: doc.gateway,
    gatewayTransactionId: doc.gatewayTransactionId,
    status: doc.status,
    failureReason: doc.failureReason,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...extras,
  };
  if (doc.replayed) dto.replayed = true;
  return dto;
}

function mapGatewayOutcomeToAttemptStatus(outcome) {
  switch (outcome) {
    case 'SUCCESS':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'UNKNOWN':
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}

function createPaymentService(deps) {
  const getPaymentModel = deps.getPaymentModel;
  const getPaymentAttemptModel = deps.getPaymentAttemptModel;
  const getPaymentOutboxModel = deps.getPaymentOutboxModel;
  const getMockGatewayTransactionModel = deps.getMockGatewayTransactionModel;
  const getConnection = deps.getConnection;

  async function handleOrderCreatedEvent({ orderId, userId, totalAmount }) {
    if (orderId == null) {
      throw new Error('orderId is required');
    }
    if (userId == null) {
      throw new Error('userId is required');
    }
    if (!Number.isSafeInteger(totalAmount) || totalAmount < 0) {
      throw new Error('totalAmount must be a non-negative safe integer in paise');
    }

    logger.info('payments.handleOrderCreatedEvent start', {
      orderId: String(orderId),
      userId: String(userId),
      totalAmount,
    });

    const Payment = getPaymentModel();
    const existing = await Payment.findOne({ orderId }).lean();
    if (existing) {
      logger.info('payments.handleOrderCreatedEvent replay', {
        orderId: String(orderId),
        paymentId: String(existing._id),
      });
      return toPaymentDto({ ...existing, replayed: true });
    }

    try {
      const [payment] = await Payment.create([
        {
          orderId,
          userId,
          amount: totalAmount,
          currency: 'INR',
          status: 'CREATED',
          attemptCount: 0,
        },
      ]);

      logger.info('payments.handleOrderCreatedEvent created', {
        orderId: String(orderId),
        paymentId: String(payment._id),
      });
      return toPaymentDto(payment);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const replay = await Payment.findOne({ orderId }).lean();
        if (replay) {
          return toPaymentDto({ ...replay, replayed: true });
        }
      }
      logger.error('payments.handleOrderCreatedEvent failed', {
        orderId: String(orderId),
        message: err.message,
      });
      throw err;
    }
  }

  async function findAttemptByIdempotency(paymentId, clientIdempotencyKey) {
    const PaymentAttempt = getPaymentAttemptModel();
    return PaymentAttempt.findOne({ paymentId, clientIdempotencyKey }).lean();
  }

  /**
   * Atomically move payment to IN_PROGRESS and insert INITIATED attempt.
   */
  async function createAttemptRecord({
    payment,
    userId,
    orderId,
    amount,
    idempotencyKey,
    simulateOutcome,
  }) {
    const Payment = getPaymentModel();
    const PaymentAttempt = getPaymentAttemptModel();
    const connection = getConnection();
    const session = await connection.startSession();
    let attempt;

    try {
      await session.withTransaction(async () => {
        const attemptNumber = payment.attemptCount + 1;
        const lock = await Payment.findOneAndUpdate(
          {
            _id: payment._id,
            status: 'CREATED',
          },
          {
            $set: { status: 'IN_PROGRESS' },
            $inc: { attemptCount: 1 },
          },
          { session, returnDocument: 'after' }
        );

        if (!lock) {
          const latest = await Payment.findById(payment._id).session(session).lean();
          if (!latest) {
            throw new PaymentNotFoundError(payment._id);
          }
          if (latest.status === 'SUCCEEDED' || latest.status === 'FAILED') {
            throw httpError(
              409,
              `Payment already terminal: ${latest.status}`,
              'PAYMENT_CONFLICT'
            );
          }
          throw new PaymentConflictError();
        }

        const [created] = await PaymentAttempt.create(
          [
            {
              paymentId: payment._id,
              orderId,
              userId,
              attemptNumber,
              amount,
              gateway: 'MOCK',
              clientIdempotencyKey: idempotencyKey,
              status: 'INITIATED',
              simulateOutcome: simulateOutcome || null,
            },
          ],
          { session }
        );
        attempt = created;
      });
    } finally {
      await session.endSession();
    }

    await PaymentAttempt.findByIdAndUpdate(attempt._id, {
      $set: { status: 'PROCESSING' },
    });
    attempt.status = 'PROCESSING';
    return attempt;
  }

  async function finalizeSuccess({
    paymentId,
    attemptId,
    orderId,
    userId,
    amount,
    gatewayTransactionId,
  }) {
    const Payment = getPaymentModel();
    const PaymentAttempt = getPaymentAttemptModel();
    const PaymentOutbox = getPaymentOutboxModel();
    const connection = getConnection();
    const session = await connection.startSession();

    try {
      await session.withTransaction(async () => {
        const attemptUpdated = await PaymentAttempt.findOneAndUpdate(
          { _id: attemptId, status: { $in: ['PROCESSING', 'UNKNOWN', 'TIMEOUT'] } },
          {
            $set: {
              status: 'SUCCEEDED',
              gatewayTransactionId,
              failureReason: null,
            },
          },
          { session, returnDocument: 'after' }
        );
        if (!attemptUpdated) {
          const terminal = await PaymentAttempt.findById(attemptId)
            .session(session)
            .lean();
          if (terminal?.status === 'SUCCEEDED') {
            return;
          }
          throw new PaymentConflictError();
        }

        const paymentUpdated = await Payment.findOneAndUpdate(
          { _id: paymentId, status: { $in: ['IN_PROGRESS', 'CREATED'] } },
          { $set: { status: 'SUCCEEDED' } },
          { session, returnDocument: 'after' }
        );
        if (!paymentUpdated) {
          const latest = await Payment.findById(paymentId).session(session).lean();
          if (latest?.status !== 'SUCCEEDED') {
            throw new PaymentConflictError();
          }
        }

        await PaymentOutbox.create(
          [
            {
              eventType: 'PaymentSucceeded',
              aggregateType: 'Payment',
              aggregateId: paymentId,
              orderId,
              userId,
              payload: { amount, gatewayTransactionId },
              status: 'PENDING',
              attempts: 0,
            },
          ],
          { session }
        );
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        logger.info('payments.finalizeSuccess outbox replay', {
          paymentId: String(paymentId),
        });
        return;
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async function finalizeFailure({
    paymentId,
    attemptId,
    orderId,
    userId,
    amount,
    gatewayTransactionId,
    failureReason,
    attemptNumber,
    maxAttempts,
  }) {
    const Payment = getPaymentModel();
    const PaymentAttempt = getPaymentAttemptModel();
    const PaymentOutbox = getPaymentOutboxModel();
    const connection = getConnection();

    const retryable = attemptNumber < maxAttempts;
    const paymentStatus = retryable ? 'CREATED' : 'FAILED';
    const session = await connection.startSession();

    try {
      await session.withTransaction(async () => {
        await PaymentAttempt.findOneAndUpdate(
          { _id: attemptId, status: { $in: ['PROCESSING', 'UNKNOWN', 'TIMEOUT'] } },
          {
            $set: {
              status: 'FAILED',
              gatewayTransactionId: gatewayTransactionId || null,
              failureReason,
            },
          },
          { session }
        );

        await Payment.findOneAndUpdate(
          { _id: paymentId, status: 'IN_PROGRESS' },
          { $set: { status: paymentStatus } },
          { session }
        );

        if (!retryable) {
          await PaymentOutbox.create(
            [
              {
                eventType: 'PaymentFailed',
                aggregateType: 'Payment',
                aggregateId: paymentId,
                orderId,
                userId,
                payload: { amount, reason: failureReason },
                status: 'PENDING',
                attempts: 0,
              },
            ],
            { session }
          );
        }
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return;
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async function finalizeTimeoutOrUnknown({
    paymentId,
    attemptId,
    attemptStatus,
    gatewayTransactionId,
  }) {
    const PaymentAttempt = getPaymentAttemptModel();
    const Payment = getPaymentModel();

    await PaymentAttempt.findOneAndUpdate(
      { _id: attemptId },
      {
        $set: {
          status: attemptStatus,
          gatewayTransactionId: gatewayTransactionId || null,
        },
      }
    );

    await Payment.findOneAndUpdate(
      { _id: paymentId, status: 'IN_PROGRESS' },
      { $set: { status: 'CREATED' } }
    );
  }

  async function applyGatewayResult(payment, attempt, gatewayResult) {
    const attemptStatus = mapGatewayOutcomeToAttemptStatus(
      gatewayResult.outcome
    );

    if (gatewayResult.outcome === 'SUCCESS') {
      await finalizeSuccess({
        paymentId: payment._id,
        attemptId: attempt._id,
        orderId: payment.orderId,
        userId: payment.userId,
        amount: payment.amount,
        gatewayTransactionId: gatewayResult.gatewayTransactionId,
      });
      return toPaymentAttemptDto({
        ...attemptToPlain(attempt),
        status: 'SUCCEEDED',
        gatewayTransactionId: gatewayResult.gatewayTransactionId,
      });
    }

    if (gatewayResult.outcome === 'FAILED') {
      const maxAttempts = readMaxAttempts();
      await finalizeFailure({
        paymentId: payment._id,
        attemptId: attempt._id,
        orderId: payment.orderId,
        userId: payment.userId,
        amount: payment.amount,
        gatewayTransactionId: gatewayResult.gatewayTransactionId,
        failureReason: gatewayResult.failureReason,
        attemptNumber: attempt.attemptNumber,
        maxAttempts,
      });
      return toPaymentAttemptDto({
        ...attemptToPlain(attempt),
        status: 'FAILED',
        gatewayTransactionId: gatewayResult.gatewayTransactionId,
        failureReason: gatewayResult.failureReason,
      });
    }

    await finalizeTimeoutOrUnknown({
      paymentId: payment._id,
      attemptId: attempt._id,
      attemptStatus,
      gatewayTransactionId: gatewayResult.gatewayTransactionId,
    });

    return toPaymentAttemptDto({
      ...attemptToPlain(attempt),
      status: attemptStatus,
      gatewayTransactionId: gatewayResult.gatewayTransactionId,
    });
  }

  /**
   * Pay Now — trusted amount from Orders API; idempotent on Idempotency-Key.
   */
  async function payNow({ orderId, userId, idempotencyKey, simulateOutcome }) {
    if (!orderId) {
      throw httpError(400, 'orderId is required');
    }
    if (!userId) {
      throw httpError(400, 'userId is required');
    }
    const key =
      typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (!key) {
      throw httpError(400, 'idempotencyKey is required');
    }

    logger.info('payments.payNow start', {
      orderId: String(orderId),
      userId: String(userId),
      idempotencyKey: key,
    });

    const Payment = getPaymentModel();
    const payment = await Payment.findOne({ orderId }).lean();
    if (!payment) {
      throw new PaymentNotFoundError(orderId);
    }

    if (String(payment.userId) !== String(userId)) {
      throw new PaymentOwnershipError();
    }

    const existingAttempt = await findAttemptByIdempotency(payment._id, key);
    if (existingAttempt) {
      logger.info('payments.payNow idempotency replay', {
        paymentAttemptId: String(existingAttempt._id),
      });
      return toPaymentAttemptDto({ ...existingAttempt, replayed: true });
    }

    const orders = require('../../orders');
    const order = await orders.getOrderForPayment(orderId, userId);
    if (order.status !== 'PENDING') {
      throw httpError(
        409,
        `Order is not payable in status ${order.status}`,
        'ORDER_NOT_PAYABLE'
      );
    }

    if (payment.amount !== order.totalAmount) {
      throw new PaymentAmountMismatchError();
    }

    if (payment.status === 'SUCCEEDED') {
      throw httpError(409, 'Payment already succeeded', 'PAYMENT_ALREADY_PAID');
    }
    if (payment.status === 'FAILED') {
      throw httpError(409, 'Payment failed; no more attempts', 'PAYMENT_NOT_PAYABLE');
    }
    if (payment.status === 'IN_PROGRESS') {
      throw new PaymentConflictError(
        'Payment attempt already in progress; retry with the same Idempotency-Key'
      );
    }
    if (payment.status !== 'CREATED') {
      throw httpError(409, 'Payment is not payable', 'PAYMENT_NOT_PAYABLE');
    }

    let attempt;
    try {
      attempt = await createAttemptRecord({
        payment,
        userId,
        orderId,
        amount: payment.amount,
        idempotencyKey: key,
        simulateOutcome,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const replay = await findAttemptByIdempotency(payment._id, key);
        if (replay) {
          return toPaymentAttemptDto({ ...replay, replayed: true });
        }
      }
      throw err;
    }

    const gatewayResult = await processMockPayment({
      getMockGatewayTransactionModel,
      paymentId: payment._id,
      paymentAttemptId: attempt._id,
      orderId,
      amount: payment.amount,
      simulateOutcome,
    });

    return applyGatewayResult(payment, attempt, gatewayResult);
  }

  async function reconcilePaymentAttempt(paymentAttemptId) {
    const PaymentAttempt = getPaymentAttemptModel();
    const attempt = await PaymentAttempt.findById(paymentAttemptId).lean();
    if (!attempt) {
      throw new PaymentAttemptNotFoundError(paymentAttemptId);
    }

    const ledgerId = attempt.gatewayTransactionId;
    if (!ledgerId) {
      throw httpError(
        409,
        'Attempt has no gatewayTransactionId to reconcile',
        'PAYMENT_RECONCILE_MISSING_GW_ID'
      );
    }

    const ledger = await getLedgerByGatewayTransactionId(
      ledgerId,
      getMockGatewayTransactionModel
    );
    if (!ledger) {
      throw httpError(404, 'Gateway ledger row not found', 'GATEWAY_LEDGER_NOT_FOUND');
    }

    const Payment = getPaymentModel();
    const payment = await Payment.findById(attempt.paymentId).lean();
    if (!payment) {
      throw new PaymentNotFoundError(attempt.paymentId);
    }

    const gatewayResult = {
      gatewayTransactionId: ledger.gatewayTransactionId,
      outcome:
        ledger.status === 'SUCCESS'
          ? 'SUCCESS'
          : ledger.status === 'FAILED'
            ? 'FAILED'
            : ledger.status,
      failureReason: ledger.failureReason,
    };

    return applyGatewayResult(payment, attempt, gatewayResult);
  }

  return {
    handleOrderCreatedEvent,
    payNow,
    reconcilePaymentAttempt,
    toPaymentDto,
    toPaymentAttemptDto,
  };
}

module.exports = { createPaymentService, toPaymentDto, toPaymentAttemptDto };