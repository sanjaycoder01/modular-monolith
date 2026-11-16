const { UserNotFoundError } = require('./errors');
const { toUserForOrderDto } = require('./dto/UserForOrderDto');
const { logger } = require('../../../shared/logging/logger');

/**
 * Public-facing user reads for other modules.
 * Field shaping lives in dto/ — not inlined in each API.
 */
function createUserService(getUserModel) {
  async function getUserForOrder(userId) {
    logger.info('users.getUserForOrder start', { userId: String(userId) });

    const User = getUserModel();
    const user = await User.findById(userId).lean();

    if (!user) {
      logger.warn('users.getUserForOrder not found', {
        userId: String(userId),
      });
      throw new UserNotFoundError(userId);
    }

    const dto = toUserForOrderDto(user);
    logger.info('users.getUserForOrder success', {
      userId: String(dto.userId),
    });
    return dto;
  }

  return { getUserForOrder };
}

module.exports = { createUserService };
