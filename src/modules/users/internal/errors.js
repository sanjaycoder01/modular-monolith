class UserNotFoundError extends Error {
  constructor(userId) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
    this.code = 'USER_NOT_FOUND';
    this.userId = String(userId);
  }
}

module.exports = { UserNotFoundError };
