import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { loadDataset } from '../src/data.js';
import { createApiHandler } from '../src/api.js';
import vercelHandler from '../src/server.js';

const rows = await loadDataset();
const endpoint = createApiHandler(rows);
const call = (url, init, config) => endpoint(new Request(`https://example.test${url}`, init), config);

test('API handler serves health/meta/dashboard and rejects invalid date ranges', async () => {
  const health = await call('/api/health');
  assert.deepEqual(await health.json(), { status: 'ok' });
  const meta = await call('/api/meta');
  const metaBody = await meta.json();
  assert.equal(metaBody.dataset.rows, 400);
  assert.ok(metaBody.skus.includes('CRAYON-0008'));
  assert.ok(metaBody.recommendedForecastSku);
  const dashboard = await call('/api/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal((await dashboard.json()).kpis.totalOrders, 400);
  const invalid = await call('/api/dashboard?start_date=2025-12-01&end_date=2025-01-01');
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /before/);
});

test('API handler validates forecast requests and request content types', async () => {
  const invalidSku = await call('/api/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku: 'UNKNOWN-0000', horizon: 3 }) });
  assert.equal(invalidSku.status, 400);
  const invalidType = await call('/api/forecast', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'bad' });
  assert.equal(invalidType.status, 400);
});

test('API handler interprets supported query without external credentials', async () => {
  const result = await call('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Which carrier has the highest delay rate?' }) });
  assert.equal(result.status, 200);
  assert.match((await result.json()).answer, /has the highest delay rate/);
});

test('Vercel Node handler serves health and the dashboard entrypoint', async () => {
  const invoke = async (url) => {
    const req = Readable.from([]);
    Object.assign(req, { method: 'GET', url, headers: { host: 'example.test' }, socket: { remoteAddress: '127.0.0.1' } });
    const res = {
      headersSent: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { this.body = body; },
    };
    await vercelHandler(req, res);
    return res;
  };

  const health = await invoke('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body.toString()), { status: 'ok' });

  const home = await invoke('/');
  assert.equal(home.status, 200);
  assert.match(home.body.toString(), /Good morning, AbdullaH/);
});
