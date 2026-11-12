const { UserNotFoundError } = require('./errors');

/**
 * Public-facing user reads for other modules.
 * Always return a small DTO — never the raw mongoose document.
 */
function createUserService(getUserModel) {
  async function getUserForOrder(userId) {
    const User = getUserModel();
    const user = await User.findById(userId).lean();

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    return {
      userId: user._id,
      name: user.name,
      address: {
        line1: user.address.line1,
        city: user.address.city,
        pincode: user.address.pincode,
      },
    };
  }

  return { getUserForOrder };
}

module.exports = { createUserService };
