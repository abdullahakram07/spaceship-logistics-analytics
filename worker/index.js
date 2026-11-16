import { normalizeRows } from './src/data-core.js';
import { createApiHandler } from './src/api.js';
import { CSV_TEXT } from './dataset.js';
import { ASSETS } from './assets.js';

const rows = normalizeRows(CSV_TEXT.replace(/^\uFEFF/, ''));
const apiHandler = createApiHandler(rows);
const MIME = { '/index.html': 'text/html; charset=utf-8', '/styles.css': 'text/css; charset=utf-8', '/app.js': 'text/javascript; charset=utf-8' };
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

export default {
  async fetch(request, env) {
    const apiResponse = await apiHandler(request, {
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      clientAddress: request.headers.get('cf-connecting-ip') || 'unknown',
    });
    if (apiResponse) return apiResponse;
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, HEAD' } });
    const assetPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const asset = ASSETS[assetPath];
    if (asset == null) return new Response('Not found', { status: 404, headers: securityHeaders });
    return new Response(request.method === 'HEAD' ? null : asset, {
      headers: { ...securityHeaders, 'Content-Type': MIME[assetPath] || 'application/octet-stream', 'Cache-Control': 'no-cache' },
    });
  },
};
