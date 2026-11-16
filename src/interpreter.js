import { validatePlan, runAnalytics } from './analytics.js';
import { forecastDemand } from './forecast.js';

const DATE_RANGES = new Set(['all', 'last_month', 'last_3_months', 'last_6_months', 'this_year', 'custom']);
const HORIZON_WORDS = new Map([['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6]]);

function boundsForRange(range, rows, start, end) {
  const last = rows.reduce((max, row) => row.orderDate > max ? row.orderDate : max, rows[0].orderDate);
  const first = rows.reduce((min, row) => row.orderDate < min ? row.orderDate : min, rows[0].orderDate);
  if (range === 'custom') return { start_date: start || first, end_date: end || last };
  if (range === 'all') return { start_date: null, end_date: null };
  const [year, month] = last.slice(0, 7).split('-').map(Number);
  if (range === 'this_year') return { start_date: `${year}-01-01`, end_date: last };
  const back = range === 'last_month' ? 2 : range === 'last_3_months' ? 3 : 6;
  const startMonth = new Date(Date.UTC(year, month - back, 1)).toISOString().slice(0, 7);
  return { start_date: `${startMonth}-01`, end_date: last };
}

function validateAndRun(rawPlan, rows) {
  if (rawPlan.tool === 'unsupported') {
    return {
      answer: rawPlan.reason || 'I can answer questions about order volume, delivery status and duration, carrier or destination performance, revenue, units, and SKU demand forecasts.',
      plan: { tool: 'No computation', metric: 'Not applicable', dimension: 'Not applicable', filters: [], method: 'The request did not match a supported analytics or forecasting tool.' },
      chart: null, table: [],
    };
  }
  const plan = validatePlan(rawPlan, rows);
  if (plan.tool === 'forecast') return forecastDemand(rows, plan.sku, plan.horizon);
  if (!DATE_RANGES.has(rawPlan.date_range)) throw new Error('The requested time range is not supported.');
  const dates = boundsForRange(rawPlan.date_range, rows, rawPlan.start_date, rawPlan.end_date);
  return runAnalytics(rows, { ...plan, ...dates });
}

const analyticsTool = {
  type: 'function',
  name: 'run_logistics_analytics',
  description: 'Compute a logistics metric from the validated order dataset. Select this for operational questions, aggregations, and charts. Never answer from memory.',
  strict: true,
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      tool: { type: 'string', enum: ['analytics'] },
      metric: { type: 'string', enum: ['orders', 'delayed_orders', 'delay_rate', 'delivery_days', 'units', 'revenue'] },
      dimension: { type: 'string', enum: ['none', 'week', 'month', 'carrier', 'destination', 'region', 'product_category', 'sku'] },
      status: { type: 'string', enum: ['all', 'delivered', 'delayed', 'in_transit', 'exception', 'canceled', 'completed'] },
      carrier: { type: ['string', 'null'] }, region: { type: ['string', 'null'] }, sku: { type: ['string', 'null'] },
      date_range: { type: 'string', enum: ['all', 'last_month', 'last_3_months', 'last_6_months', 'this_year', 'custom'] },
      start_date: { type: ['string', 'null'] }, end_date: { type: ['string', 'null'] },
    },
    required: ['tool', 'metric', 'dimension', 'status', 'carrier', 'region', 'sku', 'date_range', 'start_date', 'end_date'],
  },
};
const forecastTool = {
  type: 'function', name: 'forecast_logistics_demand',
  description: 'Forecast future monthly unit demand for one SKU using the supplied dataset history.',
  strict: true, parameters: {
    type: 'object', additionalProperties: false,
    properties: { tool: { type: 'string', enum: ['forecast'] }, sku: { type: 'string' }, horizon: { type: 'integer' } },
    required: ['tool', 'sku', 'horizon'],
  },
};
const unsupportedTool = {
  type: 'function', name: 'unsupported_logistics_request',
  description: 'Select this when the question needs data or computations outside the supported logistics analytics and SKU forecasting scope.',
  strict: true, parameters: {
    type: 'object', additionalProperties: false,
    properties: { tool: { type: 'string', enum: ['unsupported'] }, reason: { type: 'string' } },
    required: ['tool', 'reason'],
  },
};

function monthPhraseToRange(question) {
  if (/last\s+month|previous\s+month/i.test(question)) return 'last_month';
  if (/last\s+(three|3)\s+months|past\s+(three|3)\s+months/i.test(question)) return 'last_3_months';
  if (/last\s+(six|6)\s+months|past\s+(six|6)\s+months/i.test(question)) return 'last_6_months';
  if (/this\s+year|year.to.date/i.test(question)) return 'this_year';
  return 'all';
}

function localInterpret(question, rows) {
  const q = question.toLowerCase();
  const sku = question.match(/\b[A-Z]{2,12}-\d{4}\b/i)?.[0]?.toUpperCase() || null;
  if (/forecast|predict|inventory|stock\s+plan|replenish/.test(q)) {
    if (!sku) return { tool: 'unsupported', reason: 'Please include an exact SKU such as CRAYON-0008 to forecast demand.' };
    const digit = q.match(/\b([1-6])\s*months?\b/)?.[1];
    const word = [...HORIZON_WORDS].find(([name]) => new RegExp(`\\b${name}\\s+months?\\b`).test(q))?.[1];
    return { tool: 'forecast', sku, horizon: Number(digit || word || 4) };
  }
  let metric = 'orders';
  if (/delay rate|delayed rate|late rate|highest delay|most delayed by/.test(q)) metric = 'delay_rate';
  else if (/delayed|late|overdue/.test(q)) metric = 'delayed_orders';
  else if (/average.*delivery|delivery time|how long/.test(q)) metric = 'delivery_days';
  else if (/revenue|order value|sales value/.test(q)) metric = 'revenue';
  else if (/units|quantity/.test(q)) metric = 'units';
  const dimension = /by\s+week|weekly/.test(q) ? 'week'
    : /by\s+month|monthly/.test(q) ? 'month'
      : /carrier/.test(q) ? 'carrier'
        : /destination|city/.test(q) ? 'destination'
          : /region/.test(q) ? 'region'
            : /category|product/.test(q) ? 'product_category'
              : /sku/.test(q) && sku ? 'sku' : 'none';
  const status = metric === 'delay_rate' ? 'completed' : metric === 'delayed_orders' ? 'delayed' : 'all';
  const carriers = [...new Set(rows.map((row) => row.carrier))];
  const carrier = dimension === 'carrier' ? null : carriers.find((item) => q.includes(item.toLowerCase())) || null;
  const region = [...new Set(rows.map((row) => row.region))].find((item) => q.includes(item.toLowerCase())) || null;
  let date_range = monthPhraseToRange(question);
  let start_date = null; let end_date = null;
  const absolute = question.match(/\b(20\d{2}-\d{2}-\d{2})\s+(?:to|through|until)\s+(20\d{2}-\d{2}-\d{2})\b/i);
  if (absolute) { date_range = 'custom'; start_date = absolute[1]; end_date = absolute[2]; }
  return { tool: 'analytics', metric, dimension, status, carrier, region, sku: null, date_range, start_date, end_date };
}

function getOutputText(response) {
  for (const item of response.output || []) {
    if (item.type === 'function_call') return { name: item.name, arguments: item.arguments };
    if (item.type === 'message') {
      const refusal = item.content?.find((part) => part.type === 'refusal');
      if (refusal) throw new Error('The AI interpreter declined this request. Try a logistics analytics or SKU forecast question.');
    }
  }
  throw new Error('The AI interpreter did not select an analytical tool. Please rephrase the question.');
}

export async function interpretAndRun(question, rows, config = {}) {
  if (typeof question !== 'string' || !question.trim() || question.length > 600) throw new Error('Enter a question of 1 to 600 characters.');
  const apiKey = config.apiKey;
  if (!apiKey) {
    const plan = localInterpret(question.trim(), rows);
    const result = validateAndRun(plan, rows);
    return { ...result, interpreter: 'Rules-based fallback', plan: { ...result.plan, interpreter: 'Rules-based fallback' } };
  }
  const asOf = rows.reduce((max, row) => row.orderDate > max ? row.orderDate : max, rows[0].orderDate);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(18_000),
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini',
      instructions: `You route user questions to one of three tools. Never compute or state answers yourself. This application analyzes only the supplied mock logistics orders. Dataset order-date range ends ${asOf}; interpret relative date phrases against that date, not today's date. Use last_month for the previous calendar month, last_3_months for the current and previous two calendar months in the dataset, and last_6_months similarly. Use status completed for rate denominators (delivered + delayed). delivered is only a status proxy for on-time; there is no promised date. Do not infer causal explanations or SLA breaches. Use forecast tool only when the question asks future demand or inventory for a specific exact SKU and horizon (default 4 months). Return the supported tool or unsupported tool for everything else. Do not request, expose, or assume raw SQL.`,
      input: [{ role: 'user', content: question.trim() }],
      tools: [analyticsTool, forecastTool, unsupportedTool],
      tool_choice: 'required',
      parallel_tool_calls: false,
      store: false,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const code = payload?.error?.code;
    if (response.status === 401) throw new Error('AI configuration is invalid. Update OPENAI_API_KEY in the server environment.');
    if (response.status === 429) throw new Error('The AI service is temporarily rate limited. Please try again shortly.');
    throw new Error(`AI interpretation failed${code ? ` (${code})` : ''}. Try again or use one of the example questions.`);
  }
  const payload = await response.json();
  const call = getOutputText(payload);
  const expectedTool = { run_logistics_analytics: 'analytics', forecast_logistics_demand: 'forecast', unsupported_logistics_request: 'unsupported' }[call.name];
  let rawPlan;
  try { rawPlan = JSON.parse(call.arguments); }
  catch { throw new Error('The AI tool selection was not valid JSON. Please retry.'); }
  if (!expectedTool || rawPlan.tool !== expectedTool) throw new Error('The AI interpreter returned an unexpected tool. Please retry.');
  const result = validateAndRun(rawPlan, rows);
  const interpreter = `OpenAI function routing (${config.model || 'gpt-4o-mini'})`;
  return { ...result, interpreter, plan: { ...result.plan, interpreter } };
}
