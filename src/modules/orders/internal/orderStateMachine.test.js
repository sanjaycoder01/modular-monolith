const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ORDER_TRANSITIONS,
  canTransition,
  assertValidTransition,
} = require('./orderStateMachine');
const { InvalidOrderTransitionError } = require('./errors');
const { ORDER_STATUSES } = require('./Order');

describe('orderStateMachine', () => {
  const allowed = [
    ['PENDING', 'CONFIRMED'],
    ['PENDING', 'CANCELLED'],
    ['CONFIRMED', 'SHIPPED'],
    ['CONFIRMED', 'CANCELLED'],
    ['SHIPPED', 'DELIVERED'],
  ];

  for (const [from, to] of allowed) {
    it(`allows ${from} → ${to}`, () => {
      assert.equal(canTransition(from, to), true);
      assert.doesNotThrow(() => assertValidTransition(from, to));
    });
  }

  const invalid = [
    ['PENDING', 'SHIPPED'],
    ['PENDING', 'DELIVERED'],
    ['CONFIRMED', 'PENDING'],
    ['CONFIRMED', 'DELIVERED'],
    ['SHIPPED', 'PENDING'],
    ['SHIPPED', 'CONFIRMED'],
    ['SHIPPED', 'CANCELLED'],
    ['DELIVERED', 'PENDING'],
    ['DELIVERED', 'CONFIRMED'],
    ['DELIVERED', 'SHIPPED'],
    ['DELIVERED', 'CANCELLED'],
    ['CANCELLED', 'PENDING'],
    ['CANCELLED', 'CONFIRMED'],
    ['CANCELLED', 'SHIPPED'],
    ['CANCELLED', 'DELIVERED'],
  ];

  for (const [from, to] of invalid) {
    it(`rejects ${from} → ${to}`, () => {
      assert.equal(canTransition(from, to), false);
      assert.throws(
        () => assertValidTransition(from, to),
        (err) => {
          assert.equal(err.name, 'InvalidOrderTransitionError');
          assert.equal(err.code, 'INVALID_ORDER_TRANSITION');
          assert.equal(err.status, 409);
          assert.ok(err instanceof InvalidOrderTransitionError);
          return true;
        }
      );
    });
  }

  it('rejects unknown current status', () => {
    assert.equal(canTransition('PAID', 'CONFIRMED'), false);
    assert.equal(canTransition('UNKNOWN', 'CANCELLED'), false);
  });

  it('rejects unknown next status', () => {
    assert.equal(canTransition('PENDING', 'PAID'), false);
    assert.equal(canTransition('PENDING', 'UNKNOWN'), false);
  });

  it('final states have no outgoing transitions', () => {
    assert.deepEqual(ORDER_TRANSITIONS.DELIVERED, []);
    assert.deepEqual(ORDER_TRANSITIONS.CANCELLED, []);
  });

  it('ORDER_TRANSITIONS keys match ORDER_STATUSES', () => {
    assert.deepEqual(
      Object.keys(ORDER_TRANSITIONS).sort(),
      [...ORDER_STATUSES].sort()
    );
  });
});
