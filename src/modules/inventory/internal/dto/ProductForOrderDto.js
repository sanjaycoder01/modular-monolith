/**
 * Public contract for other modules that need a product at order time.
 *
 * Collection field `price` is published as `unitPrice`.
 * When inventory schema names change, update ONLY this mapper.
 *
 * Stock fields (total, sold, remaining) stay private — use reserveStock/releaseStock.
 */
function toProductForOrderDto(product) {
  return {
    productId: product._id,
    name: product.name,
    unitPrice: product.price,
  };
}

module.exports = { toProductForOrderDto };
