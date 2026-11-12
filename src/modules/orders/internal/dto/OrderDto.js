/**
 * Public shape returned from Orders APIs.
 * Maps the owned order document → response DTO in one place.
 */
function toOrderDto(order) {
  const doc = typeof order.toObject === 'function' ? order.toObject() : order;

  return {
    orderId: doc._id,
    userId: doc.userId,
    items: doc.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
    })),
    totalAmount: doc.totalAmount,
    status: doc.status,
    shippingAddress: {
      line1: doc.shippingAddress.line1,
      city: doc.shippingAddress.city,
      pincode: doc.shippingAddress.pincode,
    },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

module.exports = { toOrderDto };
