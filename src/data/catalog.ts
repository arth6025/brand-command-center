import type { Campaign, Courier, Facility, Product } from '../domain/types';

/** Calendar anchor: day 0 = 21 Mar 2026, today = 16 Oct 2026 (day 209). */
export const DAY0_UTC = Date.UTC(2026, 2, 21);
export const DAYS = 210;
export const TODAY = DAYS - 1;

export const PRODUCTS: Product[] = [
  { id: 'serum', sku: 'ARA-SER-50', name: 'Hair Growth Serum', line: 'Serum', size: '50 ml', mrp: 799, asp: 649, catalogueWeightG: 140, asin: 'B0C4SER50X', launchDay: -400, path: '/products/hair-growth-serum', shelfLifeMonths: 24 },
  { id: 'shampoo', sku: 'ARA-SHM-200', name: 'Zero Sulphate Shampoo', line: 'Shampoo', size: '200 ml', mrp: 549, asp: 449, catalogueWeightG: 260, asin: 'B0C4SHM20X', launchDay: -400, path: '/products/zero-sulphate-shampoo', shelfLifeMonths: 24 },
  { id: 'conditioner', sku: 'ARA-CON-200', name: 'Nourishing Conditioner', line: 'Conditioner', size: '200 ml', mrp: 549, asp: 449, catalogueWeightG: 260, asin: 'B0C4CON20X', launchDay: -400, path: '/products/nourishing-conditioner', shelfLifeMonths: 24 },
  { id: 'oil', sku: 'ARA-OIL-100', name: 'Hair Growth Oil', line: 'Oil', size: '100 ml', mrp: 499, asp: 399, catalogueWeightG: 170, asin: 'B0C4OIL10X', launchDay: -400, path: '/products/hair-growth-oil', shelfLifeMonths: 24 },
  { id: 'regimen', sku: 'ARA-REG-3', name: 'Hair Fall Regimen', line: 'Regimen bundle', size: '3-step kit', mrp: 1599, asp: 1299, catalogueWeightG: 680, asin: 'B0C4REG03X', launchDay: -300, path: '/pages/hair-fall-regimen', shelfLifeMonths: 24 },
  { id: 'curl', sku: 'ARA-CRL-150', name: 'Curl Defining Cream', line: 'Curl', size: '150 ml', mrp: 649, asp: 549, catalogueWeightG: 190, launchDay: 142, path: '/products/curl-defining-cream', shelfLifeMonths: 18 },
  { id: 'dandruff', sku: 'ARA-ADS-200', name: 'Anti-Dandruff Shampoo', line: 'Shampoo', size: '200 ml', mrp: 599, asp: 499, catalogueWeightG: 260, asin: 'B0C4ADS20X', launchDay: -200, path: '/products/anti-dandruff-shampoo', shelfLifeMonths: 24 },
  { id: 'mask', sku: 'ARA-MSK-200', name: 'Repair Hair Mask', line: 'Mask', size: '200 g', mrp: 649, asp: 549, catalogueWeightG: 240, asin: 'B0C4MSK20X', launchDay: -250, path: '/products/repair-hair-mask', shelfLifeMonths: 18 },
  { id: 'beard', sku: 'ARA-BRD-30', name: 'Beard Growth Oil', line: 'Men', size: '30 ml', mrp: 449, asp: 349, catalogueWeightG: 90, launchDay: -150, path: '/products/beard-growth-oil', shelfLifeMonths: 24 },
];

/** Website product mix for non-campaign orders. */
export const WEB_MIX: Record<string, number> = {
  serum: 0.3, shampoo: 0.18, conditioner: 0.1, oil: 0.12, regimen: 0.12, curl: 0.05, dandruff: 0.06, mask: 0.04, beard: 0.03,
};

export const UNIT_COST: Record<string, number> = {
  serum: 141, shampoo: 97, conditioner: 103, oil: 82, regimen: 354, dandruff: 109, mask: 130, beard: 62,
  // curl: deliberately missing from the cost sheet (new launch) → coverage gap
};

export interface CampaignProfile extends Campaign {
  /** Base daily spend in ₹. */
  spend: number;
  /** Last-click ROAS before stamp-coverage loss (net ex-GST revenue / spend). */
  roas: number;
  claimMult: number;
  ctr: number;
  cpm: number;
  freq: number;
  /** Fractional ROAS decay across the last 21 days (0 = steady). */
  decay: number;
  newShare: number;
  creatives: number;
}

export const CAMPAIGNS: CampaignProfile[] = [
  { id: 'm01', platform: 'meta', name: 'Prospecting · Serum · ASC', objective: 'prospecting', productId: 'serum', destination: '/products/hair-growth-serum', intentTag: null, startDay: -60, spend: 38000, roas: 1.75, claimMult: 1.7, ctr: 0.0145, cpm: 165, freq: 1.9, decay: 0, newShare: 0.86, creatives: 4 },
  { id: 'm02', platform: 'meta', name: 'Retargeting · All products', objective: 'retargeting', destination: '/collections/all', intentTag: null, startDay: -120, spend: 21000, roas: 2.2, claimMult: 1.9, ctr: 0.021, cpm: 240, freq: 4.9, decay: 0.12, newShare: 0.35, creatives: 3 },
  { id: 'm03', platform: 'meta', name: 'Prospecting · Regimen bundle', objective: 'prospecting', productId: 'regimen', destination: '/pages/hair-fall-regimen', intentTag: null, startDay: -40, spend: 17000, roas: 1.75, claimMult: 1.6, ctr: 0.0128, cpm: 170, freq: 2.1, decay: 0.34, newShare: 0.84, creatives: 3 },
  { id: 'm04', platform: 'meta', name: 'Prospecting · Hair Mask', objective: 'prospecting', productId: 'mask', destination: '/products/repair-hair-mask', intentTag: null, startDay: 60, spend: 9000, roas: 0.8, claimMult: 1.6, ctr: 0.0104, cpm: 198, freq: 2.0, decay: 0.05, newShare: 0.85, creatives: 2 },
  { id: 'm05', platform: 'meta', name: 'Advantage+ · Curl Cream', objective: 'advantage', productId: 'curl', destination: '/products/curl-defining-cream', intentTag: null, startDay: 145, spend: 12000, roas: 0.75, claimMult: 1.8, ctr: 0.0158, cpm: 160, freq: 1.8, decay: 0, newShare: 0.9, creatives: 3 },
  { id: 'm06', platform: 'meta', name: 'Prospecting · Beard Oil', objective: 'prospecting', productId: 'beard', destination: '/products/beard-growth-oil', intentTag: null, startDay: 30, spend: 6000, roas: 0.85, claimMult: 1.6, ctr: 0.0068, cpm: 168, freq: 2.2, decay: 0, newShare: 0.88, creatives: 2 },
  { id: 'm07', platform: 'meta', name: 'Prospecting · Shampoo · Video', objective: 'prospecting', productId: 'shampoo', destination: '/products/zero-sulphate-shampoo', intentTag: null, startDay: 20, spend: 14000, roas: 1.45, claimMult: 1.6, ctr: 0.0131, cpm: 158, freq: 2.4, decay: 0, newShare: 0.82, creatives: 3 },
  { id: 'g01', platform: 'google', name: 'Search · Brand', objective: 'search_brand', destination: '/', intentTag: 'brand', startDay: -300, spend: 8000, roas: 5.0, claimMult: 1.3, ctr: 0.18, cpm: 900, freq: 1.2, decay: 0, newShare: 0.45, creatives: 1 },
  { id: 'g02', platform: 'google', name: 'Search · Hair fall treatment', objective: 'search_generic', productId: 'serum', destination: '/products/hair-growth-serum', intentTag: null, startDay: -200, spend: 14000, roas: 1.3, claimMult: 1.4, ctr: 0.052, cpm: 1400, freq: 1.3, decay: 0, newShare: 0.8, creatives: 1 },
  { id: 'g03', platform: 'google', name: 'Shopping · Bestsellers', objective: 'shopping', destination: null, intentTag: null, startDay: -200, spend: 16000, roas: 0.95, claimMult: 1.5, ctr: 0.011, cpm: 500, freq: 1.5, decay: 0, newShare: 0.75, creatives: 1 },
  { id: 'g04', platform: 'google', name: 'PMax · All products', objective: 'advantage', destination: '/collections/all', intentTag: null, startDay: -100, spend: 17000, roas: 1.5, claimMult: 1.6, ctr: 0.009, cpm: 120, freq: 1.7, decay: 0, newShare: 0.7, creatives: 1 },
  { id: 'g05', platform: 'google', name: 'YouTube · Brand awareness', objective: 'awareness', destination: '/', intentTag: 'brand', startDay: -30, spend: 6000, roas: 0.3, claimMult: 2.2, ctr: 0.004, cpm: 75, freq: 3.1, decay: 0, newShare: 0.9, creatives: 2 },
  { id: 's01', platform: 'snapchat', name: 'Prospecting · Serum', objective: 'prospecting', productId: 'serum', destination: '/products/hair-growth-serum', intentTag: null, startDay: 120, spend: 3000, roas: 0.5, claimMult: 2.0, ctr: 0.006, cpm: 70, freq: 2.6, decay: 0, newShare: 0.9, creatives: 2 },
];

export const COURIERS: Courier[] = [
  { id: 'dlv', name: 'Delhivery', service: 'Surface' },
  { id: 'bd', name: 'Blue Dart', service: 'Air' },
  { id: 'xb', name: 'Xpressbees', service: 'Surface' },
  { id: 'sfx', name: 'Shadowfax', service: 'Next day' },
];

export const FACILITIES: Facility[] = [
  { id: 'bhw', name: 'Bhiwandi warehouse', kind: 'warehouse' },
  { id: 'blr', name: 'Bengaluru warehouse', kind: 'warehouse' },
  { id: 'fba', name: 'Amazon FBA', kind: 'fba' },
  { id: 'qc', name: 'Quick-commerce dark stores', kind: 'dark_store' },
];

export interface City {
  name: string;
  tier: 1 | 2 | 3;
  weight: number;
  prefix: string;
}

export const CITIES: City[] = [
  { name: 'Bengaluru', tier: 1, weight: 15, prefix: '560' },
  { name: 'Mumbai', tier: 1, weight: 13, prefix: '400' },
  { name: 'Delhi NCR', tier: 1, weight: 14, prefix: '110' },
  { name: 'Hyderabad', tier: 1, weight: 8, prefix: '500' },
  { name: 'Pune', tier: 1, weight: 6, prefix: '411' },
  { name: 'Chennai', tier: 1, weight: 6, prefix: '600' },
  { name: 'Kolkata', tier: 1, weight: 5, prefix: '700' },
  { name: 'Ahmedabad', tier: 2, weight: 4, prefix: '380' },
  { name: 'Jaipur', tier: 2, weight: 4, prefix: '302' },
  { name: 'Lucknow', tier: 2, weight: 4, prefix: '226' },
  { name: 'Indore', tier: 2, weight: 3, prefix: '452' },
  { name: 'Patna', tier: 3, weight: 3, prefix: '800' },
  { name: 'Guwahati', tier: 3, weight: 2, prefix: '781' },
  { name: 'Ranchi', tier: 3, weight: 3, prefix: '834' },
  { name: 'Kanpur', tier: 3, weight: 3, prefix: '208' },
  { name: 'Agra', tier: 3, weight: 2, prefix: '282' },
];

export const QC_CITIES = ['Bengaluru', 'Mumbai', 'Delhi NCR', 'Hyderabad', 'Pune', 'Chennai'];
