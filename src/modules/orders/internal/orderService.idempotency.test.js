const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { disconnectAll } = require('../../../shared/db/connections');
const { initUsersModule } = require('../../users');
const { initInventoryModule } = require('../../inventory');
const { initOrdersModule, placeOrder } = require('../index');

describe('placeOrder idempotency', () => {
  let User;
  let Product;
  let Order;
  let userId;
  let productId;

  before(async () => {
    ({ User } = await initUsersModule());
    ({ Product } = await initInventoryModule());
    ({ Order } = await initOrdersModule());

    const user = await User.create({
      name: 'Idempotency Tester',
      email: `idem-${Date.now()}@example.com`,
      passwordHash: 'hash',
      address: { line1: '1 Main', city: 'Pune', pincode: '411001' },
    });
    userId = user._id;

    const product = await Product.create({
      name: `Idem Widget ${Date.now()}`,
      type: 'gadgets',
      price: 10000,
      total: 50,
    });
    productId = product._id;
  });

  after(async () => {
    if (userId) await User.deleteOne({ _id: userId });
    if (productId) await Product.deleteOne({ _id: productId });
    await disconnectAll();
  });

  it('requires idempotencyKey', async () => {
    await assert.rejects(
      () =>
        placeOrder({
          userId,
          items: [{ productId, quantity: 1 }],
        }),
      (err) => err.status === 400 && /idempotencyKey/i.test(err.message)
    );
  });

  it('retry with same key returns the same order and does not create another', async () => {
    const key = `order-retry-${new mongoose.Types.ObjectId()}`;
    const payload = {
      userId,
      idempotencyKey: key,
      items: [{ productId, quantity: 2 }],
    };

    const first = await placeOrder(payload);
    const second = await placeOrder(payload);

    assert.equal(String(first.orderId), String(second.orderId));
    assert.equal(first.idempotencyKey, key);
    assert.equal(second.idempotencyKey, key);
    assert.equal(second.replayed, true);
    assert.equal(first.replayed, undefined);

    const count = await Order.countDocuments({ userId, idempotencyKey: key });
    assert.equal(count, 1);

    await Order.deleteOne({ _id: first.orderId });
  });

  it('different keys create different orders', async () => {
    const a = await placeOrder({
      userId,
      idempotencyKey: `key-a-${new mongoose.Types.ObjectId()}`,
      items: [{ productId, quantity: 1 }],
    });
    const b = await placeOrder({
      userId,
      idempotencyKey: `key-b-${new mongoose.Types.ObjectId()}`,
      items: [{ productId, quantity: 1 }],
    });

    assert.notEqual(String(a.orderId), String(b.orderId));
    await Order.deleteMany({ _id: { $in: [a.orderId, b.orderId] } });
  });
});
