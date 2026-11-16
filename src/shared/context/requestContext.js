const { AsyncLocalStorage } = require('node:async_hooks');

/**
 * Per-request context stored with AsyncLocalStorage.
 * Survives across awaits / Promise chains within the same request.
 */
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Run `fn` (sync or async) inside a new request context.
 * @param {{ correlationId: string }} store
 * @param {() => any} fn
 */
function runWithContext(store, fn) {
  return asyncLocalStorage.run(store, fn);
}

/**
 * @returns {string|null}
 */
function getCorrelationId() {
  const store = asyncLocalStorage.getStore();
  if (!store || store.correlationId == null) {
    return null;
  }
  return store.correlationId;
}

module.exports = {
  runWithContext,
  getCorrelationId,
};
