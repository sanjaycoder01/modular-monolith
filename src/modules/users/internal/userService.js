const { UserNotFoundError } = require('./errors');
const { toUserForOrderDto } = require('./dto/UserForOrderDto');

/**
 * Public-facing user reads for other modules.
 * Field shaping lives in dto/ — not inlined in each API.
 */
function createUserService(getUserModel) {
  async function getUserForOrder(userId) {
    const User = getUserModel();
    const user = await User.findById(userId).lean();

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    return toUserForOrderDto(user);
  }

  return { getUserForOrder };
}

module.exports = { createUserService };
