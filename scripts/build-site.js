import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const server = path.join(output, 'server');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(server, 'src'), { recursive: true });
await mkdir(path.join(output, '.openai'), { recursive: true });
for (const file of ['analytics.js', 'api.js', 'data-core.js', 'forecast.js', 'interpreter.js']) {
  await cp(path.join(root, 'src', file), path.join(server, 'src', file));
}
const assets = {};
for (const file of ['index.html', 'styles.css', 'app.js']) assets[`/${file}`] = await readFile(path.join(root, 'public', file), 'utf8');
await writeFile(path.join(server, 'assets.js'), `export const ASSETS = ${JSON.stringify(assets)};\n`);
const csv = await readFile(path.join(root, 'data', 'mock_logistics_data.csv'), 'utf8');
await writeFile(path.join(server, 'dataset.js'), `export const CSV_TEXT = ${JSON.stringify(csv)};\n`);
await cp(path.join(root, 'worker', 'index.js'), path.join(server, 'index.js'));
await writeFile(path.join(server, 'package.json'), '{"type":"module"}\n');
await cp(path.join(root, '.openai', 'hosting.json'), path.join(output, '.openai', 'hosting.json'));
console.log(`Built Sites Worker into ${path.relative(root, output)}`);
