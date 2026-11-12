/**
 * Order line snapshot built from Inventory's ProductForOrder DTO.
 *
 * If Inventory renames public DTO fields, update this mapper (and/or
 * ProductForOrderDto) — not every place that saves an order line.
 */
function toOrderItemDto(productDto, quantity) {
  return {
    productId: productDto.productId,
    productName: productDto.name,
    unitPrice: productDto.unitPrice,
    quantity,
  };
}

module.exports = { toOrderItemDto };
