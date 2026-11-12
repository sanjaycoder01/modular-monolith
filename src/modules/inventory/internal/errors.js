class ProductNotFoundError extends Error {
  constructor(productId) {
    super(`Product not found: ${productId}`);
    this.name = 'ProductNotFoundError';
    this.code = 'PRODUCT_NOT_FOUND';
    this.productId = String(productId);
  }
}

class InsufficientStockError extends Error {
  constructor(productId, quantity) {
    super(
      `Insufficient stock for product ${productId} (requested ${quantity})`
    );
    this.name = 'InsufficientStockError';
    this.code = 'INSUFFICIENT_STOCK';
    this.productId = String(productId);
    this.quantity = quantity;
  }
}

class InvalidStockItemsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidStockItemsError';
    this.code = 'INVALID_STOCK_ITEMS';
  }
}

module.exports = {
  ProductNotFoundError,
  InsufficientStockError,
  InvalidStockItemsError,
};
