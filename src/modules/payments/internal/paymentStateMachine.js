const { PAYMENT_STATUSES } = require('./Payment');
const { ATTEMPT_STATUSES } = require('./PaymentAttempt');
const { InvalidPaymentTransitionError } = require('./errors');

const PAYMENT_TRANSITIONS = {
  CREATED: ['IN_PROGRESS'],
  IN_PROGRESS: ['CREATED', 'SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
};

const ATTEMPT_TRANSITIONS = {
  INITIATED: ['PROCESSING'],
  PROCESSING: ['SUCCEEDED', 'FAILED', 'TIMEOUT', 'UNKNOWN'],
  SUCCEEDED: [],
  FAILED: [],
  TIMEOUT: [],
  UNKNOWN: [],
};

function assertPaymentTransition(current, next) {
  if (
    !PAYMENT_STATUSES.includes(current) ||
    !PAYMENT_STATUSES.includes(next)
  ) {
    throw new InvalidPaymentTransitionError(current, next);
  }
  if (!PAYMENT_TRANSITIONS[current].includes(next)) {
    throw new InvalidPaymentTransitionError(current, next);
  }
}

function assertAttemptTransition(current, next) {
  if (
    !ATTEMPT_STATUSES.includes(current) ||
    !ATTEMPT_STATUSES.includes(next)
  ) {
    throw new InvalidPaymentTransitionError(current, next, 'PaymentAttempt');
  }
  if (!ATTEMPT_TRANSITIONS[current].includes(next)) {
    throw new InvalidPaymentTransitionError(current, next, 'PaymentAttempt');
  }
}

function canStartPayAttempt(paymentStatus) {
  return paymentStatus === 'CREATED' || paymentStatus === 'IN_PROGRESS';
}

module.exports = {
  PAYMENT_TRANSITIONS,
  ATTEMPT_TRANSITIONS,
  assertPaymentTransition,
  assertAttemptTransition,
  canStartPayAttempt,
};