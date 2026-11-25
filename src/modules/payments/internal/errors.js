function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

class PaymentNotFoundError extends Error {
  constructor(orderIdOrPaymentId) {
    super(`Payment not found: ${orderIdOrPaymentId}`);
    this.name = 'PaymentNotFoundError';
    this.code = 'PAYMENT_NOT_FOUND';
    this.status = 404;
  }
}

class PaymentAttemptNotFoundError extends Error {
  constructor(attemptId) {
    super(`Payment attempt not found: ${attemptId}`);
    this.name = 'PaymentAttemptNotFoundError';
    this.code = 'PAYMENT_ATTEMPT_NOT_FOUND';
    this.status = 404;
  }
}

class InvalidPaymentTransitionError extends Error {
  constructor(currentStatus, nextStatus, entity = 'Payment') {
    super(
      `Invalid ${entity} transition: ${String(currentStatus)} → ${String(nextStatus)}`
    );
    this.name = 'InvalidPaymentTransitionError';
    this.code = 'INVALID_PAYMENT_TRANSITION';
    this.status = 409;
    this.currentStatus = currentStatus;
    this.nextStatus = nextStatus;
  }
}

class PaymentConflictError extends Error {
  constructor(message = 'Payment state conflict; retry') {
    super(message);
    this.name = 'PaymentConflictError';
    this.code = 'PAYMENT_CONFLICT';
    this.status = 409;
  }
}

class PaymentAmountMismatchError extends Error {
  constructor() {
    super('Payment amount does not match trusted order total');
    this.name = 'PaymentAmountMismatchError';
    this.code = 'PAYMENT_AMOUNT_MISMATCH';
    this.status = 409;
  }
}

class PaymentOwnershipError extends Error {
  constructor() {
    super('Order does not belong to this user');
    this.name = 'PaymentOwnershipError';
    this.code = 'PAYMENT_OWNERSHIP';
    this.status = 403;
  }
}

function statusFromError(err) {
  if (err.status) return err.status;

  switch (err.code) {
    case 'PAYMENT_NOT_FOUND':
    case 'PAYMENT_ATTEMPT_NOT_FOUND':
    case 'ORDER_NOT_FOUND':
      return 404;
    case 'PAYMENT_OWNERSHIP':
    case 'WEBHOOK_UNAUTHORIZED':
      return 401;
    case 'GATEWAY_STILL_PROCESSING':
    case 'GATEWAY_LEDGER_INVALID':
      return 409;
    case 'INVALID_PAYMENT_TRANSITION':
    case 'PAYMENT_CONFLICT':
    case 'PAYMENT_AMOUNT_MISMATCH':
    case 'ORDER_STATUS_CONFLICT':
    case 'INVALID_ORDER_TRANSITION':
      return 409;
    default:
      return 500;
  }
}

module.exports = {
  httpError,
  statusFromError,
  PaymentNotFoundError,
  PaymentAttemptNotFoundError,
  InvalidPaymentTransitionError,
  PaymentConflictError,
  PaymentAmountMismatchError,
  PaymentOwnershipError,
};