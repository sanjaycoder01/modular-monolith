function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function statusFromError(err) {
  if (err.status) return err.status;

  switch (err.code) {
    case 'USER_NOT_FOUND':
    case 'PRODUCT_NOT_FOUND':
      return 404;
    case 'INSUFFICIENT_STOCK':
      return 409;
    case 'INVALID_STOCK_ITEMS':
      return 400;
    default:
      return 500;
  }
}

module.exports = { httpError, statusFromError };
