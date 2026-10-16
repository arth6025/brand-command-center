# Developer handover

You are taking over a working prototype. The front end and the metric engine
are production code; the data underneath is simulated. Your job is to replace
the simulated data with real ingestion, put it behind auth, and deploy it.

## Day 1: get oriented (about an hour)

```bash
npm install
npm run dev        # open http://localhost:5180
npm test           # 19 tests on the money rules
npm run build      # must pass: strict TypeScript, no warnings
```

Then read, in this order:

1. `README.md`: the problem and what each screen answers.
2. `src/domain/types.ts`: the warehouse contract. **This is the interface you build ingestion against.**
3. `src/metrics/core.ts`: the contribution ladder. Every other number derives from it.
4. `src/connectors/registry.ts`: every source, how it is pulled, which tables it lands.
5. `src/metrics/registry.ts`: the definition of every metric shown.

## What is done

- 15 screens, routing, date ranges with previous-period comparison, search, theming, responsive layout.
- Metric engine (`src/metrics/*`): pure functions over the warehouse tables, memoised per date range.
- Rules covered by tests: the ladder reconciles, break-even = 1 ÷ CM1%, gaps are never zero, verdict invariants, the Trading Room solver, freshness detection, refused report joins.
- Ask: payload builder (`src/ask/answer.ts`), local answerer, and a server proxy to Claude (`server/ask-proxy.mjs`).

## What you need to build

### 1. Ingestion (the bulk of the work)

Land the tables in `src/domain/types.ts` into a warehouse (BigQuery or Postgres). Recommended order,
by how much of the product each unlocks:

| Priority | Source | Method | Unlocks |
|---|---|---|---|
| P0 | Shopify (orders, customers, sessions) | Admin API + order webhooks | revenue, orders, funnel, retention |
| P0 | Meta Ads, Google Ads | Marketing API (System User, read-only) / Google Ads API | spend, campaigns, creatives |
| P0 | SKU cost sheet + governance rates | versioned Google Sheet or admin table | GM, CM1, CM2 |
| P1 | Razorpay | API + settlement webhooks | payment fees, reconciliation |
| P1 | Shiprocket / courier aggregator | API | freight, RTO, COD remittance, weight audit |
| P1 | GA4 → BigQuery export | native export | channel funnel |
| P1 | WMS (Unicommerce or similar) | API | stock, cover, batches |
| P2 | Amazon SP-API + Amazon Ads API | LWA apps | Amazon command centre |
| P2 | Blinkit, Zepto, Instamart, Nykaa, Myntra | scheduled portal report emails, parsed | quick commerce CM2, POs, dark stores |
| P2 | Flipkart Seller API | OAuth | Flipkart CM2 |
| P3 | ERPNext | API, read-only role | landed costs, opex |
| P3 | Triple Whale / Littledata | API | optional third attribution lens |

Notes:
- Use Airbyte/Fivetran where a connector exists; custom jobs for portal reports (parse the scheduled email attachments into `channel_daily`, `purchase_orders`, `dark_store_stock`).
- Every job writes a row to `connector_runs` (last sync time, latest business date, row count, status). Freshness on the Data health screen is computed from it, never set by hand.
- Store money in rupees ex-GST unless the field says gross; dates in IST. Re-date ad platform spend from account timezone to IST.
- Backfill 13 months so previous-year comparisons work.
- Credentials live in the ingestion service's secret store, never in the front end.

The field-by-field contract and the transformations are in [DATA-CONTRACT.md](DATA-CONTRACT.md).

### 2. Serve the data to the app

The app reads one `Warehouse` object through `src/data/source.ts`.

- **Simplest:** a backend endpoint returns the warehouse tables for the signed-in brand as JSON (the trailing ~7 months); switch `createDataSource()` to `loadSnapshot(url)` (already written: it validates required tables). The engine runs client-side as it does now. This is fine up to roughly 200k orders per window.
- **At scale:** move the heavier aggregates in `src/metrics/*` to SQL views or a small API that returns the same shapes (ladder, campaign rows, funnel steps…). Pages call the engine facade (`src/metrics/engine.ts`) only, so they don't change. Keep the unit tests as the spec for the SQL.

### 3. Auth, roles, persistence

- Put the app behind SSO (Google Workspace / Okta). Admin screens (Data health, Connectors) for admins only.
- Multi-brand: a brand selector in the sidebar; every warehouse query scoped by `brand_id`.
- Replace localStorage (`src/state/storage.ts`) for **decisions** (Recommendations) and **plans** (Trading Room) with tables: `decisions(rec_id, brand_id, action, owner, note, created_at, created_by)`, `plans(brand_id, month, version, status, rows_json, locked_by, locked_at)`. Theme and saved reports can stay in localStorage.

### 4. Deploy

- **Front end:** static build (`npm run build` → `dist/`) on Vercel, Netlify, Cloudflare Pages or S3 + CloudFront. It uses hash routing, so no server rewrites are needed.
- **Ask proxy:** `server/ask-proxy.mjs` is a dependency-free Node HTTP server (only `@anthropic-ai/sdk`). Run it as a serverless function or a small container behind the same auth. Route `/api/*` to it (Vite does this in dev, see `vite.config.ts`). Env: `ANTHROPIC_API_KEY`, `PORT`. It uses Claude Opus 5.5 with server-side refusal fallback; the system prompt restricts answers to the numbers it receives.
- **CI:** a ready GitHub Actions workflow is in `docs/ci.example.yml` (build + tests on every PR). Move it to `.github/workflows/ci.yml` and push from an account with workflow permission; it was kept out of the first push because the pushing token lacked the `workflow` scope.

### 5. Governance inputs the business must supply

- Packaging cost per order (currently "not set"; break-even is understated until it is).
- A complete, dated SKU cost sheet (one SKU, the Curl Cream, is deliberately missing in the simulation to show the coverage gap).
- Benchmarks and thresholds already in code that the business may want to own: CAC coverage threshold (80%), verdict bands (±15%, frequency 4), stock-cover buckets, pace alert (0.8× for 3 days). See `src/metrics/marketing.ts`, `ops.ts`, `plan.ts`, and `governance` in the warehouse.

## Known limitations and choices to revisit

- **Previous-year overlay** needs 13 months of history; the simulation has 7.
- **Creative thumbnails** are generated gradients. Real ones need the ad platforms' creative assets copied to object storage (add a `thumbnailUrl` to `Creative`).
- **Campaign verdict lens** is √(platform ROAS × last-click ROAS). If Triple Whale or a MMM is connected, consider it as the verdict lens instead; it's one function in `marketing.ts`.
- **Quick-commerce receivables** assume 45-day terms until remittance files are ingested.
- **Inventory** is a point-in-time snapshot; add daily stock snapshots if you want cover history.
- **The bundle is a single 250 KB chunk** plus a lazy chunk per page; the simulated data generator would drop out of the production bundle once real data is served.

## Where things are

| Change | File |
|---|---|
| Add a metric | compute in `src/metrics/*`, register in `src/metrics/registry.ts`, show with `<Stat metric="id">` |
| Add a connector | `src/connectors/registry.ts` (+ its tables in `src/domain/types.ts`) |
| Add a screen | `src/pages/X.tsx`, route in `src/App.tsx`, nav entry in `src/nav.ts`, id in `RouteId` (`src/state/app.tsx`) |
| Change colours / layout | tokens at the top of `src/styles.css` (light and dark) |
| Change verdict rules | `src/metrics/marketing.ts` → `computeCampaigns` (update the `verdict` definition in the registry too) |
