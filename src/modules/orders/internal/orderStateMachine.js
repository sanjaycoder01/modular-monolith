const { ORDER_STATUSES } = require('./Order');
const { InvalidOrderTransitionError } = require('./errors');

/**
 * Allowed order status transitions.
 * Final states (DELIVERED, CANCELLED) have no outgoing edges.
 */
const ORDER_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

function isKnownStatus(status) {
  return ORDER_STATUSES.includes(status);
}

/**
 * @param {string} currentStatus
 * @param {string} nextStatus
 * @returns {boolean}
 */
function canTransition(currentStatus, nextStatus) {
  if (!isKnownStatus(currentStatus) || !isKnownStatus(nextStatus)) {
    return false;
  }
  return ORDER_TRANSITIONS[currentStatus].includes(nextStatus);
}

/**
 * @param {string} currentStatus
 * @param {string} nextStatus
 * @throws {InvalidOrderTransitionError}
 */
function assertValidTransition(currentStatus, nextStatus) {
  if (!canTransition(currentStatus, nextStatus)) {
    throw new InvalidOrderTransitionError(currentStatus, nextStatus);
  }
}

module.exports = {
  ORDER_TRANSITIONS,
  canTransition,
  assertValidTransition,
};
