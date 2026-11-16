# Northstar Logistics Analytics

A compact, read-only logistics operations dashboard with natural-language analytics and SKU demand forecasting. The app uses one supplied dataset: the 400-row mock order CSV spanning January–December 2025.

## Features

- Descriptive dashboard: total, delivered-status, and delayed-status order counts; a delivery-time average; a disclosed status-based on-time proxy; order volume, status, and carrier charts.
- Natural-language questions for order counts, late orders, delay rates, delivery time, revenue, unit volume, and supported groupings over an explicitly bounded subset.
- Dynamic line charts for time groupings and bar charts for categorical groupings, with the grouped rows available as a table.
- SKU-level monthly demand baselines with historical and forecast periods, a planning quantity, and a method/confidence explanation.
- Read-only data access; no model-generated SQL and no model-generated numeric answer.

## Run locally

Requirements: Node.js 20 or newer. There are no third-party runtime dependencies.

```sh
npm test
npm start
```

Open `http://localhost:3000`. For automatic local restarts during development, use `npm run dev`.

Copy `.env.example` to `.env` or set environment variables in the shell before starting the server. The app does not load `.env` files automatically, so use a local environment loader only if you already have one, or export the variables directly.

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | No for local rules-based mode; required for AI tool routing | Server-only API credential. Never expose it to browser code or commit it. |
| `OPENAI_MODEL` | No | OpenAI model used for Responses API function routing; defaults to `gpt-4o-mini`. |
| `PORT` | No | HTTP listener port; defaults to `3000`. |

When `OPENAI_API_KEY` is absent, a small rules-based interpreter handles the documented examples. The UI labels that mode clearly. If a key is configured but the AI service is unavailable, the app shows an error instead of silently returning a fallback result.

## Architecture

```text
Browser UI
  ├── GET /api/meta and /api/dashboard
  ├── POST /api/query ── interpreter ── allowlist validation ── analytics / forecasting tool
  └── POST /api/forecast ─────────────────────────────────────── forecasting tool
                                                               │
                                              validated in-memory CSV rows (read-only)
```

- `src/data.js` parses quoted CSV fields and validates the exact schema, dates, numeric fields, status labels, and unique order IDs at startup.
- `src/server.js` serves the static UI and adapts HTTP requests to the shared JSON API handler in `src/api.js`. The handler enforces request-size/content-type checks, basic response security headers, and a per-process query rate limit.
- `src/interpreter.js` routes questions to one of the supported analytical functions. When configured, it uses the OpenAI Responses API with strict function tools. Only the user's question and fixed routing instructions are sent to the model; source rows are not sent. Without a key, supported phrases map through explicit local rules.
- `src/analytics.js` validates dimensions, metrics, filters, and dates against fixed allowlists and computes results from normalized rows.
- `src/forecast.js` aggregates monthly SKU quantities and applies a simple trailing three-calendar-month moving average. The forecasting code never asks the model to calculate the output.
- `worker/index.js` is the edge deployment entrypoint. `scripts/build-site.js` packages the shared analytics modules, dataset, and UI into the Sites Worker artifact.
- `public/` contains the responsive interface and native SVG chart rendering. No third-party chart library or external browser script is used.

The model selects a structured tool and parameters; deterministic application code validates them, computes all numeric values, and builds the user-facing explanation. No raw SQL is generated or executed. The API request sets `store: false`. Tool routing uses the OpenAI [Responses API function-calling interface](https://developers.openai.com/api/docs/guides/function-calling).

## Analytics definitions and assumptions

- Date filters use `order_date`. Relative phrases such as “last month” are resolved against the latest order date in the supplied dataset, not the server clock. “Last 3 months” means the last three calendar months represented by that dataset.
- `delivered` and `delayed` are treated as the completed-status cohort. The dataset has no promised/estimated delivery date or SLA, so the dashboard's on-time rate is explicitly a proxy: `delivered / (delivered + delayed)`. It is not a measured SLA-compliance rate.
- Delayed orders are identified by `status = delayed`.
- Average delivery time is elapsed calendar days between `order_date` and `delivery_date` for rows with `delivered` or `delayed` status and a delivery date. Open, exception, and canceled rows are excluded.
- Delivery performance groups all other statuses into “Other / open.” Order counts include all statuses unless a question applies a status filter.
- Delay rates use `delayed / (delivered + delayed)` within the selected group. A grouped rate includes the cohort denominator in the returned computed table.
- Demand is measured as ordered units by calendar month. Canceled rows are excluded from the SKU forecast. The forecast averages the trailing three calendar months, including zero-demand months, and repeats that average for the requested horizon (1–6 months).
- The inventory recommendation rounds total horizon demand up to a whole unit. It cannot account for on-hand inventory, open purchase orders, replenishment lead time, or safety stock because those values are not in the supplied data.
- Many SKUs have very little history (the dataset includes 355 SKUs and 400 orders); the UI reports a low-confidence flag when history is sparse or old. This baseline is an interpretable demonstration method, not an operational replenishment commitment.

## Supported query scope

Supported measures: order count, delayed-order count, delay rate, average delivery days, ordered units, and order value. Supported groupings: week, month, carrier, destination, region, product category, SKU, or no grouping. Supported filters: status, carrier, region, SKU, dataset-relative date windows, or an explicit date range. SKU forecasting supports one SKU and a 1–6 month horizon.

The application does not currently support arbitrary SQL, causal explanations, route optimization, individual order lookups, client-level analysis, custom joins, external live data, multi-SKU forecasts, inventory constraints, or custom forecasting model selection. Ambiguous or unsupported requests should be rephrased or narrowed.

## Quality and tests

Run `npm test` to validate CSV parsing/normalization, KPI and chart aggregations, query patterns, carrier rate math, date handling, forecast output, input rejection, and API routes. Run `npm run build:site && npm run validate:site` to verify the deployable Worker package and its API workflows. The tests use only Node's built-in test runner and the supplied dataset.

## Deployment

The app runs locally as a Node HTTP service. Its shared `Request`/`Response` API handler is also packaged for the assessment deployment as an edge Worker by `npm run build:site`; `npm run validate:site` checks the generated package and major API workflows. The generated `dist/` directory is deployment output and is not checked in. The Worker reads `OPENAI_API_KEY` and optional `OPENAI_MODEL` from the hosting environment. Do not put secrets in `public/`, `.env.example`, source control, or client-side JavaScript. The in-process rate limiter is best-effort; configure provider-level limits and monitoring for public use, and replace it with a shared limiter if scaling horizontally.

## Future improvements

- Obtain an authoritative promised-delivery/SLA field before reporting true on-time performance.
- Add larger and denser SKU/order history, inventory positions, supplier lead times, and forecast back-testing before using recommendations operationally.
- Add authentication and shared rate limiting if the application is opened beyond the assessment review.
- Add a question/query evaluation set, telemetry that excludes raw user prompts, and a documented model/version policy.
- Add optional confidence intervals and compare forecast methods using held-out months.
