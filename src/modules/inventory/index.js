const { getModuleConnection } = require('../../shared/db/connections');
const { createProductModel } = require('./internal/Product');
const { createInventoryService } = require('./internal/inventoryService');
const {
  ProductNotFoundError,
  InsufficientStockError,
  InvalidStockItemsError,
} = require('./internal/errors');

let Product;
let inventoryService;

function getProductModel() {
  if (!Product) {
    throw new Error(
      'Inventory module not initialized. Call initInventoryModule() first.'
    );
  }
  return Product;
}

async function initInventoryModule() {
  const connection = await getModuleConnection('inventory');
  Product = createProductModel(connection);
  await Product.createIndexes();
  inventoryService = createInventoryService(getProductModel);
  return { connection, Product };
}

function assertReady() {
  if (!inventoryService) {
    throw new Error(
      'Inventory module not initialized. Call initInventoryModule() first.'
    );
  }
}

/**
 * Public API — DTO for order line snapshots.
 * @returns {{ productId, name, unitPrice }}
 */
async function getProductForOrder(productId) {
  assertReady();
  return inventoryService.getProductForOrder(productId);
}

/**
 * Public API — atomically reserve stock for checkout.
 * @param {{ productId: any, quantity: number }[]} items
 */
async function reserveStock(items) {
  assertReady();
  return inventoryService.reserveStock(items);
}

/**
 * Public API — release previously reserved stock (cancel / payment failure).
 * @param {{ productId: any, quantity: number }[]} items
 */
async function releaseStock(items) {
  assertReady();
  return inventoryService.releaseStock(items);
}

module.exports = {
  initInventoryModule,
  getProductForOrder,
  reserveStock,
  releaseStock,
  ProductNotFoundError,
  InsufficientStockError,
  InvalidStockItemsError,
};
