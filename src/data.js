import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeRows, parseCsv, COLUMNS, STATUSES } from './data-core.js';

export { normalizeRows, parseCsv, COLUMNS, STATUSES };

export async function loadDataset() {
  const filePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/mock_logistics_data.csv');
  const text = await readFile(filePath, 'utf8');
  return normalizeRows(text.replace(/^\uFEFF/, ''));
}
