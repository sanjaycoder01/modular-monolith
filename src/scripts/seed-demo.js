/**
 * Seeds one demo user + product and prints their ids for curl tests.
 * Run: npm run seed
 */
require('dotenv').config();
const { disconnectAll } = require('../shared/db/connections');
const { initUsersModule } = require('../modules/users');
const { initInventoryModule } = require('../modules/inventory');

async function seed() {
  const { User } = await initUsersModule();
  const { Product } = await initInventoryModule();

  const email = 'demo@example.com';
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name: 'Demo User',
      email,
      passwordHash: 'not-a-real-hash',
      phone: '9999999999',
      address: {
        line1: '12 Demo Street',
        city: 'Pune',
        pincode: '411001',
      },
    });
  }

  let product = await Product.findOne({ name: 'Demo Widget' });
  if (!product) {
    product = await Product.create({
      name: 'Demo Widget',
      type: 'gadgets',
      price: 499,
      total: 20,
    });
  }

  console.log('\nSeed ready. Use these ids:\n');
  console.log(`  userId:    ${user._id}`);
  console.log(`  productId: ${product._id}`);
  console.log(`  stock:     remaining=${product.remaining} sold=${product.sold}`);
  console.log('\nHappy path:');
  console.log(
    `  curl -s -X POST localhost:3000/orders -H 'Content-Type: application/json' -d '{"userId":"${user._id}","items":[{"productId":"${product._id}","quantity":2}]}'`
  );
  console.log('\nToo much stock:');
  console.log(
    `  curl -s -X POST localhost:3000/orders -H 'Content-Type: application/json' -d '{"userId":"${user._id}","items":[{"productId":"${product._id}","quantity":9999}]}'`
  );
  console.log('');
}

seed()
  .then(async () => {
    await disconnectAll();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await disconnectAll().catch(() => {});
    process.exit(1);
  });
