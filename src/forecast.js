const DAY_MS = 86_400_000;

function monthAfter(yyyyMm, offset) {
  const [year, month] = yyyyMm.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

export function forecastDemand(rows, sku, horizon) {
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 6) throw new Error('Choose a forecast horizon from 1 to 6 months.');
  const matching = rows.filter((row) => row.sku === sku && row.status !== 'canceled');
  if (matching.length === 0) throw new Error('No non-canceled history is available for that SKU.');
  const firstMonth = rows.reduce((min, row) => row.orderDate.slice(0, 7) < min ? row.orderDate.slice(0, 7) : min, rows[0].orderDate.slice(0, 7));
  const lastMonth = rows.reduce((max, row) => row.orderDate.slice(0, 7) > max ? row.orderDate.slice(0, 7) : max, rows[0].orderDate.slice(0, 7));
  const monthUnits = new Map();
  for (const row of matching) {
    const month = row.orderDate.slice(0, 7);
    monthUnits.set(month, (monthUnits.get(month) || 0) + row.quantity);
  }
  const history = [];
  for (let month = firstMonth, i = 0; month <= lastMonth && i < 36; month = monthAfter(firstMonth, ++i)) {
    history.push({ month, units: monthUnits.get(month) || 0 });
  }
  const recent = history.slice(-3);
  const forecastUnits = recent.reduce((sum, point) => sum + point.units, 0) / recent.length;
  const forecast = Array.from({ length: horizon }, (_, index) => ({
    month: monthAfter(lastMonth, index + 1), units: forecastUnits,
  }));
  const observedMonths = history.filter((point) => point.units > 0).length;
  const totalUnits = matching.reduce((sum, row) => sum + row.quantity, 0);
  const horizonDemand = forecast.reduce((sum, point) => sum + point.units, 0);
  const source = rows.filter((row) => row.sku === sku);
  const lastOrder = source.reduce((max, row) => row.orderDate > max ? row.orderDate : max, source[0].orderDate);
  const lastDate = rows.reduce((max, row) => row.orderDate > max ? row.orderDate : max, rows[0].orderDate);
  const recencyDays = Math.floor((Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${lastOrder}T00:00:00Z`)) / DAY_MS);
  const confidence = observedMonths >= 6 && recencyDays < 90 ? 'moderate' : observedMonths >= 3 && recencyDays < 180 ? 'low' : 'very low';
  return {
    sku, horizon,
    answer: `Baseline forecast: ${Math.ceil(horizonDemand)} units over ${horizon} months (${forecastUnits.toFixed(1)} units per month).`,
    plan: {
      tool: 'Demand forecasting', metric: 'Monthly ordered quantity', dimension: 'month',
      filters: [`SKU: ${sku}`, 'Canceled orders excluded', `History: ${firstMonth} to ${lastMonth}`],
      rowsConsidered: matching.length,
      method: `Simple moving average of the last ${recent.length} calendar months, including months with zero orders. Forecast is held constant for each future month.`,
    },
    chart: { type: 'line', title: `Historical and forecast demand · ${sku}`, history, forecast },
    table: [...history.slice(-6).map((point) => ({ ...point, series: 'History' })), ...forecast.map((point) => ({ ...point, series: 'Forecast' }))],
    recommendation: {
      units: Math.ceil(horizonDemand), horizonMonths: horizon,
      text: `Plan for approximately ${Math.ceil(horizonDemand)} units across the next ${horizon} months before adjusting for on-hand stock, replenishment lead time, and safety stock.`,
      confidence, observedMonths, totalUnits, lastOrder,
    },
  };
}
