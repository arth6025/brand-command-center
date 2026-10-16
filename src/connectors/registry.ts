/**
 * Connector catalogue. Each entry describes how a source is pulled, what
 * warehouse tables it lands, and which screens/metrics it unlocks. Freshness is
 * never stored here: it is computed from `ConnectorRun` against `scheduleMinutes`.
 */

export type ConnectorCategory =
  | 'Storefront'
  | 'Ad platforms'
  | 'Payments'
  | 'Attribution & analytics'
  | 'Marketplaces'
  | 'Quick commerce'
  | 'Logistics'
  | 'Inventory & WMS'
  | 'ERP & accounting'
  | 'Governed inputs';

export type IngestMethod = 'api' | 'webhook' | 'warehouse_export' | 'portal_report' | 'sheet';

export interface ConnectorDef {
  id: string;
  name: string;
  category: ConnectorCategory;
  method: IngestMethod;
  auth: string;
  /** Expected cadence; a feed is stale when latest data lags by > 2× this. */
  scheduleMinutes: number;
  scheduleLabel: string;
  tables: string[];
  unlocks: string[];
  /** Pages (route ids) that read this feed. */
  pages: string[];
  notes?: string;
}

const H = 60;
const D = 24 * 60;

export const CONNECTORS: ConnectorDef[] = [
  // Storefront
  {
    id: 'shopify', name: 'Shopify orders + webhooks', category: 'Storefront', method: 'webhook',
    auth: 'Custom app · Admin API (read_orders, read_customers, read_products)',
    scheduleMinutes: H, scheduleLabel: 'hourly + live', tables: ['orders', 'order_lines', 'customers', 'shopify_sessions'],
    unlocks: ['revenue', 'orders', 'customers', 'conversion'], pages: ['overview', 'funnel', 'retention', 'reconciliation'],
  },
  {
    id: 'checkout_events', name: 'Checkout events app (web pixel)', category: 'Storefront', method: 'webhook',
    auth: 'Shopify web pixel extension', scheduleMinutes: 6 * H, scheduleLabel: '6-hourly',
    tables: ['pdp_daily', 'checkout_steps'], unlocks: ['checkout step', 'product funnel'], pages: ['funnel'],
  },
  // Ad platforms
  {
    id: 'meta', name: 'Meta Ads', category: 'Ad platforms', method: 'api',
    auth: 'System User token · ads_read (read-only)', scheduleMinutes: H, scheduleLabel: 'hourly',
    tables: ['campaigns', 'creatives', 'ad_daily'], unlocks: ['spend', 'creatives', 'claimed ROAS'],
    pages: ['campaigns', 'creatives', 'recommendations', 'overview'],
  },
  {
    id: 'google_ads', name: 'Google Ads', category: 'Ad platforms', method: 'api',
    auth: 'OAuth · developer token · read-only MCC', scheduleMinutes: H, scheduleLabel: 'hourly',
    tables: ['campaigns', 'ad_daily', 'search_terms'], unlocks: ['spend', 'search terms'], pages: ['campaigns', 'overview'],
  },
  {
    id: 'snapchat', name: 'Snapchat Ads', category: 'Ad platforms', method: 'api',
    auth: 'OAuth · Marketing API', scheduleMinutes: 3 * H, scheduleLabel: '3-hourly',
    tables: ['campaigns', 'ad_daily'], unlocks: ['spend'], pages: ['campaigns'],
  },
  {
    id: 'tiktok', name: 'TikTok Ads', category: 'Ad platforms', method: 'api',
    auth: 'OAuth · Business API', scheduleMinutes: 3 * H, scheduleLabel: '3-hourly',
    tables: ['campaigns', 'ad_daily'], unlocks: ['spend'], pages: ['campaigns'],
    notes: 'Not connected. Ads delivery is unavailable in India; enable for international storefronts.',
  },
  // Payments
  {
    id: 'razorpay', name: 'Razorpay', category: 'Payments', method: 'api',
    auth: 'API key (read) · settlement webhooks', scheduleMinutes: H, scheduleLabel: 'hourly',
    tables: ['payments', 'settlements', 'refunds'], unlocks: ['payment fees', 'settlements', 'cash in transit'],
    pages: ['reconciliation', 'overview'],
  },
  // Attribution
  {
    id: 'ga4', name: 'GA4 → BigQuery', category: 'Attribution & analytics', method: 'warehouse_export',
    auth: 'Service account · BigQuery Data Viewer', scheduleMinutes: D, scheduleLabel: 'daily',
    tables: ['sessions_daily'], unlocks: ['sessions', 'channel funnel', 'last-click ROAS'],
    pages: ['channel-funnel', 'overview', 'campaigns'], notes: 'GA4 lands one full day at a time; today is never present.',
  },
  {
    id: 'triple_whale', name: 'Triple Whale', category: 'Attribution & analytics', method: 'api',
    auth: 'API key', scheduleMinutes: 6 * H, scheduleLabel: '6-hourly',
    tables: ['attribution_models'], unlocks: ['multi-touch lens'], pages: ['campaigns'],
    notes: 'Optional third lens. Not connected; platform and last-click lenses are shown instead.',
  },
  {
    id: 'littledata', name: 'Littledata', category: 'Attribution & analytics', method: 'api',
    auth: 'Shopify app', scheduleMinutes: H, scheduleLabel: 'hourly',
    tables: ['server_side_events'], unlocks: ['server-side purchase events'], pages: ['channel-funnel'],
  },
  // Marketplaces
  {
    id: 'amazon_sp', name: 'Amazon SP-API', category: 'Marketplaces', method: 'api',
    auth: 'LWA · Seller Central developer app', scheduleMinutes: 2 * H, scheduleLabel: '2-hourly',
    tables: ['amazon_orders', 'finances', 'settlements', 'fba_inventory', 'claims'], unlocks: ['Amazon pages'],
    pages: ['amazon', 'quick-commerce', 'inventory'],
  },
  {
    id: 'amazon_ads', name: 'Amazon Ads API', category: 'Marketplaces', method: 'api',
    auth: 'LWA · Advertising API', scheduleMinutes: 2 * H, scheduleLabel: '2-hourly',
    tables: ['amazon_ad_daily'], unlocks: ['ACoS', 'Amazon CM2'], pages: ['amazon'],
  },
  {
    id: 'flipkart', name: 'Flipkart Seller API', category: 'Marketplaces', method: 'api',
    auth: 'OAuth · seller app', scheduleMinutes: 6 * H, scheduleLabel: '6-hourly',
    tables: ['flipkart_orders', 'flipkart_settlements'], unlocks: ['Flipkart CM2'], pages: ['quick-commerce'],
  },
  {
    id: 'nykaa', name: 'Nykaa · Myntra · Purplle · Tira', category: 'Marketplaces', method: 'portal_report',
    auth: 'Scheduled portal report to inbox', scheduleMinutes: D, scheduleLabel: 'daily',
    tables: ['channel_daily'], unlocks: ['marketplace CM2'], pages: ['quick-commerce'],
  },
  // Quick commerce
  {
    id: 'blinkit', name: 'Blinkit portal reports', category: 'Quick commerce', method: 'portal_report',
    auth: 'Scheduled report export', scheduleMinutes: D, scheduleLabel: 'daily',
    tables: ['channel_daily', 'purchase_orders', 'dark_store_stock'], unlocks: ['QC CM2', 'PO fill rate'], pages: ['quick-commerce'],
  },
  {
    id: 'zepto', name: 'Zepto portal reports', category: 'Quick commerce', method: 'portal_report',
    auth: 'Scheduled report export', scheduleMinutes: D, scheduleLabel: 'daily',
    tables: ['channel_daily', 'purchase_orders', 'dark_store_stock'], unlocks: ['QC CM2', 'PO fill rate'], pages: ['quick-commerce'],
  },
  {
    id: 'instamart', name: 'Swiggy Instamart portal reports', category: 'Quick commerce', method: 'portal_report',
    auth: 'Scheduled report export', scheduleMinutes: D, scheduleLabel: 'daily',
    tables: ['channel_daily', 'purchase_orders', 'dark_store_stock'], unlocks: ['QC CM2', 'PO fill rate'], pages: ['quick-commerce'],
  },
  // Logistics
  {
    id: 'shiprocket', name: 'Courier aggregator (Shiprocket)', category: 'Logistics', method: 'api',
    auth: 'API user', scheduleMinutes: H, scheduleLabel: 'hourly',
    tables: ['shipments', 'cod_remittance', 'weight_disputes'], unlocks: ['RTO', 'SLA', 'shipping audit'],
    pages: ['fulfilment', 'reconciliation', 'overview'],
  },
  // Inventory
  {
    id: 'wms', name: 'Warehouse / WMS (Unicommerce)', category: 'Inventory & WMS', method: 'api',
    auth: 'API user · read-only', scheduleMinutes: H, scheduleLabel: 'hourly',
    tables: ['stock_by_facility', 'batches'], unlocks: ['stock', 'cover', 'batch expiry'], pages: ['inventory', 'campaigns'],
  },
  // ERP
  {
    id: 'erpnext', name: 'ERPNext', category: 'ERP & accounting', method: 'api',
    auth: 'API key/secret · read-only role', scheduleMinutes: D, scheduleLabel: 'daily',
    tables: ['purchase_invoices', 'landed_costs', 'gl_entries'], unlocks: ['dated SKU costs', 'opex'], pages: ['overview'],
    notes: 'Awaiting a read-only role from finance. SKU costs come from the governed cost sheet until then.',
  },
  // Governed
  {
    id: 'sku_costs', name: 'SKU cost sheet', category: 'Governed inputs', method: 'sheet',
    auth: 'Google Sheet · versioned', scheduleMinutes: 30 * D, scheduleLabel: 'on change',
    tables: ['sku_costs'], unlocks: ['GM', 'CM1', 'CM2'], pages: ['overview', 'retention'],
  },
  {
    id: 'governance', name: 'Governance rates', category: 'Governed inputs', method: 'sheet',
    auth: 'Admin settings', scheduleMinutes: 90 * D, scheduleLabel: 'on change',
    tables: ['governance'], unlocks: ['fallback freight, RTO, fees, packaging'], pages: ['overview'],
  },
];

export const CONNECTOR_BY_ID: Record<string, ConnectorDef> = Object.fromEntries(CONNECTORS.map((c) => [c.id, c]));

export const CATEGORY_ORDER: ConnectorCategory[] = [
  'Storefront', 'Ad platforms', 'Payments', 'Attribution & analytics', 'Marketplaces',
  'Quick commerce', 'Logistics', 'Inventory & WMS', 'ERP & accounting', 'Governed inputs',
];
