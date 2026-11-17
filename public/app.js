const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const chartColors = ['#345e49', '#d8914f', '#89a693', '#547c68', '#bf6d55', '#7f9e8b'];
const number = new Intl.NumberFormat('en-US');
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const dateLabel = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
const monthLabel = (value) => new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function svgNode(tag, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}
function showError(host, message) {
  host.replaceChildren(element('div', 'notice notice-error', message));
}
function setLoading(button, loading, label) {
  button.disabled = loading;
  button.setAttribute('aria-busy', String(loading));
  button.textContent = loading ? 'Working…' : label;
}

function drawChart(host, config, { height = 260, lineData = null } = {}) {
  const points = lineData || config.series || [];
  const visible = points.length > 18 ? points.slice(-18) : points;
  if (!visible.length || visible.every((point) => point.value == null && point.units == null)) {
    host.replaceChildren(element('div', 'empty-chart', 'No matching rows for this selection.'));
    return;
  }
  const labels = visible.map((point) => point.label ?? point.month);
  const values = visible.map((point) => Number(point.value ?? point.units ?? 0));
  const width = Math.max(320, host.clientWidth || 520);
  const margin = { top: 16, right: 16, bottom: 42, left: 42 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const max = Math.max(1, ...values);
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': config.title || 'Data chart', preserveAspectRatio: 'none' });
  const axis = svgNode('line', { x1: margin.left, x2: width - margin.right, y1: margin.top + innerH, y2: margin.top + innerH, class: 'chart-axis' });
  svg.append(axis);
  for (let tick = 0; tick <= 3; tick += 1) {
    const y = margin.top + innerH - (tick / 3) * innerH;
    svg.append(svgNode('line', { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: 'chart-gridline' }));
    const label = svgNode('text', { x: margin.left - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-tick' });
    label.textContent = tick === 0 ? '0' : formatShort(max * tick / 3, config.metric);
    svg.append(label);
  }
  const step = innerW / visible.length;
  const isLine = config.type === 'line';
  const linePoints = [];
  for (let i = 0; i < visible.length; i += 1) {
    const x = margin.left + step * (i + 0.5);
    const y = margin.top + innerH - (values[i] / max) * innerH;
    linePoints.push(`${x},${y}`);
    const xLabel = svgNode('text', { x, y: height - 12, 'text-anchor': 'middle', class: 'chart-tick' });
    xLabel.textContent = formatLabel(labels[i]);
    svg.append(xLabel);
    if (!isLine) {
      const barW = Math.min(38, step * 0.6);
      const bar = svgNode('rect', { x: x - barW / 2, y, width: barW, height: margin.top + innerH - y, rx: 5, fill: chartColors[0], class: 'chart-bar' });
      const title = svgNode('title'); title.textContent = `${labels[i]}: ${values[i]}`; bar.append(title); svg.append(bar);
    }
  }
  if (isLine) {
    svg.append(svgNode('polyline', { points: linePoints.join(' '), fill: 'none', stroke: chartColors[0], 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    visible.forEach((point, i) => {
      const x = margin.left + step * (i + 0.5);
      const y = margin.top + innerH - (values[i] / max) * innerH;
      const circle = svgNode('circle', { cx: x, cy: y, r: 4, fill: '#fff', stroke: chartColors[0], 'stroke-width': 2 });
      const title = svgNode('title'); title.textContent = `${labels[i]}: ${values[i]}`; circle.append(title); svg.append(circle);
    });
  }
  host.replaceChildren(svg);
}
function drawForecastChart(host, config) {
  const merged = [
    ...(config.history || []).map((point) => ({ ...point, label: point.month, value: point.units, color: chartColors[0] })),
    ...(config.forecast || []).map((point) => ({ ...point, label: point.month, value: point.units, color: '#d8914f' })),
  ];
  const width = Math.max(320, host.clientWidth || 600);
  const height = 270;
  const margin = { top: 16, right: 16, bottom: 42, left: 42 };
  const iw = width - margin.left - margin.right; const ih = height - margin.top - margin.bottom;
  const max = Math.max(1, ...merged.map((point) => point.units)); const step = iw / merged.length;
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': config.title, preserveAspectRatio: 'none' });
  for (let tick = 0; tick <= 3; tick += 1) {
    const y = margin.top + ih - (tick / 3) * ih;
    svg.append(svgNode('line', { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: 'chart-gridline' }));
    const lab = svgNode('text', { x: margin.left - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-tick' }); lab.textContent = String(Math.round(max * tick / 3)); svg.append(lab);
  }
  for (let i = 0; i < merged.length; i += 1) {
    const x = margin.left + step * (i + 0.5); const y = margin.top + ih - (merged[i].units / max) * ih;
    const rect = svgNode('rect', { x: x - Math.min(16, step * 0.26), y, width: Math.min(32, step * 0.52), height: margin.top + ih - y, rx: 4, fill: i < (config.history || []).length ? chartColors[0] : chartColors[1] });
    const title = svgNode('title'); title.textContent = `${merged[i].month}: ${merged[i].units.toFixed(1)} units`; rect.append(title); svg.append(rect);
    const lab = svgNode('text', { x, y: height - 12, 'text-anchor': 'middle', class: 'chart-tick' }); lab.textContent = formatLabel(merged[i].month); svg.append(lab);
  }
  host.replaceChildren(svg);
}
function formatShort(value, metric = '') {
  if (metric === 'delay_rate') return percent.format(value);
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : Number(value).toFixed(value % 1 ? 1 : 0);
}
function formatLabel(value) {
  if (/^\d{4}-\d{2}$/.test(value)) return monthLabel(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dateLabel(value).replace(/, \d{4}/, '');
  return value.length > 13 ? `${value.slice(0, 11)}…` : value;
}

function renderKpis(data) {
  const list = [
    ['Total orders', number.format(data.kpis.totalOrders), 'All statuses in range', '↗', 'green'],
    ['Delivered', number.format(data.kpis.deliveredOrders), 'Delivered status', '✓', 'light'],
    ['Delayed', number.format(data.kpis.delayedOrders), 'Delayed status', '!', 'peach'],
    ['On-time rate*', data.kpis.onTimeRateProxy == null ? '—' : percent.format(data.kpis.onTimeRateProxy), `${number.format(data.kpis.completedOrders)} completed-status orders`, '◉', 'mint'],
    ['Avg delivery time', data.kpis.avgDeliveryDays == null ? '—' : `${data.kpis.avgDeliveryDays.toFixed(1)}d`, 'Completed orders with a delivery date', '◷', 'sand'],
  ];
  const host = $('#kpis'); host.replaceChildren();
  for (const [title, value, subtitle, icon, tone] of list) {
    const card = element('article', `kpi-card tone-${tone}`);
    const top = element('div', 'kpi-top'); top.append(element('span', 'kpi-title', title), element('span', 'kpi-icon', icon));
    card.append(top, element('strong', 'kpi-value', value), element('span', 'kpi-subtitle', subtitle));
    host.append(card);
  }
}
function renderDashboardContent(data) {
  window.currentDashboard = data;
  renderKpis(data);
  $('#range-label').textContent = `${dateLabel(data.filters.startDate)} – ${dateLabel(data.filters.endDate)}`;
  $('#orders-count').textContent = `${number.format(data.kpis.totalOrders)} rows in view · read-only`;
  drawChart($('#volume-chart'), { type: 'line', title: 'Order volume by month', series: data.charts.orderVolume });
  drawChart($('#performance-chart'), { type: 'bar', title: 'Delivery status counts', series: data.charts.deliveryPerformance });
  drawChart($('#carrier-chart'), { type: 'bar', metric: 'delay_rate', title: 'Delay rate by carrier', series: data.charts.carriers.map((carrier) => ({ label: carrier.label, value: carrier.rate ?? 0 })) });
  const body = $('#orders-body'); body.replaceChildren();
  if (!data.recentOrders.length) {
    const row = element('tr'); const cell = element('td', 'empty-cell', 'No orders match this date range.'); cell.colSpan = 7; row.append(cell); body.append(row); return;
  }
  for (const order of data.recentOrders) {
    const row = element('tr');
    row.append(element('td', 'mono', order.orderId), element('td', '', order.orderDate), element('td', '', order.carrier), element('td', '', order.destination), element('td', 'mono', order.sku), element('td', '', number.format(order.quantity)));
    const status = element('td'); const badge = element('span', `status-badge status-${order.status.replace('_', '-')}`, order.status.replace('_', ' ')); status.append(badge); row.append(status); body.append(row);
  }
}
function appendResultTable(parent, rows, isRate) {
  const details = element('details', 'underlying-data');
  const summary = element('summary', '', 'Inspect computed data'); details.append(summary);
  const wrapper = element('div', 'table-scroll'); const table = element('table'); const head = element('thead'); const headRow = element('tr');
  const keys = rows.length ? Object.keys(rows[0]) : [];
  for (const key of keys) headRow.append(element('th', '', key.replaceAll('_', ' ')));
  head.append(headRow); table.append(head);
  const body = element('tbody');
  for (const item of rows.slice(0, 50)) {
    const row = element('tr');
    for (const key of keys) {
      let value = item[key];
      if (key === 'value' && isRate && typeof value === 'number') value = percent.format(value);
      else if (typeof value === 'number') value = Number.isInteger(value) ? number.format(value) : value.toFixed(2);
      row.append(element('td', '', value == null ? '—' : String(value)));
    }
    body.append(row);
  }
  table.append(body); wrapper.append(table); details.append(wrapper); parent.append(details);
}
function renderAnalysis(host, result, kind = 'query') {
  host.replaceChildren();
  const panel = element('article', `panel result-card ${kind === 'forecast' ? 'forecast-result-card' : ''}`);
  const top = element('div', 'result-top');
  const intro = element('div'); intro.append(element('p', 'panel-label', result.plan?.tool || 'COMPUTED RESULT'), element('h3', '', kind === 'forecast' ? 'Demand outlook' : 'Analysis result'));
  top.append(intro, element('span', 'pill pill-computed', result.interpreter || 'Computed from dataset'));
  panel.append(top, element('p', 'result-answer', result.answer));
  if (result.recommendation) {
    const recommendation = element('div', 'recommendation');
    recommendation.append(element('span', 'recommendation-icon', '↗'), element('div', '', result.recommendation.text));
    const confidence = element('span', `confidence confidence-${result.recommendation.confidence.replace(' ', '-')}`, `${result.recommendation.confidence} confidence`);
    recommendation.append(confidence); panel.append(recommendation);
  }
  if (result.chart) {
    const chartHead = element('div', 'result-chart-heading'); chartHead.append(element('h4', '', result.chart.title));
    if (result.chart.type === 'line' && result.chart.history) {
      const legend = element('span', 'legend'); legend.append(element('span', 'legend-history', 'History'), element('span', 'legend-forecast', 'Forecast')); chartHead.append(legend);
    }
    panel.append(chartHead);
    const chartHost = element('div', 'chart-host result-chart'); panel.append(chartHost);
    requestAnimationFrame(() => result.chart.history ? drawForecastChart(chartHost, result.chart) : drawChart(chartHost, { ...result.chart, metric: result.plan.metric === 'Delay rate' ? 'delay_rate' : '' }, { height: 260 }));
  }
  const meta = element('div', 'explainability-grid');
  meta.append(metaItem('Measure', result.plan.metric || '—'), metaItem('Grouped by', result.plan.dimension || '—'), metaItem('Filters', result.plan.filters?.length ? result.plan.filters.join(' · ') : 'No additional filters'), metaItem('Method', result.plan.method || 'Deterministic aggregation'), metaItem('Interpreter', result.plan.interpreter || result.interpreter || 'Application')); 
  panel.append(meta);
  if (result.table?.length) appendResultTable(panel, result.table, result.plan.metric === 'Delay rate');
  host.append(panel);
  if (kind === 'query') host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function metaItem(label, value) {
  const item = element('div', 'explainability-item'); item.append(element('span', '', label), element('strong', '', value)); return item;
}

async function loadDashboard() {
  const start = $('#date-start').value; const end = $('#date-end').value;
  const query = new URLSearchParams(); if (start) query.set('start_date', start); if (end) query.set('end_date', end);
  try { renderDashboardContent(await request(`/api/dashboard?${query}`)); }
  catch (error) { showError($('#kpis'), error.message); }
}
async function submitQuestion(event) {
  event.preventDefault();
  const button = $('#ask-button'); const host = $('#query-result'); const question = $('#query-input').value.trim();
  if (!question) return;
  setLoading(button, true, 'Run analysis'); host.replaceChildren(element('div', 'notice notice-loading', 'Interpreting the question and computing from the dataset…'));
  try { renderAnalysis(host, await request('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) })); }
  catch (error) { showError(host, error.message); }
  finally { setLoading(button, false, 'Run analysis'); }
}
async function submitForecast(event) {
  event.preventDefault();
  const button = $('#forecast-button'); const host = $('#forecast-result');
  const sku = $('#sku-select').value; const horizon = Number($('#horizon-select').value);
  if (!sku) { showError(host, 'Choose an SKU from the list.'); return; }
  setLoading(button, true, 'Generate forecast'); host.replaceChildren(element('div', 'notice notice-loading', 'Computing the SKU demand baseline…'));
  try { renderAnalysis(host, await request('/api/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku, horizon }) }), 'forecast'); }
  catch (error) { showError(host, error.message); }
  finally { setLoading(button, false, 'Generate forecast'); }
}
async function boot() {
  try {
    const meta = await request('/api/meta');
    $('#dataset-caption').textContent = `${number.format(meta.dataset.rows)} source orders`;
    const aiStatus = $('#ai-status');
    aiStatus.textContent = meta.aiConfigured ? 'AI mode · OpenAI connected' : 'AI mode · rules-based';
    aiStatus.classList.toggle('ai-status-live', meta.aiConfigured);
    $('#date-start').min = meta.dataset.startDate; $('#date-start').max = meta.dataset.endDate; $('#date-start').value = meta.dataset.startDate;
    $('#date-end').min = meta.dataset.startDate; $('#date-end').max = meta.dataset.endDate; $('#date-end').value = meta.dataset.endDate;
    const select = $('#sku-select'); select.replaceChildren(new Option('Select an SKU', ''));
    for (const sku of meta.skus) select.add(new Option(sku, sku));
    const skuSearch = $('#sku-search'); const skuOptions = $('#sku-options');
    const closeSkuOptions = () => { skuOptions.hidden = true; skuSearch.setAttribute('aria-expanded', 'false'); };
    const renderSkuOptions = () => {
      const query = skuSearch.value.trim().toLowerCase();
      const matches = meta.skus.filter((sku) => sku.toLowerCase().includes(query));
      skuOptions.replaceChildren(...matches.map((sku) => {
        const option = element('li', '', sku); option.setAttribute('role', 'option'); option.tabIndex = -1;
        option.setAttribute('aria-selected', String(select.value === sku));
        option.addEventListener('mousedown', (event) => event.preventDefault());
        option.addEventListener('click', () => { select.value = sku; skuSearch.value = sku; closeSkuOptions(); });
        return option;
      }));
      skuOptions.hidden = false; skuSearch.setAttribute('aria-expanded', 'true');
    };
    skuSearch.addEventListener('focus', renderSkuOptions);
    skuSearch.addEventListener('input', renderSkuOptions);
    skuSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSkuOptions();
      if (event.key === 'ArrowDown' && !skuOptions.hidden) { event.preventDefault(); skuOptions.querySelector('[role="option"]')?.focus(); }
    });
    document.addEventListener('click', (event) => { if (!event.target.closest('.sku-picker')) closeSkuOptions(); });
    if (meta.skus.includes(meta.recommendedForecastSku)) { select.value = meta.recommendedForecastSku; skuSearch.value = meta.recommendedForecastSku; }
    await loadDashboard();
  } catch (error) {
    $('#dataset-caption').textContent = 'Dataset unavailable';
    showError($('#kpis'), error.message);
  }
  $('#apply-dates').addEventListener('click', loadDashboard);
  $('#query-form').addEventListener('submit', submitQuestion);
  $('#forecast-form').addEventListener('submit', submitForecast);
  for (const chip of $$('.example-chip')) chip.addEventListener('click', () => { $('#query-input').value = chip.textContent; $('#query-input').focus(); });
window.addEventListener('resize', () => { if (window.currentDashboard) renderDashboardContent(window.currentDashboard); });
}

boot();
