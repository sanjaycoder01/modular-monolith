const { randomUUID } = require('node:crypto');
const { runWithContext } = require('../context/requestContext');

/**
 * Assigns a fresh correlation ID to every HTTP request.
 * Does not trust incoming headers — always generates a new UUID.
 */
function correlationIdMiddleware(req, res, next) {
  const correlationId = randomUUID();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  // Enter ALS before continuing the chain so later awaits still see this ID
  runWithContext({ correlationId }, () => next());
}

module.exports = { correlationIdMiddleware };
