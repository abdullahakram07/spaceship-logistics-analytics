import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDataset } from '../src/data.js';
import { dashboardData, runAnalytics, validatePlan } from '../src/analytics.js';
import { forecastDemand } from '../src/forecast.js';
import { interpretAndRun } from '../src/interpreter.js';

const rows = await loadDataset();

test('dashboard returns required KPIs and the three required chart families', () => {
  const dashboard = dashboardData(rows);
  assert.equal(dashboard.kpis.totalOrders, 400);
  assert.equal(dashboard.kpis.deliveredOrders, 304);
  assert.equal(dashboard.kpis.delayedOrders, 55);
  assert.ok(dashboard.kpis.onTimeRateProxy > 0 && dashboard.kpis.onTimeRateProxy < 1);
  assert.ok(dashboard.kpis.avgDeliveryDays > 0);
  assert.ok(dashboard.charts.orderVolume.length > 1);
  assert.equal(dashboard.charts.deliveryPerformance.length, 3);
  assert.ok(dashboard.charts.carriers.length > 1);
});

test('delayed orders by week last three months uses dataset-relative October through December dates', async () => {
  const result = await interpretAndRun('Show delayed orders by week for the last 3 months', rows);
  assert.equal(result.chart.type, 'line');
  assert.equal(result.plan.dimension, 'week');
  assert.ok(result.plan.filters.includes('status: delayed'));
  assert.ok(result.plan.filters.includes('order date: 2025-10-01 to 2025-12-30'));
  assert.equal(result.table.reduce((sum, row) => sum + row.value, 0), rows.filter((row) => row.status === 'delayed' && row.orderDate >= '2025-10-01' && row.orderDate <= '2025-12-30').length);
});

test('carrier delay rate is computed over delivered plus delayed statuses', async () => {
  const result = await interpretAndRun('Which carrier has the highest delay rate?', rows);
  assert.equal(result.plan.metric, 'Delay rate');
  assert.equal(result.plan.dimension, 'carrier');
  assert.equal(result.table.length, new Set(rows.map((row) => row.carrier)).size);
  const top = result.table[0];
  assert.match(result.answer, new RegExp(`^${top.label} has the highest delay rate`));
  const matching = rows.filter((row) => row.carrier === top.label && ['delivered', 'delayed'].includes(row.status));
  assert.equal(top.value, matching.filter((row) => row.status === 'delayed').length / matching.length);
});

test('late order question resolves last month relative to final dataset month', async () => {
  const result = await interpretAndRun('How many orders were delivered late last month?', rows);
  const expected = rows.filter((row) => row.status === 'delayed' && row.orderDate >= '2025-11-01' && row.orderDate <= '2025-12-30').length;
  assert.match(result.answer, new RegExp(`^${expected} delayed orders`));
  assert.ok(result.plan.filters.includes('order date: 2025-11-01 to 2025-12-30'));
});

test('validated analytics plans reject arbitrary dimensions and unknown carriers', () => {
  assert.throws(() => validatePlan({ tool: 'analytics', metric: 'orders', dimension: 'sql', status: 'all', carrier: null, region: null, sku: null }, rows), /unsupported/);
  assert.throws(() => validatePlan({ tool: 'analytics', metric: 'orders', dimension: 'carrier', status: 'all', carrier: 'Unknown', region: null, sku: null }, rows), /carrier/);
});

test('SKU forecast returns history, future periods, and horizon inventory baseline', () => {
  const result = forecastDemand(rows, 'CRAYON-0008', 4);
  assert.equal(result.chart.forecast.length, 4);
  assert.equal(result.plan.method.includes('moving average'), true);
  assert.equal(result.recommendation.horizonMonths, 4);
  assert.equal(result.recommendation.units, Math.ceil(result.chart.forecast.reduce((sum, point) => sum + point.units, 0)));
  assert.ok(result.chart.forecast[0].month > result.chart.history.at(-1).month);
});

test('forecast and analytics reject out-of-scope inputs', () => {
  assert.throws(() => forecastDemand(rows, 'UNKNOWN-9999', 2), /history/);
  assert.throws(() => forecastDemand(rows, 'CRAYON-0008', 7), /1 to 6 months/);
  assert.throws(() => validatePlan({ tool: 'analytics', metric: 'orders', dimension: 'none', status: 'all', carrier: null, region: null, sku: null, start_date: '2025-12-01', end_date: '2025-01-01' }, rows), /start date/);
});
