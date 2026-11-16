const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { logger } = require('./logger');
const { runWithContext } = require('../context/requestContext');

function captureConsole(method, fn) {
  const original = console[method];
  const lines = [];
  console[method] = (line) => {
    lines.push(line);
  };
  try {
    fn();
  } finally {
    console[method] = original;
  }
  return lines;
}

describe('logger', () => {
  it('includes correlationId from AsyncLocalStorage', () => {
    const lines = captureConsole('log', () => {
      runWithContext({ correlationId: 'corr-123' }, () => {
        logger.info('hello', { step: 1 });
      });
    });

    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.level, 'info');
    assert.equal(entry.message, 'hello');
    assert.equal(entry.correlationId, 'corr-123');
    assert.deepEqual(entry.metadata, { step: 1 });
    assert.ok(entry.timestamp);
  });

  it('uses null correlationId outside request context and does not crash', () => {
    const lines = captureConsole('error', () => {
      logger.error('outside request');
    });

    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.level, 'error');
    assert.equal(entry.message, 'outside request');
    assert.equal(entry.correlationId, null);
    assert.equal(entry.metadata, undefined);
  });

  it('writes warn logs with structured JSON', () => {
    const lines = captureConsole('warn', () => {
      runWithContext({ correlationId: 'warn-id' }, () => {
        logger.warn('careful');
      });
    });

    const entry = JSON.parse(lines[0]);
    assert.equal(entry.level, 'warn');
    assert.equal(entry.correlationId, 'warn-id');
  });
});
