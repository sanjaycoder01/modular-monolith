/**
 * Creates one database + collection + indexes per module.
 *
 * Run: npm run db:init
 *
 * Databases created:
 *   users_db.users
 *   inventory_db.products
 *   orders_db.orders
 *   payments_db.payments
 *   shipping_db.shipments
 */
const {
  MODULE_DATABASES,
  connectAllModules,
  disconnectAll,
} = require('../shared/db/connections');
const { initUsersModule } = require('../modules/users');
const { initInventoryModule } = require('../modules/inventory');
const { initOrdersModule } = require('../modules/orders');
const { initPaymentsModule } = require('../modules/payments');
const { initShippingModule } = require('../modules/shipping');

async function initDatabases() {
  console.log('Connecting module databases...\n');

  await connectAllModules();

  const users = await initUsersModule();
  const inventory = await initInventoryModule();
  const orders = await initOrdersModule();
  const payments = await initPaymentsModule();
  const shipping = await initShippingModule();

  // Touch each collection so MongoDB materializes empty collections
  await Promise.all([
    users.User.createCollection(),
    inventory.Product.createCollection(),
    orders.Order.createCollection(),
    payments.Payment.createCollection(),
    shipping.Shipment.createCollection(),
  ]);

  const report = [
    {
      module: 'users',
      database: MODULE_DATABASES.users,
      collection: 'users',
      indexes: await users.User.collection.indexes(),
    },
    {
      module: 'inventory',
      database: MODULE_DATABASES.inventory,
      collection: 'products',
      indexes: await inventory.Product.collection.indexes(),
    },
    {
      module: 'orders',
      database: MODULE_DATABASES.orders,
      collection: 'orders',
      indexes: await orders.Order.collection.indexes(),
    },
    {
      module: 'payments',
      database: MODULE_DATABASES.payments,
      collection: 'payments',
      indexes: await payments.Payment.collection.indexes(),
    },
    {
      module: 'shipping',
      database: MODULE_DATABASES.shipping,
      collection: 'shipments',
      indexes: await shipping.Shipment.collection.indexes(),
    },
  ];

  console.log('Modular monolith databases ready:\n');
  for (const entry of report) {
    console.log(`  [${entry.module}] ${entry.database}.${entry.collection}`);
    for (const index of entry.indexes) {
      const unique = index.unique ? ' (unique)' : '';
      console.log(`    - ${JSON.stringify(index.key)}${unique}`);
    }
    console.log('');
  }

  console.log('Rule reminder:');
  console.log('  • Each collection is owned by exactly one module');
  console.log('  • Cross-module references are IDs only (no populate / $lookup)');
  console.log('  • Shared data arrives via public APIs or event payloads\n');
}

initDatabases()
  .then(async () => {
    await disconnectAll();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Failed to init databases:', err);
    await disconnectAll().catch(() => {});
    process.exit(1);
  });
