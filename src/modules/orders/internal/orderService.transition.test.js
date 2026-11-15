const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { disconnectAll } = require('../../../shared/db/connections');
const {
  initOrdersModule,
  transitionOrderStatus,
} = require('../index');

function buildOrderDoc(overrides = {}) {
  return {
    userId: new mongoose.Types.ObjectId(),
    idempotencyKey: `test-${new mongoose.Types.ObjectId()}`,
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        productName: 'Test Widget',
        unitPrice: 49900,
        quantity: 1,
      },
    ],
    totalAmount: 49900,
    status: 'PENDING',
    shippingAddress: {
      line1: '1 Test Lane',
      city: 'Pune',
      pincode: '411001',
    },
    ...overrides,
  };
}

describe('transitionOrderStatus', () => {
  let Order;

  before(async () => {
    ({ Order } = await initOrdersModule());
  });

  after(async () => {
    await disconnectAll();
  });

  it('successfully transitions PENDING → CONFIRMED', async () => {
    const created = await Order.create(buildOrderDoc());
    const dto = await transitionOrderStatus(created._id, 'CONFIRMED');

    assert.equal(dto.status, 'CONFIRMED');
    assert.equal(String(dto.orderId), String(created._id));

    const stored = await Order.findById(created._id).lean();
    assert.equal(stored.status, 'CONFIRMED');

    await Order.deleteOne({ _id: created._id });
  });

  it('walks the full happy path PENDING → CONFIRMED → SHIPPED → DELIVERED', async () => {
    const created = await Order.create(buildOrderDoc());

    await transitionOrderStatus(created._id, 'CONFIRMED');
    await transitionOrderStatus(created._id, 'SHIPPED');
    const dto = await transitionOrderStatus(created._id, 'DELIVERED');

    assert.equal(dto.status, 'DELIVERED');
    await Order.deleteOne({ _id: created._id });
  });

  it('allows PENDING → CANCELLED', async () => {
    const created = await Order.create(buildOrderDoc());
    const dto = await transitionOrderStatus(created._id, 'CANCELLED');
    assert.equal(dto.status, 'CANCELLED');
    await Order.deleteOne({ _id: created._id });
  });

  it('rejects invalid transition PENDING → DELIVERED', async () => {
    const created = await Order.create(buildOrderDoc());

    await assert.rejects(
      () => transitionOrderStatus(created._id, 'DELIVERED'),
      (err) => {
        assert.equal(err.code, 'INVALID_ORDER_TRANSITION');
        assert.equal(err.status, 409);
        return true;
      }
    );

    const stored = await Order.findById(created._id).lean();
    assert.equal(stored.status, 'PENDING');
    await Order.deleteOne({ _id: created._id });
  });

  it('rejects transition from final state DELIVERED', async () => {
    const created = await Order.create(buildOrderDoc({ status: 'DELIVERED' }));

    await assert.rejects(
      () => transitionOrderStatus(created._id, 'SHIPPED'),
      (err) => err.code === 'INVALID_ORDER_TRANSITION'
    );

    await Order.deleteOne({ _id: created._id });
  });

  it('rejects transition from final state CANCELLED', async () => {
    const created = await Order.create(buildOrderDoc({ status: 'CANCELLED' }));

    await assert.rejects(
      () => transitionOrderStatus(created._id, 'CONFIRMED'),
      (err) => err.code === 'INVALID_ORDER_TRANSITION'
    );

    await Order.deleteOne({ _id: created._id });
  });

  it('throws ORDER_NOT_FOUND for missing order', async () => {
    const missingId = new mongoose.Types.ObjectId();

    await assert.rejects(
      () => transitionOrderStatus(missingId, 'CONFIRMED'),
      (err) => {
        assert.equal(err.code, 'ORDER_NOT_FOUND');
        assert.equal(err.status, 404);
        return true;
      }
    );
  });

  it('only one of two concurrent transitions succeeds', async () => {
    const created = await Order.create(buildOrderDoc());

    const results = await Promise.allSettled([
      transitionOrderStatus(created._id, 'CONFIRMED'),
      transitionOrderStatus(created._id, 'CONFIRMED'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(fulfilled[0].value.status, 'CONFIRMED');
    assert.ok(
      rejected[0].reason.code === 'ORDER_STATUS_CONFLICT' ||
        rejected[0].reason.code === 'INVALID_ORDER_TRANSITION'
    );

    const stored = await Order.findById(created._id).lean();
    assert.equal(stored.status, 'CONFIRMED');
    await Order.deleteOne({ _id: created._id });
  });
});
