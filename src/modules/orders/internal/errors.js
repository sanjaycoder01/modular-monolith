function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

class OrderNotFoundError extends Error {
  constructor(orderId) {
    super(`Order not found: ${orderId}`);
    this.name = 'OrderNotFoundError';
    this.code = 'ORDER_NOT_FOUND';
    this.status = 404;
    this.orderId = String(orderId);
  }
}

class InvalidOrderTransitionError extends Error {
  constructor(currentStatus, nextStatus) {
    super(
      `Invalid order transition: ${String(currentStatus)} → ${String(nextStatus)}`
    );
    this.name = 'InvalidOrderTransitionError';
    this.code = 'INVALID_ORDER_TRANSITION';
    this.status = 409;
    this.currentStatus = currentStatus;
    this.nextStatus = nextStatus;
  }
}

class OrderStatusConflictError extends Error {
  constructor(orderId) {
    super(
      `Order status changed concurrently; retry the transition: ${orderId}`
    );
    this.name = 'OrderStatusConflictError';
    this.code = 'ORDER_STATUS_CONFLICT';
    this.status = 409;
    this.orderId = String(orderId);
  }
}

function statusFromError(err) {
  if (err.status) return err.status;

  switch (err.code) {
    case 'USER_NOT_FOUND':
    case 'PRODUCT_NOT_FOUND':
    case 'ORDER_NOT_FOUND':
      return 404;
    case 'INSUFFICIENT_STOCK':
    case 'INVALID_ORDER_TRANSITION':
    case 'ORDER_STATUS_CONFLICT':
      return 409;
    case 'INVALID_STOCK_ITEMS':
      return 400;
    default:
      return 500;
  }
}

module.exports = {
  httpError,
  statusFromError,
  OrderNotFoundError,
  InvalidOrderTransitionError,
  OrderStatusConflictError,
};
