const DIMENSIONS = new Set(['none', 'week', 'month', 'carrier', 'destination', 'region', 'product_category', 'sku']);
const METRICS = new Set(['orders', 'delayed_orders', 'delay_rate', 'delivery_days', 'units', 'revenue']);
const STATUSES = new Set(['all', 'delivered', 'delayed', 'in_transit', 'exception', 'canceled', 'completed']);
const DIMENSION_FIELDS = {
  carrier: 'carrier', destination: 'destinationCity', region: 'region',
  product_category: 'productCategory', sku: 'sku',
};
const DAY_MS = 86_400_000;

export function validatePlan(input, rows) {
  if (!input || typeof input !== 'object') throw new Error('The analytical plan was malformed.');
  if (input.tool === 'unsupported') return { tool: 'unsupported', reason: String(input.reason || '').slice(0, 300) };
  if (input.tool === 'forecast') {
    if (typeof input.sku !== 'string' || !rows.some((row) => row.sku.toLowerCase() === input.sku.toLowerCase())) {
      throw new Error(`That SKU is not present in the dataset. Try one such as ${rows[0].sku}.`);
    }
    if (!Number.isInteger(input.horizon) || input.horizon < 1 || input.horizon > 6) {
      throw new Error('Forecast horizon must be between 1 and 6 months.');
    }
    return { tool: 'forecast', sku: rows.find((row) => row.sku.toLowerCase() === input.sku.toLowerCase()).sku, horizon: input.horizon };
  }
  if (input.tool !== 'analytics' || !METRICS.has(input.metric) || !DIMENSIONS.has(input.dimension) || !STATUSES.has(input.status)) {
    throw new Error('The analytical plan contains an unsupported metric or dimension.');
  }
  const validSet = (field, value) => value == null || (typeof value === 'string' && rows.some((row) => row[field].toLowerCase() === value.toLowerCase()));
  if (!validSet('carrier', input.carrier)) throw new Error('That carrier is not present in the dataset.');
  if (!validSet('region', input.region)) throw new Error('That region is not present in the dataset.');
  if (!validSet('sku', input.sku)) throw new Error('That SKU is not present in the dataset.');
  const startDate = input.start_date || null;
  const endDate = input.end_date || null;
  for (const date of [startDate, endDate]) {
    if (date != null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) {
      throw new Error('The date range could not be interpreted.');
    }
  }
  if (startDate && endDate && startDate > endDate) throw new Error('The start date must be before the end date.');
  return {
    tool: 'analytics', metric: input.metric, dimension: input.dimension, status: input.status,
    carrier: input.carrier ? rows.find((row) => row.carrier.toLowerCase() === input.carrier.toLowerCase()).carrier : null,
    region: input.region ? rows.find((row) => row.region.toLowerCase() === input.region.toLowerCase()).region : null,
    sku: input.sku ? rows.find((row) => row.sku.toLowerCase() === input.sku.toLowerCase()).sku : null,
    start_date: startDate, end_date: endDate,
  };
}

function weekStart(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function dimensionKey(row, dimension) {
  if (dimension === 'week') return weekStart(row.orderDate);
  if (dimension === 'month') return row.orderDate.slice(0, 7);
  if (dimension === 'none') return 'All orders';
  return row[DIMENSION_FIELDS[dimension]];
}

function selectedRows(rows, plan) {
  return rows.filter((row) => {
    if (plan.start_date && row.orderDate < plan.start_date) return false;
    if (plan.end_date && row.orderDate > plan.end_date) return false;
    if (plan.status === 'completed' && !['delivered', 'delayed'].includes(row.status)) return false;
    if (plan.status !== 'all' && plan.status !== 'completed' && row.status !== plan.status) return false;
    if (plan.carrier && row.carrier !== plan.carrier) return false;
    if (plan.region && row.region !== plan.region) return false;
    if (plan.sku && row.sku !== plan.sku) return false;
    return true;
  });
}

export function runAnalytics(rows, plan) {
  const filtered = selectedRows(rows, plan);
  const buckets = new Map();
  const periodCounts = new Map();
  for (const row of filtered) {
    const key = dimensionKey(row, plan.dimension);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
    const period = row.orderDate.slice(0, 7);
    periodCounts.set(period, (periodCounts.get(period) || 0) + 1);
  }

  const results = [...buckets.entries()].map(([label, bucket]) => {
    const completed = bucket.filter((row) => ['delivered', 'delayed'].includes(row.status));
    const delivered = bucket.filter((row) => row.status === 'delivered');
    const delayed = bucket.filter((row) => row.status === 'delayed');
    const withDelivery = bucket.filter((row) => row.deliveryDate && ['delivered', 'delayed'].includes(row.status));
    const deliveryDays = withDelivery.map((row) => (Date.parse(`${row.deliveryDate}T00:00:00Z`) - Date.parse(`${row.orderDate}T00:00:00Z`)) / DAY_MS);
    const values = {
      orders: bucket.length,
      delayed_orders: delayed.length,
      delay_rate: completed.length ? delayed.length / completed.length : null,
      delivery_days: deliveryDays.length ? deliveryDays.reduce((sum, days) => sum + days, 0) / deliveryDays.length : null,
      units: bucket.reduce((sum, row) => sum + row.quantity, 0),
      revenue: bucket.reduce((sum, row) => sum + row.orderValueUsd, 0),
      delivered_orders: delivered.length,
      on_time_rate_proxy: completed.length ? delivered.length / completed.length : null,
    };
    return { label, value: values[plan.metric], orders: bucket.length, delivered: delivered.length, delayed: delayed.length, completed: completed.length };
  });
  const isTime = ['week', 'month'].includes(plan.dimension);
  results.sort((a, b) => isTime ? a.label.localeCompare(b.label) : (b.value ?? -1) - (a.value ?? -1) || a.label.localeCompare(b.label));
  const total = filtered.length;
  const num = (key) => filtered.reduce((sum, row) => sum + row[key], 0);
  const delayed = filtered.filter((row) => row.status === 'delayed').length;
  const delivered = filtered.filter((row) => row.status === 'delivered').length;
  const completedCount = delivered + delayed;
  const withDelivery = filtered.filter((row) => row.deliveryDate && ['delivered', 'delayed'].includes(row.status));
  const daysTotal = withDelivery.reduce((sum, row) => sum + (Date.parse(`${row.deliveryDate}T00:00:00Z`) - Date.parse(`${row.orderDate}T00:00:00Z`)) / DAY_MS, 0);
  const aggregate = {
    orders: total,
    delayed_orders: delayed,
    delay_rate: completedCount ? delayed / completedCount : null,
    delivery_days: withDelivery.length ? daysTotal / withDelivery.length : null,
    units: num('quantity'), revenue: num('orderValueUsd'),
    delivered_orders: delivered,
    on_time_rate_proxy: completedCount ? delivered / completedCount : null,
  };
  const labels = {
    orders: 'Orders', delayed_orders: 'Delayed orders', delay_rate: 'Delay rate',
    delivery_days: 'Average delivery time (days)', units: 'Units ordered', revenue: 'Order value (USD)',
  };
  const chartType = isTime ? 'line' : 'bar';
  const answer = formatAnswer(plan.metric, aggregate[plan.metric], total, filtered.length, results, plan.dimension);
  return {
    answer,
    plan: {
      tool: 'Analytics query', metric: labels[plan.metric], dimension: plan.dimension,
      filters: [plan.status !== 'all' ? `status: ${plan.status}` : null, plan.carrier ? `carrier: ${plan.carrier}` : null,
        plan.region ? `region: ${plan.region}` : null, plan.sku ? `SKU: ${plan.sku}` : null,
        plan.start_date || plan.end_date ? `order date: ${plan.start_date || 'dataset start'} to ${plan.end_date || 'dataset end'}` : null].filter(Boolean),
      rowsConsidered: filtered.length,
      method: 'Computed from validated order rows; rates use delivered + delayed statuses as the completed cohort.',
    },
    chart: { type: chartType, title: `${labels[plan.metric]} by ${plan.dimension === 'none' ? 'all orders' : plan.dimension.replace('_', ' ')}`, series: results },
    table: results.slice(0, 50),
    summary: { rowsMatched: filtered.length, completedCount, delivered, delayed, aggregate },
  };
}

function formatAnswer(metric, value, total, matched, results, dimension) {
  if (metric === 'delay_rate') {
    if (value == null) return `No completed orders matched (${matched} rows).`;
    if (['carrier', 'destination', 'region', 'product_category', 'sku'].includes(dimension) && results.length) {
      const highest = results[0];
      return `${highest.label} has the highest delay rate at ${((highest.value || 0) * 100).toFixed(1)}% (${highest.delayed} delayed of ${highest.completed} completed orders).`;
    }
    return `The delay rate is ${(value * 100).toFixed(1)}% across ${total} matching orders classified as delivered or delayed.`;
  }
  if (metric === 'delivery_days') return value == null ? `No matching orders have a delivery date (${matched} rows).` : `Average elapsed delivery time is ${value.toFixed(1)} days across matching orders with a delivery date.`;
  if (metric === 'revenue') return `Matching order value totals $${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}.`;
  if (metric === 'units') return `${value.toLocaleString('en-US')} units across ${matched} matching orders.`;
  if (metric === 'delayed_orders') {
    return `${value} delayed orders among ${matched} matching orders.`;
  }
  return `${value} orders match the selected filters.`;
}

export function dashboardData(rows, startDate, endDate) {
  const firstDate = rows.reduce((min, row) => row.orderDate < min ? row.orderDate : min, rows[0].orderDate);
  const lastDate = rows.reduce((max, row) => row.orderDate > max ? row.orderDate : max, rows[0].orderDate);
  const start = startDate || firstDate;
  const end = endDate || lastDate;
  const data = rows.filter((row) => row.orderDate >= start && row.orderDate <= end);
  const delivered = data.filter((row) => row.status === 'delivered').length;
  const delayed = data.filter((row) => row.status === 'delayed').length;
  const cohort = delivered + delayed;
  const deliveryRows = data.filter((row) => row.deliveryDate && ['delivered', 'delayed'].includes(row.status));
  const avgDays = deliveryRows.length ? deliveryRows.reduce((sum, row) => sum + (Date.parse(`${row.deliveryDate}T00:00:00Z`) - Date.parse(`${row.orderDate}T00:00:00Z`)) / DAY_MS, 0) / deliveryRows.length : null;
  const monthMap = new Map();
  const carrierMap = new Map();
  for (const row of data) {
    const month = row.orderDate.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + 1);
    if (!carrierMap.has(row.carrier)) carrierMap.set(row.carrier, { label: row.carrier, orders: 0, delivered: 0, delayed: 0 });
    const carrier = carrierMap.get(row.carrier);
    carrier.orders += 1;
    if (row.status === 'delivered') carrier.delivered += 1;
    if (row.status === 'delayed') carrier.delayed += 1;
  }
  const volume = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
  const carriers = [...carrierMap.values()].sort((a, b) => b.delayed / Math.max(1, b.delayed + b.delivered) - a.delayed / Math.max(1, a.delayed + a.delivered)).map((c) => ({
    ...c, rate: c.delayed + c.delivered ? c.delayed / (c.delayed + c.delivered) : null,
  }));
  const performance = [
    { label: 'Delivered status', value: delivered }, { label: 'Delayed status', value: delayed },
    { label: 'Other / open', value: data.length - delivered - delayed },
  ];
  return {
    filters: { startDate: start, endDate: end, datasetStart: firstDate, datasetEnd: lastDate },
    kpis: { totalOrders: data.length, deliveredOrders: delivered, delayedOrders: delayed, onTimeRateProxy: cohort ? delivered / cohort : null, avgDeliveryDays: avgDays, completedOrders: cohort },
    charts: { orderVolume: volume, deliveryPerformance: performance, carriers: carriers.slice(0, 8) },
    recentOrders: [...data].sort((a, b) => b.orderDate.localeCompare(a.orderDate)).slice(0, 8).map((r) => ({
      orderId: r.orderId, orderDate: r.orderDate, carrier: r.carrier, destination: r.destinationCity,
      status: r.status, sku: r.sku, quantity: r.quantity,
    })),
  };
}

export function isSupportedMetric(metric) { return METRICS.has(metric); }
