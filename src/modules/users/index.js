const { getModuleConnection } = require('../../shared/db/connections');
const { createUserModel } = require('./internal/User');
const { createUserService } = require('./internal/userService');
const { UserNotFoundError } = require('./internal/errors');

let User;
let userService;

function getUserModel() {
  if (!User) {
    throw new Error('Users module not initialized. Call initUsersModule() first.');
  }
  return User;
}

async function initUsersModule() {
  const connection = await getModuleConnection('users');
  User = createUserModel(connection);
  await User.createIndexes();
  userService = createUserService(getUserModel);
  return { connection, User };
}

/**
 * Public API — DTO for placing an order (no email/passwordHash).
 * @returns {{ userId, name, address: { line1, city, pincode } }}
 */
async function getUserForOrder(userId) {
  if (!userService) {
    throw new Error('Users module not initialized. Call initUsersModule() first.');
  }
  return userService.getUserForOrder(userId);
}

module.exports = {
  initUsersModule,
  getUserForOrder,
  UserNotFoundError,
};
