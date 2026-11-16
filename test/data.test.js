import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, normalizeRows, loadDataset } from '../src/data.js';

test('CSV parser preserves commas and escaped quotes inside quoted values', () => {
  assert.deepEqual(parseCsv('name,city\n"Mira, A.","Port ""Harbor"""'), [
    ['name', 'city'], ['Mira, A.', 'Port "Harbor"'],
  ]);
});

test('provided logistics dataset loads with validated rows and unique order IDs', async () => {
  const rows = await loadDataset();
  assert.equal(rows.length, 400);
  assert.equal(new Set(rows.map((row) => row.orderId)).size, rows.length);
  assert.equal(rows.filter((row) => row.deliveryDate == null).length, 30);
});

test('dataset normalization rejects a duplicate order ID', () => {
  const fields = ['CL-1','ORD-1','2025-01-01','2025-01-02','Carrier','Origin','Destination','delivered','SKU-0001','BOOK','1','4','4','0','0','UK','WH-1'];
  const input = `client_id,order_id,order_date,delivery_date,carrier,origin_city,destination_city,status,sku,product_category,quantity,unit_price_usd,order_value_usd,is_promo,promo_discount_pct,region,warehouse\n${fields.join(',')}\n${fields.join(',')}`;
  assert.throws(() => normalizeRows(input), /duplicate order_id/);
});
