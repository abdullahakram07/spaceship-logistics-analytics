# Spaceship Senior Engineer Code Test Checklist

Source: `Coding_assignment.docx`, `logistics-spec.docx`, `logistics-spec.pdf`, and `mock_logistics_data.csv`.

## Assignment understanding

- [x] Read the full coding assignment, including evaluation weights and deliverables.
- [x] Read the logistics specification DOCX and PDF; confirm they agree on requirements.
- [x] Inspect the provided dataset schema, coverage, nulls, and key categories.
- [x] Record data assumptions and unsupported interpretations in the README.

## Product and dashboard

- [x] Build a logistics analytics dashboard over the single supplied dataset.
- [x] Show total orders.
- [x] Show delivered orders.
- [x] Show delayed orders.
- [x] Show on-time delivery rate, clearly disclosing its proxy definition because there is no promised/ETA date field.
- [x] Show average delivery time for completed-status rows with delivery dates.
- [x] Show order volume over time.
- [x] Show delivery performance (delayed versus delivered / other status).
- [x] Show carrier breakdown with delay rates.
- [x] Make the interface responsive; local preview rendered successfully.

## Analytics query and AI orchestration

- [x] Accept natural-language operational questions for a documented supported subset.
- [x] Interpret questions into a validated structured plan (metric, grouping, filters, time range).
- [x] Route plans to deterministic analytics or forecasting tools; numeric answers always come from computation.
- [x] Do not execute model-generated SQL; validate dimensions, metrics, filters, and dates.
- [x] Return a direct answer and dynamically selected chart when applicable.
- [x] Explain filters, metrics, dimensions, and computation plan for answers/charts.
- [x] Expose grouped rows through an expandable results table.
- [x] Handle unsupported/ambiguous questions with a clear response.
- [x] Preserve read-only access to the supplied source data.

## Forecasting

- [x] Forecast future demand from historical supplied data for a requested SKU and horizon.
- [x] Use and disclose a deterministic trailing moving-average method.
- [x] Return forecast values and a chart containing historical and forecast values.
- [x] Include a demand-based inventory planning baseline and state stock/lead-time data is unavailable.
- [x] Explain sparse SKU history and forecast confidence limits.
- [x] Validate requested SKU and forecast horizon.

## Engineering and quality

- [x] Separate question interpretation, tool selection, computation, and presentation.
- [x] Validate and normalize dataset rows at the application boundary.
- [x] Keep the architecture simple, maintainable, and dependency-light; no third-party runtime dependencies.
- [x] Cover major workflows and important edge cases with tests (14 Node tests and packaged Worker validation).
- [x] Verify app start and build steps locally.
- [x] Check local UI, loading/error/empty states, and basic accessibility semantics.
- [x] Review project files and ignore rules; no API secrets are committed.

## Documentation and delivery

- [x] Write README with setup, environment variables, architecture, data flow, AI approach, assumptions, limitations, unsupported queries, and future improvements.
- [x] Initialize Git and create progressive commits with meaningful messages in `assessment/`.
- [x] Create a public repository under `abdullahakram07` and push the finished source.
- [x] Deploy the application to Vercel and verify the public domain and production deployment.
- [x] Configure the server-side production `OPENAI_API_KEY`; confirm `/api/meta` reports AI configured and run a live Responses API query.
- [ ] Prepare a technical walkthrough script for the Loom recording.
- [ ] Record the walkthrough in Loom, set sharing to anyone with the link, and add the verified URL to the final submission.

## Remaining delivery item

- Loom: prepare and record the walkthrough, set sharing to anyone with the link, then add the verified URL to the final submission.

## Verified delivery

- Public repository: `https://github.com/abdullahakram07/spaceship-logistics-analytics`.
- Production app: `https://spaceship-logistics-analytics-drab.vercel.app/`.
- Vercel production deployment is Ready and includes the production OpenAI secret.
- Live `/api/meta` reports `aiConfigured: true`; a live natural-language query returned a computed result marked `OpenAI function routing (gpt-4o-mini)`.
- No login is required for the public app.

## Data notes observed during initial inspection

- 400 rows, 17 columns, 400 unique order IDs, no missing values except 30 empty `delivery_date` fields.
- Orders span 2025-01-01 through 2025-12-30; delivery dates span 2025-01-02 through 2025-12-31.
- Status values include `delivered`, `delayed`, `in_transit`, `exception`, and `canceled`.
- There is no promised/estimated delivery date or explicit SLA field. On-time delivery cannot be measured directly; any dashboard proxy must be stated plainly.
- There are 355 distinct SKUs across 400 orders, so many SKU histories are sparse. Forecasts need to disclose this limitation.
- The dataset has no current inventory, replenishment lead time, or safety-stock data; inventory advice can only be a demand-based planning baseline.
