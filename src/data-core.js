const COLUMNS = [
  'client_id', 'order_id', 'order_date', 'delivery_date', 'carrier', 'origin_city',
  'destination_city', 'status', 'sku', 'product_category', 'quantity',
  'unit_price_usd', 'order_value_usd', 'is_promo', 'promo_discount_pct', 'region', 'warehouse',
];
const STATUSES = new Set(['delivered', 'delayed', 'in_transit', 'exception', 'canceled']);

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((entry) => entry.some((value) => value !== ''));
}

function isoDate(value, field, orderId, optional = false) {
  if (optional && value === '') return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${field} for order ${orderId}`);
  }
  return value;
}

function numeric(value, field, orderId) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${field} for order ${orderId}`);
  return parsed;
}

export function normalizeRows(csvText) {
  const [headers, ...values] = parseCsv(csvText);
  if (!headers || headers.join('\0') !== COLUMNS.join('\0')) throw new Error('Unexpected dataset schema');
  const orderIds = new Set();
  const data = values.map((cells, index) => {
    if (cells.length !== COLUMNS.length) throw new Error(`Invalid column count on CSV row ${index + 2}`);
    const raw = Object.fromEntries(COLUMNS.map((key, column) => [key, cells[column]]));
    if (!raw.order_id || orderIds.has(raw.order_id)) throw new Error(`Missing or duplicate order_id on CSV row ${index + 2}`);
    orderIds.add(raw.order_id);
    if (!STATUSES.has(raw.status)) throw new Error(`Unknown status for order ${raw.order_id}`);
    const orderDate = isoDate(raw.order_date, 'order_date', raw.order_id);
    const deliveryDate = isoDate(raw.delivery_date, 'delivery_date', raw.order_id, true);
    if (deliveryDate && deliveryDate < orderDate) throw new Error(`Delivery precedes order date for order ${raw.order_id}`);
    const promo = raw.is_promo === '1';
    if (!['0', '1'].includes(raw.is_promo)) throw new Error(`Invalid is_promo for order ${raw.order_id}`);
    const quantity = numeric(raw.quantity, 'quantity', raw.order_id);
    const unitPriceUsd = numeric(raw.unit_price_usd, 'unit_price_usd', raw.order_id);
    const orderValueUsd = numeric(raw.order_value_usd, 'order_value_usd', raw.order_id);
    if (!Number.isInteger(quantity) || orderValueUsd < 0 || Number(raw.promo_discount_pct) > 100) {
      throw new Error(`Invalid quantity or discount for order ${raw.order_id}`);
    }
    return {
      clientId: raw.client_id,
      orderId: raw.order_id,
      orderDate,
      deliveryDate,
      carrier: raw.carrier,
      originCity: raw.origin_city,
      destinationCity: raw.destination_city,
      status: raw.status,
      sku: raw.sku,
      productCategory: raw.product_category,
      quantity,
      unitPriceUsd,
      orderValueUsd,
      isPromo: promo,
      promoDiscountPct: numeric(raw.promo_discount_pct, 'promo_discount_pct', raw.order_id),
      region: raw.region,
      warehouse: raw.warehouse,
    };
  });
  if (data.length === 0) throw new Error('Dataset is empty');
  return data;
}

export { COLUMNS, STATUSES };
