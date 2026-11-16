import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve('dist/server');
for (const file of ['index.js', 'dataset.js', 'assets.js', 'package.json', 'src/analytics.js', 'src/api.js', 'src/data-core.js', 'src/forecast.js', 'src/interpreter.js']) {
  await access(path.join(root, file));
}
const { default: worker } = await import(pathToFileURL(path.join(root, 'index.js')).href);
const env = {};
const request = (pathname, init) => worker.fetch(new Request(`https://test.invalid${pathname}`, init), env);
const health = await request('/api/health');
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { status: 'ok' });
const meta = await (await request('/api/meta')).json();
assert.equal(meta.dataset.rows, 400);
assert.ok(meta.skus.includes('CRAYON-0008'));
const dashboard = await (await request('/api/dashboard')).json();
assert.equal(dashboard.kpis.totalOrders, 400);
const query = await request('/api/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Which carrier has the highest delay rate?' }) });
assert.equal(query.status, 200);
assert.match((await query.json()).answer, /has the highest delay rate/);
const forecast = await request('/api/forecast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku: 'CRAYON-0008', horizon: 4 }) });
assert.equal(forecast.status, 200);
assert.equal((await forecast.json()).chart.forecast.length, 4);
const html = await request('/');
assert.equal(html.status, 200);
assert.match(await html.text(), /Logistics control tower|Good morning, AbdullaH/);
console.log('Validated packaged Worker assets and API workflows.');
