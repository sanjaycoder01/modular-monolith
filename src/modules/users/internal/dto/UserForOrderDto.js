/**
 * Public contract for other modules that need a user at order time.
 *
 * When you rename/add/remove a *published* field on the users collection,
 * update ONLY this mapper. Services call toUserForOrderDto() and stay unchanged.
 *
 * Private fields (email, passwordHash, phone, …) are intentionally omitted.
 */
function toUserForOrderDto(user) {
  return {
    userId: user._id,
    name: user.name,
    address: toAddressDto(user.address),
  };
}

function toAddressDto(address) {
  return {
    line1: address.line1,
    city: address.city,
    pincode: address.pincode,
  };
}

module.exports = { toUserForOrderDto, toAddressDto };
