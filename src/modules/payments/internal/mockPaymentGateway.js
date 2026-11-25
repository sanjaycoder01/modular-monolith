const crypto = require('crypto');
const { logger } = require('../../../shared/logging/logger');
const { GATEWAY_OUTCOMES } = require('./MockGatewayTransaction');

const DEFAULT_DELAY_MS = 0;

function readNonNegativeInt(envValue, fallback) {
  const n = Number(envValue);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function resolveOutcome(simulateOutcome) {
  const configured = process.env.MOCK_GATEWAY_DEFAULT_OUTCOME;
  const raw = simulateOutcome || configured || 'SUCCESS';
  const upper = String(raw).toUpperCase();
  if (!GATEWAY_OUTCOMES.includes(upper)) {
    return 'SUCCESS';
  }
  return upper;
}

function newGatewayTransactionId() {
  return `mock_${crypto.randomUUID()}`;
}

/**
 * Simulated PSP: writes a ledger row first, then returns an outcome.
 * DELAYED_RESPONSE waits MOCK_GATEWAY_DELAY_MS then applies resolved base outcome.
 *
 * @param {{
 *   getMockGatewayTransactionModel: () => import('mongoose').Model,
 *   paymentId: any,
 *   paymentAttemptId: any,
 *   orderId: any,
 *   amount: number,
 *   simulateOutcome?: string | null,
 * }} input
 */
async function processMockPayment(input) {
  const MockGatewayTransaction = input.getMockGatewayTransactionModel();
  const gatewayTransactionId = newGatewayTransactionId();
  const requested = resolveOutcome(input.simulateOutcome);

  await MockGatewayTransaction.create([
    {
      gatewayTransactionId,
      paymentId: input.paymentId,
      paymentAttemptId: input.paymentAttemptId,
      orderId: input.orderId,
      amount: input.amount,
      requestedOutcome: requested,
      status: 'PROCESSING',
    },
  ]);

  logger.info('payments.mockGateway processing', {
    gatewayTransactionId,
    paymentAttemptId: String(input.paymentAttemptId),
    requestedOutcome: requested,
  });

  let effectiveOutcome = requested;
  const delayMs = readNonNegativeInt(
    process.env.MOCK_GATEWAY_DELAY_MS,
    DEFAULT_DELAY_MS
  );

  if (requested === 'DELAYED_RESPONSE') {
    const waitMs = delayMs > 0 ? delayMs : 1500;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    effectiveOutcome = resolveOutcome(null);
  } else if (requested === 'TIMEOUT') {
    await MockGatewayTransaction.findOneAndUpdate(
      { gatewayTransactionId },
      {
        $set: {
          status: 'TIMEOUT',
          completedAt: new Date(),
          failureReason: 'gateway timeout (simulated)',
        },
      }
    );
    return {
      gatewayTransactionId,
      outcome: 'TIMEOUT',
      failureReason: 'gateway timeout (simulated)',
    };
  }

  if (effectiveOutcome === 'UNKNOWN') {
    await MockGatewayTransaction.findOneAndUpdate(
      { gatewayTransactionId },
      {
        $set: {
          status: 'UNKNOWN',
          completedAt: new Date(),
        },
      }
    );
    return { gatewayTransactionId, outcome: 'UNKNOWN' };
  }

  if (effectiveOutcome === 'SUCCESS') {
    await MockGatewayTransaction.findOneAndUpdate(
      { gatewayTransactionId },
      {
        $set: {
          status: 'SUCCESS',
          completedAt: new Date(),
        },
      }
    );
    return { gatewayTransactionId, outcome: 'SUCCESS' };
  }

  const failureReason =
    effectiveOutcome === 'FAILED'
      ? 'card declined (simulated)'
      : 'gateway error (simulated)';

  await MockGatewayTransaction.findOneAndUpdate(
    { gatewayTransactionId },
    {
      $set: {
        status: 'FAILED',
        completedAt: new Date(),
        failureReason,
      },
    }
  );

  return {
    gatewayTransactionId,
    outcome: 'FAILED',
    failureReason,
  };
}

/**
 * Re-read ledger — source of truth after crashes.
 * @param {string} gatewayTransactionId
 * @param {() => import('mongoose').Model} getMockGatewayTransactionModel
 */
async function getLedgerByGatewayTransactionId(
  gatewayTransactionId,
  getMockGatewayTransactionModel
) {
  const MockGatewayTransaction = getMockGatewayTransactionModel();
  return MockGatewayTransaction.findOne({ gatewayTransactionId }).lean();
}

module.exports = {
  processMockPayment,
  getLedgerByGatewayTransactionId,
  newGatewayTransactionId,
  resolveOutcome,
};