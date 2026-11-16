const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { correlationIdMiddleware } = require('./correlationId');
const { getCorrelationId } = require('../context/requestContext');

function startTestServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function request(port, path = '/probe') {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null,
          });
        });
      })
      .on('error', reject);
  });
}

describe('correlationIdMiddleware', () => {
  it('assigns a unique ID per request and sets X-Correlation-ID', async () => {
    const app = express();
    app.use(correlationIdMiddleware);
    app.get('/probe', (req, res) => {
      res.json({
        reqId: req.correlationId,
        alsId: getCorrelationId(),
      });
    });

    const { server, port } = await startTestServer(app);
    try {
      const a = await request(port);
      const b = await request(port);

      assert.equal(a.statusCode, 200);
      assert.equal(b.statusCode, 200);

      assert.ok(a.headers['x-correlation-id']);
      assert.ok(b.headers['x-correlation-id']);
      assert.notEqual(
        a.headers['x-correlation-id'],
        b.headers['x-correlation-id']
      );

      assert.equal(a.headers['x-correlation-id'], a.body.reqId);
      assert.equal(a.headers['x-correlation-id'], a.body.alsId);
      assert.equal(b.headers['x-correlation-id'], b.body.reqId);
      assert.equal(b.headers['x-correlation-id'], b.body.alsId);
    } finally {
      server.close();
    }
  });

  it('ignores incoming correlation headers and always generates a new ID', async () => {
    const app = express();
    app.use(correlationIdMiddleware);
    app.get('/probe', (req, res) => {
      res.json({ id: req.correlationId });
    });

    const { server, port } = await startTestServer(app);
    try {
      const result = await new Promise((resolve, reject) => {
        http
          .get(
            {
              hostname: '127.0.0.1',
              port,
              path: '/probe',
              headers: { 'X-Correlation-ID': 'client-provided-id' },
            },
            (res) => {
              let body = '';
              res.on('data', (chunk) => {
                body += chunk;
              });
              res.on('end', () => {
                resolve({
                  header: res.headers['x-correlation-id'],
                  body: JSON.parse(body),
                });
              });
            }
          )
          .on('error', reject);
      });

      assert.notEqual(result.header, 'client-provided-id');
      assert.notEqual(result.body.id, 'client-provided-id');
      assert.equal(result.header, result.body.id);
    } finally {
      server.close();
    }
  });

  it('keeps the same ALS ID across async work in one request', async () => {
    const app = express();
    app.use(correlationIdMiddleware);
    app.get('/probe', async (req, res) => {
      const before = getCorrelationId();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const after = getCorrelationId();
      res.json({ before, after, reqId: req.correlationId });
    });

    const { server, port } = await startTestServer(app);
    try {
      const result = await request(port);
      assert.equal(result.body.before, result.body.after);
      assert.equal(result.body.before, result.body.reqId);
      assert.equal(result.headers['x-correlation-id'], result.body.reqId);
    } finally {
      server.close();
    }
  });

  it('does not share correlation IDs across concurrent requests', async () => {
    const app = express();
    app.use(correlationIdMiddleware);
    app.get('/probe', async (req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      res.json({
        reqId: req.correlationId,
        alsId: getCorrelationId(),
      });
    });

    const { server, port } = await startTestServer(app);
    try {
      const [a, b, c] = await Promise.all([
        request(port),
        request(port),
        request(port),
      ]);

      const ids = [
        a.headers['x-correlation-id'],
        b.headers['x-correlation-id'],
        c.headers['x-correlation-id'],
      ];

      assert.equal(new Set(ids).size, 3);
      assert.equal(a.body.reqId, a.body.alsId);
      assert.equal(b.body.reqId, b.body.alsId);
      assert.equal(c.body.reqId, c.body.alsId);
    } finally {
      server.close();
    }
  });
});
