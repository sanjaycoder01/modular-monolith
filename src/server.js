require('dotenv').config();
const express = require('express');

const { initUsersModule } = require('./modules/users');
const { initInventoryModule } = require('./modules/inventory');
const { initOrdersModule, registerRoutes } = require('./modules/orders');
const { initPaymentsModule } = require('./modules/payments');
const { initShippingModule } = require('./modules/shipping');
const { correlationIdMiddleware } = require('./shared/middleware/correlationId');

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  await initUsersModule();
  await initInventoryModule();
  await initOrdersModule();
  await initPaymentsModule();
  await initShippingModule();

  const app = express();

  // Correlation ID first so all later middleware/routes share the same ALS context
  app.use(correlationIdMiddleware);
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  registerRoutes(app);

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
