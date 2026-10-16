/**
 * Metric registry: one registered definition per number on screen. Every card
 * links here, and the Ask assistant cites these ids.
 */
export interface MetricDef {
  id: string;
  name: string;
  formula: string;
  sources: string[];
  timezone: string;
  caveats: string;
  changelog: { date: string; note: string }[];
}

const IST = 'IST, transaction-dated';

export const METRICS: MetricDef[] = [
  { id: 'net_revenue', name: 'Net revenue', formula: 'Σ order value after discounts, ex-GST, excluding cancelled, RTO and returned orders; marketplaces net of returns; QC at sell-in value', sources: ['shopify', 'amazon_sp', 'flipkart', 'nykaa', 'blinkit', 'zepto', 'instamart'], timezone: IST, caveats: 'Today is partial. In-transit orders count until they resolve; a share will RTO.', changelog: [{ date: '3 Oct 2026', note: 'Revenue switched to ex-GST' }] },
  { id: 'blended_mer', name: 'Blended MER', formula: '(Net revenue ex-GST, all channels) ÷ (all ad spend)', sources: ['shopify', 'marketplace and QC reports', 'meta', 'google_ads', 'amazon_ads', 'QC ads'], timezone: IST, caveats: 'Today is partial; compare against a range ending yesterday.', changelog: [{ date: '3 Oct 2026', note: 'Revenue switched to ex-GST' }] },
  { id: 'breakeven_mer', name: 'Break-even MER', formula: '1 ÷ CM1%, where CM1% = CM1 ÷ net revenue', sources: ['contribution ladder'], timezone: IST, caveats: 'Packaging is not set and therefore not deducted: true break-even is slightly higher.', changelog: [{ date: '1 Aug 2026', note: 'Dated SKU costs replaced a flat 22% COGS' }] },
  { id: 'cm1', name: 'CM1', formula: 'Net revenue − COGS − freight − RTO − payment fees − marketplace fees − packaging', sources: ['shopify', 'sku_costs', 'shiprocket', 'razorpay', 'governance'], timezone: IST, caveats: 'Real charges where they exist, governed rates otherwise. Gaps are shown, never filled.', changelog: [] },
  { id: 'cm2', name: 'CM2', formula: 'CM1 − ad spend (all platforms)', sources: ['contribution ladder', 'ad platforms'], timezone: IST, caveats: 'Excludes fixed costs, salaries and agency fees.', changelog: [] },
  { id: 'cogs', name: 'COGS', formula: 'Σ units × dated unit cost on the order date', sources: ['sku_costs'], timezone: IST, caveats: 'SKUs missing from the cost sheet are left out and reported as coverage, not assumed.', changelog: [{ date: '1 Aug 2026', note: 'Cost revision for all SKUs' }] },
  { id: 'orders', name: 'Orders', formula: 'Count of Shopify orders, excluding cancelled', sources: ['shopify'], timezone: IST, caveats: 'Includes orders that later RTO.', changelog: [] },
  { id: 'conversion', name: 'Conversion', formula: 'Shopify orders ÷ Shopify sessions', sources: ['shopify'], timezone: IST, caveats: 'Shopify sessions, not GA4.', changelog: [] },
  { id: 'new_customers', name: 'New customers', formula: 'Customers whose first-ever order falls in the range', sources: ['shopify'], timezone: IST, caveats: 'Guest checkouts matched on phone number.', changelog: [] },
  { id: 'cac', name: 'CAC (blended)', formula: 'Website ad spend ÷ new customers', sources: ['meta', 'google_ads', 'snapchat', 'shopify'], timezone: IST, caveats: 'Per-channel CAC stays blank until stamp coverage reaches the governance threshold.', changelog: [] },
  { id: 'ad_spend', name: 'Ad spend', formula: 'Σ spend across ad platforms in the range', sources: ['meta', 'google_ads', 'snapchat', 'amazon_ads', 'QC ads'], timezone: 'Account timezone, re-dated to IST', caveats: 'Platform spend can restate for up to 72 hours.', changelog: [] },
  { id: 'roas_platform', name: 'ROAS · platform', formula: 'Platform-attributed revenue (ex-GST) ÷ spend', sources: ['meta', 'google_ads'], timezone: 'Account timezone', caveats: 'Over-claims: view-through and cross-device credit overlap across platforms.', changelog: [] },
  { id: 'roas_lastclick', name: 'ROAS · last-click', formula: 'Net revenue of orders stamped with the campaign UTM ÷ spend', sources: ['shopify', 'ga4'], timezone: IST, caveats: 'Under-credits prospecting; orders without UTMs fall to direct.', changelog: [] },
  { id: 'roas_mid', name: 'ROAS · mid lens', formula: '√(platform ROAS × last-click ROAS)', sources: ['campaign metrics'], timezone: IST, caveats: 'Verdict lens only. Truth sits between the two lenses; never added together.', changelog: [] },
  { id: 'verdict', name: 'Campaign verdict', formula: 'SCALE: mid ROAS ≥ break-even, frequency ≤ 4, not decaying · HOLD: above break-even but saturating/decaying, or within 15% below with no lever · FIX: below, one named cause · STOP: below, no single lever · BRAND: judged on reach', sources: ['campaign metrics', 'breakeven_mer'], timezone: IST, caveats: 'Diagnosis compares against the platform median of non-brand campaigns.', changelog: [] },
  { id: 'stamp_coverage', name: 'Orders with channel stamp', formula: 'Recognised orders with a non-direct source ÷ all recognised orders', sources: ['shopify'], timezone: IST, caveats: 'Caps how much the last-click lens can see.', changelog: [] },
  { id: 'atc_rate', name: 'Add-to-cart rate', formula: 'Sessions with add to cart ÷ sessions', sources: ['shopify', 'checkout_events'], timezone: IST, caveats: 'Benchmark = 75th percentile of daily rates over trailing 90 days.', changelog: [] },
  { id: 'cover_days', name: 'Days of cover', formula: 'Warehouse on-hand ÷ 45-day daily run rate (website + non-FBA marketplaces)', sources: ['wms', 'shopify', 'flipkart', 'nykaa'], timezone: IST, caveats: 'FBA and dark-store stock are separate pools. SKUs with no feed are unknown, not zero.', changelog: [] },
  { id: 'rto_rate', name: 'RTO rate', formula: 'RTO shipments ÷ resolved shipments (delivered + RTO + returned)', sources: ['shiprocket'], timezone: IST, caveats: 'In-transit shipments are excluded until they resolve.', changelog: [] },
  { id: 'weight_overcharge', name: 'Weight overcharge', formula: 'Σ freight on billed weight above the catalogue weight slab', sources: ['shiprocket', 'wms'], timezone: IST, caveats: 'Recoverable through the aggregator dispute window (typically 7 days from invoice).', changelog: [] },
  { id: 'repeat_rate', name: 'Repeat rate', formula: 'New customers who ordered again within N days ÷ new customers at least N days old', sources: ['shopify'], timezone: IST, caveats: 'Customers with a first order before the warehouse window are excluded from cohorts.', changelog: [] },
  { id: 'cm2_channel', name: 'CM2 by channel', formula: 'Channel net revenue − COGS − commission & fees − logistics − channel ads', sources: ['amazon_sp', 'flipkart', 'portal reports'], timezone: IST, caveats: 'Quick commerce is sell-in (PO value), not sell-through. Row freshness varies by platform.', changelog: [] },
  { id: 'cash_conversion', name: 'Cash conversion', formula: 'Cash received (settled + remitted + paid out) ÷ revenue booked', sources: ['razorpay', 'shiprocket', 'amazon_sp'], timezone: IST, caveats: 'QC receivables assume 45-day payment terms.', changelog: [] },
];

export const METRIC_BY_ID: Record<string, MetricDef> = Object.fromEntries(METRICS.map((m) => [m.id, m]));
