import { dashboardData } from './analytics.js';
import { forecastDemand } from './forecast.js';
import { interpretAndRun } from './interpreter.js';

const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('Send request data as JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Request body is empty.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('Request body is too large.'); }
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('Request body is not valid JSON.'); }
}

function validDate(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${field} is not a valid date.`);
  return value;
}

function dataMeta(rows, aiConfigured) {
  const unique = (key) => [...new Set(rows.map((row) => row[key]))].sort((a, b) => a.localeCompare(b));
  const first = rows.reduce((min, row) => row.orderDate < min ? row.orderDate : min, rows[0].orderDate);
  const last = rows.reduce((max, row) => row.orderDate > max ? row.orderDate : max, rows[0].orderDate);
  const start = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 3, 1)).toISOString().slice(0, 10);
  const recentDemand = new Map();
  for (const row of rows) if (row.orderDate >= start && row.status !== 'canceled') {
    const aggregate = recentDemand.get(row.sku) || { units: 0, months: new Set() };
    aggregate.units += row.quantity;
    aggregate.months.add(row.orderDate.slice(0, 7));
    recentDemand.set(row.sku, aggregate);
  }
  const recommendedForecastSku = [...recentDemand.entries()]
    .filter(([, demand]) => demand.units > 0)
    .sort((a, b) => b[1].months.size - a[1].months.size || b[1].units - a[1].units)[0]?.[0] || unique('sku')[0];
  return {
    dataset: { rows: rows.length, startDate: first, endDate: last },
    carriers: unique('carrier'), regions: unique('region'), skus: unique('sku'), categories: unique('productCategory'),
    recommendedForecastSku, aiConfigured,
    metrics: ['orders', 'delayed orders', 'delay rate', 'delivery days', 'units', 'revenue'],
  };
}

function isClientError(message) {
  return /Enter a question|unsupported|not present|horizon|SKU|date|JSON|too large|malformed|before|request body/i.test(message);
}

export function createApiHandler(rows) {
  const requestsByAddress = new Map();
  function consumeQueryQuota(address) {
    const now = Date.now();
    const prior = requestsByAddress.get(address);
    const bucket = !prior || prior.until <= now ? { count: 0, until: now + RATE_WINDOW_MS } : prior;
    bucket.count += 1;
    requestsByAddress.set(address, bucket);
    if (requestsByAddress.size > 1500) for (const [key, value] of requestsByAddress) if (value.until <= now) requestsByAddress.delete(key);
    return bucket.count <= RATE_LIMIT;
  }

  return async function handleApiRequest(request, { apiKey, model, clientAddress = 'unknown' } = {}) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/health') return json({ status: 'ok' });
    if (request.method === 'GET' && url.pathname === '/api/meta') return json(dataMeta(rows, Boolean(apiKey)));
    if (request.method === 'GET' && url.pathname === '/api/dashboard') {
      try {
        const start = validDate(url.searchParams.get('start_date'), 'start_date');
        const end = validDate(url.searchParams.get('end_date'), 'end_date');
        if (start && end && start > end) return json({ error: 'start_date must be before end_date.' }, 400);
        return json(dashboardData(rows, start, end));
      } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid date range.' }, 400); }
    }
    if (request.method === 'POST' && url.pathname === '/api/query') {
      if (!consumeQueryQuota(clientAddress)) return json({ error: 'Too many queries. Wait a minute and try again.' }, 429, { 'Retry-After': '60' });
      try { return json(await interpretAndRun((await readJson(request)).question, rows, { apiKey, model })); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Request failed.';
        return json({ error: isClientError(message) ? message : safeAiError(message) }, isClientError(message) ? 400 : 500);
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/forecast') {
      try {
        const body = await readJson(request);
        if (typeof body.sku !== 'string' || !rows.some((row) => row.sku === body.sku)) return json({ error: 'Choose an SKU from the supplied dataset.' }, 400);
        return json(forecastDemand(rows, body.sku, Number(body.horizon)));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Request failed.';
        return json({ error: isClientError(message) ? message : 'The request could not be completed. Please try again.' }, isClientError(message) ? 400 : 500);
      }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    return null;
  };
}

function safeAiError(message) {
  if (message.includes('invalid. Update OPENAI_API_KEY')) return message;
  if (message.includes('rate limited')) return message;
  if (message.includes('AI interpretation failed')) return message;
  if (message.includes('AI interpreter')) return message;
  return 'The request could not be completed. Please try again.';
}
