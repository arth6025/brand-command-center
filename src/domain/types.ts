/**
 * Warehouse-shaped domain model.
 *
 * Every table here is what a connector lands after normalisation. The metric
 * engine only reads these tables, so swapping the simulated source for real
 * connector output (Shopify, Meta, Razorpay, Shiprocket, SP-API, portal reports…)
 * needs no change above this layer. Days are integer indices from `Warehouse.day0`
 * in IST; money is INR in rupees (not paise), ex-GST unless the field says gross.
 */

export type Day = number;

/** Sales channels: where an order is booked and revenue recognised. */
export type SalesChannel =
  | 'website'
  | 'amazon'
  | 'flipkart'
  | 'nykaa'
  | 'myntra'
  | 'blinkit'
  | 'zepto'
  | 'instamart';

export type ChannelModel = 'd2c' | 'marketplace' | 'sell_in';

/** Traffic sources for the website (GA4 / UTM stamps). */
export type TrafficSource =
  | 'meta'
  | 'google'
  | 'snapchat'
  | 'organic'
  | 'direct'
  | 'email'
  | 'affiliate';

export type AdPlatform =
  | 'meta'
  | 'google'
  | 'snapchat'
  | 'amazon_ads'
  | 'flipkart_ads'
  | 'blinkit_ads'
  | 'zepto_ads'
  | 'instamart_ads';

export type EntryPageType = 'homepage' | 'collection' | 'pdp' | 'bundle' | 'other';
export type PaymentMode = 'prepaid' | 'cod';
export type OrderStatus = 'delivered' | 'in_transit' | 'rto' | 'returned' | 'cancelled';

export interface Product {
  id: string;
  sku: string;
  name: string;
  /** Product line used by the Trading Room plan. */
  line: string;
  size: string;
  mrp: number;
  /** Typical selling price on the website, gross of GST. */
  asp: number;
  catalogueWeightG: number;
  asin?: string;
  launchDay: Day;
  /** Landing path the ads point to. */
  path: string;
  shelfLifeMonths: number;
}

/** Dated cost sheet row: unit landed cost valid from `fromDay`. */
export interface SkuCost {
  productId: string;
  fromDay: Day;
  unitCost: number;
}

export interface OrderLine {
  productId: string;
  qty: number;
  /** Line value after discount, ex-GST. */
  net: number;
}

export interface Order {
  id: number;
  day: Day;
  customerId: number;
  isFirstOrder: boolean;
  lines: OrderLine[];
  /** Order total after discounts, gross of GST. */
  gross: number;
  discount: number;
  /** Ex-GST value. */
  net: number;
  payment: PaymentMode;
  source: TrafficSource;
  campaignId?: string;
  creativeId?: string;
  entry: EntryPageType;
  entryPath: string;
  city: string;
  pincode: string;
  status: OrderStatus;
}

export interface Shipment {
  orderId: number;
  day: Day;
  courierId: string;
  billedWeightG: number;
  catalogueWeightG: number;
  /** Forward freight billed, ex-GST. */
  freight: number;
  codFee: number;
  /** RTO return freight if the parcel came back. */
  rtoFreight: number;
  pickupHours: number;
  /** Null while in transit. */
  deliveryDays: number | null;
  status: OrderStatus;
  codAmount: number;
  codRemitted: boolean;
}

export interface Courier {
  id: string;
  name: string;
  service: string;
}

/** Razorpay payment capture + settlement. */
export interface GatewayPayment {
  paymentId: string;
  orderId: number | null;
  day: Day;
  amount: number;
  fee: number;
  settlementDay: Day | null;
  refunded: number;
}

export interface Campaign {
  id: string;
  platform: AdPlatform;
  name: string;
  objective: 'prospecting' | 'retargeting' | 'shopping' | 'search_brand' | 'search_generic' | 'advantage' | 'awareness';
  productId?: string;
  destination: string | null;
  /** Declared intent tag in the campaign name, null when untagged. */
  intentTag: 'brand' | 'non_brand' | null;
  startDay: Day;
}

export type CreativeFormat = 'video' | 'static' | 'carousel';

export interface Creative {
  id: string;
  campaignId: string;
  name: string;
  format: CreativeFormat;
  productId?: string;
  angle: 'problem_solution' | 'ingredient' | 'price_offer' | 'testimonial' | 'routine' | 'before_after';
  hook: string;
  language: 'Hindi/English' | 'English' | 'Hindi' | 'Tamil';
  launchDay: Day;
  /** Hue seed for the generated thumbnail. */
  hue: number;
  qa: CreativeQaFlag[];
}

export interface CreativeQaFlag {
  kind: 'creative' | 'artwork' | 'measurement';
  note: string;
}

/** Ad-level daily delivery as pulled from the platform. */
export interface AdDaily {
  day: Day;
  creativeId: string;
  campaignId: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  /** Platform's own attributed purchases and revenue (over-claims). */
  claimedPurchases: number;
  claimedRevenue: number;
}

/** GA4 → BigQuery session export, aggregated per day × source × entry. */
export interface SessionDaily {
  day: Day;
  source: TrafficSource;
  entry: EntryPageType;
  sessions: number;
  pdpViews: number;
  addToCart: number;
  checkout: number;
  purchases: number;
}

/** Shopify's own session count per day (the coverage denominator). */
export interface ShopifySessionDaily {
  day: Day;
  sessions: number;
  addToCart: number;
  checkout: number;
}

/** Per-product PDP funnel from the first-party checkout events app. */
export interface PdpDaily {
  day: Day;
  productId: string;
  pdpViews: number;
  addToCart: number;
  checkout: number;
}

export interface Facility {
  id: string;
  name: string;
  kind: 'warehouse' | 'fba' | 'dark_store';
}

export interface Batch {
  productId: string;
  facilityId: string;
  batch: string;
  units: number;
  expiryDay: Day;
}

/** Stock as reported by each system, for reconciliation. */
export interface StockReport {
  source: 'warehouse' | 'shopify' | 'amazon_fba' | 'qc_dark_stores';
  productId: string;
  units: number | null;
}

/** Marketplace / QC daily rows from SP-API, seller APIs or portal reports. */
export interface ChannelDaily {
  day: Day;
  channel: Exclude<SalesChannel, 'website'>;
  productId: string;
  units: number;
  /** Customer-facing GMV, gross of GST (sell-through). */
  gmv: number;
  /** Revenue the brand recognises, ex-GST (sell-in for QC, net sales for marketplaces). */
  netRevenue: number;
  commission: number;
  logistics: number;
  returnsValue: number;
}

export interface PurchaseOrder {
  id: string;
  channel: 'blinkit' | 'zepto' | 'instamart';
  day: Day;
  city: string;
  productId: string;
  orderedUnits: number;
  filledUnits: number;
}

export interface DarkStoreAvailability {
  channel: 'blinkit' | 'zepto' | 'instamart';
  city: string;
  productId: string;
  /** Share of dark stores in the city with the SKU in stock (0–1). */
  inStock: number;
  daysOfCover: number;
}

export interface AmazonSettlement {
  id: string;
  startDay: Day;
  endDay: Day;
  payoutDay: Day;
  amount: number;
  status: 'paid' | 'scheduled' | 'forecast';
}

export interface AmazonClaim {
  id: string;
  kind: 'lost' | 'damaged' | 'short_received' | 'removal' | 'refund_mismatch';
  productId: string;
  units: number;
  value: number;
  eventDay: Day;
}

export interface AmazonAsinDaily {
  day: Day;
  productId: string;
  buyBoxPct: number;
  sessions: number;
}

export interface Experiment {
  id: string;
  question: string;
  hypothesis: string;
  variant: string;
  minSpend: number;
  spentSoFar: number;
  readDay: Day;
  killRule: string;
  status: 'running' | 'concluded';
  answer?: string;
}

export interface ConnectorRun {
  connectorId: string;
  /** Epoch ms of the last successful sync. */
  lastSyncAt: number | null;
  /** Latest business date contained in the data. */
  latestDataDay: Day | null;
  rows: number;
  status: 'ok' | 'stale' | 'awaiting_approval' | 'error' | 'not_connected' | 'partial';
  message?: string;
}

/** Governed fallback rates, used only where real charges don't exist yet. */
export interface Governance {
  gstRate: number;
  freightPerOrder: number;
  rtoRate: number;
  paymentFeePct: number;
  /** Null means not set — shown as a gap, never treated as zero. */
  packagingPerOrder: number | null;
  /** Coverage needed before per-channel CAC is shown. */
  cacCoverageThreshold: number;
}

export interface Warehouse {
  brand: { name: string; category: string };
  /** Epoch ms of day 0, 00:00 IST. */
  day0: number;
  /** Index of today (partial day). */
  today: Day;
  /** Fraction of today elapsed, used to label partial data. */
  todayElapsed: number;
  generatedAt: number;
  products: Product[];
  skuCosts: SkuCost[];
  orders: Order[];
  shipments: Shipment[];
  couriers: Courier[];
  payments: GatewayPayment[];
  campaigns: Campaign[];
  creatives: Creative[];
  adDaily: AdDaily[];
  sessions: SessionDaily[];
  shopifySessions: ShopifySessionDaily[];
  pdpDaily: PdpDaily[];
  facilities: Facility[];
  batches: Batch[];
  stockReports: StockReport[];
  channelDaily: ChannelDaily[];
  /** Ad spend for marketplace and QC platforms, per day × platform. */
  channelAds: { day: Day; platform: AdPlatform; spend: number; attributedSales: number }[];
  purchaseOrders: PurchaseOrder[];
  darkStores: DarkStoreAvailability[];
  amazonSettlements: AmazonSettlement[];
  amazonClaims: AmazonClaim[];
  amazonAsin: AmazonAsinDaily[];
  experiments: Experiment[];
  evidence: string[];
  connectorRuns: ConnectorRun[];
  governance: Governance;
}
