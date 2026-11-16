const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  runWithContext,
  getCorrelationId,
} = require('./requestContext');

describe('requestContext', () => {
  it('returns null outside a request context', () => {
    assert.equal(getCorrelationId(), null);
  });

  it('returns the correlation ID inside runWithContext', () => {
    runWithContext({ correlationId: 'id-a' }, () => {
      assert.equal(getCorrelationId(), 'id-a');
    });
  });

  it('keeps the same ID across nested async work in one context', async () => {
    await runWithContext({ correlationId: 'async-same' }, async () => {
      assert.equal(getCorrelationId(), 'async-same');

      await Promise.resolve();
      assert.equal(getCorrelationId(), 'async-same');

      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(getCorrelationId(), 'async-same');

      const fromNested = await (async () => getCorrelationId())();
      assert.equal(fromNested, 'async-same');
    });
  });

  it('isolates concurrent contexts so IDs do not leak', async () => {
    const seen = await Promise.all([
      runWithContext({ correlationId: 'req-1' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return getCorrelationId();
      }),
      runWithContext({ correlationId: 'req-2' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getCorrelationId();
      }),
    ]);

    assert.deepEqual(seen, ['req-1', 'req-2']);
  });
});
