const { getModuleConnection } = require('../../shared/db/connections');
const { createShipmentModel } = require('./internal/Shipment');

let Shipment;

async function initShippingModule() {
  const connection = await getModuleConnection('shipping');
  Shipment = createShipmentModel(connection);
  await Shipment.createIndexes();
  return { connection, Shipment };
}

function getShipmentModel() {
  if (!Shipment) {
    throw new Error(
      'Shipping module not initialized. Call initShippingModule() first.'
    );
  }
  return Shipment;
}

module.exports = { initShippingModule, getShipmentModel };
