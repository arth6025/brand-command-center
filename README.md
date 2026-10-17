# Brand Command Center

An internal finance and operating command center for D2C brands. One screen
tells a founder or finance lead whether marketing is above break-even, what the
business earns after ad spend, where cash is stuck, and what someone should do
about it today.

This repository is a **working prototype**: every screen is built and every
number is computed from row-level data. The data is **simulated** until the
real connectors are built. Handing this to a developer to deploy? Start with
[docs/HANDOVER.md](docs/HANDOVER.md).

---

## 1. The problem

A D2C brand's money is spread across 15–25 systems that each tell part of the story:

| Layer | Typical sources | What it knows |
|---|---|---|
| Storefront | Shopify | orders, customers, sessions |
| Ad platforms | Meta, Google, Snapchat, TikTok, Amazon Ads, quick-commerce ads | spend, and their own (over-claimed) revenue |
| Payments | Razorpay, Cashfree | captures, fees, settlements, refunds |
| Attribution | GA4, Triple Whale, Littledata | sessions, last-click and modelled attribution |
| Marketplaces | Amazon SP-API, Flipkart, Nykaa, Myntra | sales, commissions, settlements, claims |
| Quick commerce | Blinkit, Zepto, Swiggy Instamart (mostly portal reports, no API) | sell-through, POs, dark-store stock |
| Logistics | Shiprocket and couriers | freight, RTO, COD remittance, weight disputes |
| Inventory / ERP | Unicommerce or another WMS, ERPNext, Tally | stock, batches, landed costs |

No single system can answer the questions that matter:

- **Is marketing paying for itself?** Each platform reports its own ROAS, all of them over-claim, and none of them knows our COGS, freight, RTO, fees or commissions.
- **What do we actually earn after ad spend (CM2), by channel?** Website, Amazon and quick commerce have different cost structures and revenue bases (sell-through vs sell-in).
- **Where is cash stuck?** Prepaid money waits on gateway settlements, COD money on courier remittance, marketplace money on settlement cycles, quick-commerce money on payment terms.
- **What should someone do today?** Which campaigns to scale or stop, which SKU is about to run out while ads still point at it, which courier is overcharging on weight.

Founders end up with spreadsheets stitched together weekly, numbers that disagree between tools, and
decisions made on incomplete data.

### What this product does differently

1. **One contribution ladder is the source of truth.** Net revenue → COGS → GM → freight, RTO, fees, commissions, packaging → CM1 → ad spend → CM2. Break-even MER is `1 ÷ CM1%`, taken from that same ladder, so the headline and the detail always agree.
2. **Gaps are shown, never filled.** An unset packaging cost shows as "not set", not ₹0. A SKU missing from the cost sheet lowers the cost-coverage figure instead of being guessed. A SKU with no stock feed is "unknown", not zero.
3. **Real charges where they exist, governed rates otherwise**, and the screen says what share is real.
4. **Two attribution lenses, never added together.** Platform-claimed and last-click ROAS sit side by side; campaign verdicts read the geometric mean of the two against break-even.
5. **Every number has one registered definition** (formula, sources, timezone, caveats, change log) that opens from its card.
6. **Freshness is computed** from each connector's last run, never set by hand, so nobody reads a verdict off stale data.
7. **Decisions are signed off by a person.** The system recommends with its working shown; it never moves spend.
8. **The AI assistant answers only from computed numbers**, never free SQL, never estimates.

---

## 2. The prototype

Built from the "Brand Operating Dashboard" mock-up screens (pilot brand: Arata, hair care), plus two
screens the mock-ups did not have: Revenue reconciliation and Connectors.

| Screen | Answers |
|---|---|
| Overview | Blended vs break-even MER, the contribution ladder, KPIs, revenue trend, channel ROAS in two lenses |
| Performance marketing | SCALE / HOLD / FIX / STOP / BRAND verdict per campaign with its working; ad spend vs stock by landing page |
| Recommendations | Decision-engine observations to record or park; running experiments and the evidence library |
| Creative library | Every ad that spent, browsable by picture, with QA flags ranked by the spend behind them |
| Conversion funnel | Sessions → cart → checkout → order vs benchmark; rupees leaking at each stage; funnel per product page |
| Channel funnel | GA4 funnel per channel, coverage strip, where a channel loses people, a curated report builder |
| Trading room | Monthly plan per product line (set one input, the rest solve), plan vs actual by week with pace alerts |
| Revenue reconciliation | Booked revenue → cash: gateway settlements, COD remittance by courier, Amazon payouts, quick-commerce receivables |
| Retention | Repeat rates, cohort repeat, LTV on revenue and on CM1 |
| Inventory | Days of cover by SKU, restock / clear / kill calls, batch expiry, stock reconciliation across systems |
| Fulfilment | Courier scorecard, COD vs prepaid, RTO by pincode, weight overcharges to claim back |
| Amazon command centre | Inventory → revenue → ads → profit with the leaks at each step, profit per ASIN, claims, payouts |
| Quick commerce & marketplaces | CM2 by channel with per-row freshness, product × channel matrix, dark-store availability and PO fill |
| Data health | Computed freshness per feed, the metric registry, Ask |
| Connectors | Every source: status, tables it lands, screens it unlocks, setup checklist |

Also: date ranges (Today, Yesterday, 7D, MTD, 30D, 3M, Custom) with previous-period comparison,
⌘K search across screens, campaigns, products, metrics and order numbers, light and dark themes,
phone layout, CSV export on the main tables, and shareable URLs (range and scope are in the hash).

### What is real and what is simulated

| | Status |
|---|---|
| Screens, interactions, metric engine, rules | **Real**: production code, typed, unit-tested |
| Data | **Simulated**: `src/data/generate.ts` produces ~124k orders and the other tables, shaped like real connector output and including the failure modes real feeds have (a stale portal report, a SKU missing from the cost sheet, platform over-claiming, weight overcharges, orphan payment captures) |
| Connectors / ingestion | **Not built**. The catalogue and the data contract are defined; see [docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md) |
| Ask assistant | **Real**, with a fallback. `server/ask-proxy.mjs` calls Claude when an Anthropic key is configured; without it, a built-in answerer responds from the same numbers |
| Auth, multi-brand, shared persistence | **Not built**. Decisions and plans are saved in the browser's localStorage |

---

## 3. Run it

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:5180
npm test             # metric engine tests
npm run build        # typecheck + production bundle in dist/
npm run ask-server   # optional: Claude-backed Ask on :8787 (needs ANTHROPIC_API_KEY)
```

---

## Deploy on Vercel

1. In Vercel: **Add New → Project → Import** `arth6025/brand-command-center` (install the Vercel GitHub app on the account if the repo isn't listed).
2. Settings are read from `vercel.json`: framework Vite, install `npm ci`, build `npm run build`, output `dist`. Node 20 or 22.
3. Optional, for Claude-backed Ask: add the environment variable `ANTHROPIC_API_KEY`. The functions in `api/` serve `/api/ask` and `/api/health`; without the key, Ask answers locally from the same numbers.
4. Deploy. Every push to `main` redeploys.

## 4. How it is built

```
connectors (server-side ingestion, to be built)
   │  land normalised tables
   ▼
src/domain/types.ts      Warehouse contract: orders, shipments, payments, ad_daily, sessions,
                         channel_daily, purchase_orders, batches, connector_runs …
src/data/source.ts       DataSource seam: simulated generator today, warehouse snapshot in production
src/data/generate.ts     the simulated warehouse
src/connectors/          connector catalogue (method, auth, schedule, tables, screens unlocked)
src/metrics/             pure metric engine, memoised per date range
   core.ts               indexes + contribution ladder (source of truth for revenue, margin, break-even)
   marketing.ts          channel lenses, campaign verdicts, creatives
   recommendations.ts    observations with their working
   funnel.ts ops.ts retention.ts channels.ts finance.ts plan.ts health.ts
   registry.ts           one definition per metric
   __tests__/            rules the engine must keep
src/ask/answer.ts        builds the computed-numbers payload for Ask; local answerer
src/pages/               one file per screen
src/ui/ src/charts/      shared components (no UI framework; hand-rolled SVG charts)
server/ask-core.mjs      Ask logic (keeps the Anthropic key server-side)
server/ask-proxy.mjs     local Ask server for development
api/                     Vercel functions: /api/ask, /api/health
```

Stack: React 18, TypeScript (strict), Vite 5, Vitest. No runtime dependencies beyond React,
plus `@anthropic-ai/sdk` used only by the Ask proxy.

---

## 5. Taking it to production

The short version (full plan in [docs/HANDOVER.md](docs/HANDOVER.md)):

1. **Build ingestion** for the sources in `src/connectors/registry.ts`, landing the tables in `src/domain/types.ts`.
2. **Serve the warehouse** to the app behind auth and switch `createDataSource()` to the snapshot loader (or move heavy aggregates to SQL views with the same outputs).
3. **Add SSO and roles**, and move decisions and plans from localStorage to the database.
4. **Deploy** the static app and the Ask proxy, with the Anthropic key in a secret store.
5. **Governance inputs**: packaging cost per order, a complete dated SKU cost sheet, ERPNext landed costs.
