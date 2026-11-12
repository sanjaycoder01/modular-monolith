/**
 * One MongoDB connection (and database) per module.
 * Modules never share a connection or query each other's collections.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MODULE_DATABASES = {
  users: 'users_db',
  inventory: 'inventory_db',
  orders: 'orders_db',
  payments: 'payments_db',
  shipping: 'shipping_db',
};

const connections = {};

function getBaseUri() {
  return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
}

/**
 * Create (or reuse) a dedicated connection for a module's database.
 * @param {'users'|'inventory'|'orders'|'payments'|'shipping'} moduleName
 */
async function getModuleConnection(moduleName) {
  const dbName = MODULE_DATABASES[moduleName];
  if (!dbName) {
    throw new Error(`Unknown module: ${moduleName}`);
  }

  if (connections[moduleName]) {
    return connections[moduleName];
  }

  const uri = `${getBaseUri().replace(/\/$/, '')}/${dbName}`;
  const connection = await mongoose.createConnection(uri).asPromise();

  connections[moduleName] = connection;
  return connection;
}

async function connectAllModules() {
  const names = Object.keys(MODULE_DATABASES);
  const result = {};
  for (const name of names) {
    result[name] = await getModuleConnection(name);
  }
  return result;
}

async function disconnectAll() {
  await Promise.all(
    Object.values(connections).map((conn) => conn.close())
  );
  for (const key of Object.keys(connections)) {
    delete connections[key];
  }
}

module.exports = {
  MODULE_DATABASES,
  getModuleConnection,
  connectAllModules,
  disconnectAll,
};
