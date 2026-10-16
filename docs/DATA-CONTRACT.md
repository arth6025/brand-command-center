# Data contract

The app consumes one object, `Warehouse` (`src/domain/types.ts`). Ingestion
must produce these tables. Conventions everywhere:

- **Money:** INR in rupees (not paise). **Ex-GST** unless the field name says `gross`.
- **Dates:** integer day index from `Warehouse.day0` (IST midnight). In SQL, store a `DATE` in IST and convert to the index when serving.
- **Unknown is null, never 0.** A null stock count or a missing cost row is a gap the UI shows.

| Table | Grain | Source | Key fields and rules |
|---|---|---|---|
| `products` | SKU | Shopify + SKU master | `id, sku, name, line, size, mrp, asp, catalogueWeightG, asin?, path, shelfLifeMonths`. `line` groups SKUs for the Trading Room. `path` is the product URL ads point at. |
| `skuCosts` | SKU × valid-from date | SKU cost sheet / ERPNext | Dated landed unit cost. COGS uses the row valid on the order date. A SKU with no row is excluded from COGS and reported as coverage. |
| `orders` | order | Shopify | `net` = after discounts, ex-GST. `gross` = after discounts, incl. GST and shipping. `status ∈ delivered, in_transit, rto, returned, cancelled` (join the courier status). `source` from UTM / referrer (`direct` when none). `campaignId`, `creativeId` from `utm_campaign` / `utm_content`. `isFirstOrder` = customer's first-ever order (match guests on phone). `entry`, `entryPath` = landing page. |
| `orders.lines` | order line | Shopify | `productId, qty, net` (line net ex-GST, discount allocated). |
| `shipments` | shipment | Shiprocket / couriers | One per non-cancelled order. `freight`, `codFee`, `rtoFreight` ex-GST as invoiced. `billedWeightG` from courier invoice, `catalogueWeightG` from SKU master + packaging. `codRemitted` from remittance files. |
| `couriers` | courier service | aggregator | `id, name, service`. |
| `payments` | capture | Razorpay | `orderId` null when no Shopify order matches (an orphan capture). `fee` incl. GST. `settlementDay` null until settled. `refunded` amount. |
| `campaigns` | campaign | Meta / Google / Snapchat | `objective` normalised to `prospecting, retargeting, shopping, search_brand, search_generic, advantage, awareness`. `intentTag` from a naming convention (`[B]` / `[NB]`), null when untagged. `destination` = landing path. |
| `creatives` | ad / creative | ad platforms + vision QA job | `format, angle, hook, language` (tagging job), `qa[]` flags from the vision model. |
| `adDaily` | creative × day | ad platforms | `spend` (re-dated to IST), `impressions, reach, clicks`, `claimedPurchases, claimedRevenue` = the platform's own attribution (gross). |
| `sessions` | day × source × entry type | GA4 → BigQuery | `sessions, pdpViews, addToCart, checkout, purchases`. Lands a day late; today is never present. |
| `shopifySessions` | day | Shopify | Session, add-to-cart and checkout counts: the coverage denominator. |
| `pdpDaily` | product × day | checkout events app (web pixel) | `pdpViews, addToCart, checkout` from that product's own page. |
| `facilities`, `batches` | facility × SKU × batch | WMS | `units`, `expiryDay`. FBA and dark stores are separate pools. |
| `stockReports` | source × SKU | WMS, Shopify, SP-API, QC portals | Stock as each system reports it, for reconciliation. `units` null when the SKU has no mapping. |
| `channelDaily` | channel × SKU × day | SP-API, Flipkart API, portal reports | `units`, `gmv` (customer price, gross), `netRevenue` (what the brand recognises, ex-GST: net sales for marketplaces, **sell-in PO value for quick commerce**), `commission`, `logistics`, `returnsValue`. |
| `channelAds` | ad platform × day | Amazon Ads, Flipkart Ads, QC ad portals | `spend`, `attributedSales`. |
| `purchaseOrders` | PO line | QC portals | `orderedUnits, filledUnits` by channel × city × SKU. |
| `darkStores` | channel × city × SKU | QC portals | `inStock` (share of stores, 0–1), `daysOfCover`. |
| `amazonSettlements` | settlement | SP-API | `startDay, endDay, payoutDay, amount, status`. |
| `amazonClaims` | reimbursement opportunity | SP-API reports | Lost, damaged, short-received, removal, refund mismatch. Claimable for 6 months from `eventDay`. |
| `amazonAsin` | ASIN × day | SP-API | `buyBoxPct, sessions`. |
| `experiments`, `evidence` | — | app tables | Experiment register and concluded learnings. |
| `connectorRuns` | connector | every ingestion job | `lastSyncAt` (epoch ms), `latestDataDay`, `rows`, `status`, `message`. Written on every run. |
| `governance` | brand | admin settings | `gstRate, freightPerOrder, rtoRate, paymentFeePct, packagingPerOrder (nullable), cacCoverageThreshold`: fallbacks used only where real charges don't exist. |

## Revenue recognition (used by every screen)

- Website: an order counts toward net revenue when its status is `delivered` or `in_transit`. Cancelled, RTO and returned orders are excluded.
- Marketplaces: `netRevenue − returnsValue`.
- Quick commerce: sell-in (PO value invoiced), labelled as such on screen.

## Validation to add in ingestion

- Order line nets sum to the order net (±₹1).
- Every non-cancelled order has a shipment within 3 days, or it's flagged.
- Every prepaid order has a capture; every capture has an order, or it's an orphan.
- Ad spend per platform per day matches the platform's account-level total (±0.5%).
- `connector_runs` is written even when a job fails (`status = error`, `message`).
