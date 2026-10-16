/** Inventory cover, stock calls, courier audit and RTO. */
import type { Product } from '../domain/types';
import { type Core } from './core';
import { safeDiv } from './format';
import { type DateRange, rangeKey } from './range';

export type StockCall = 'RESTOCK' | 'PROMOTE' | 'CLEAR / BUNDLE' | 'KILL' | 'NO FEED' | 'OK';
export type CoverBucket = 'stockout' | 'critical' | 'watch' | 'healthy' | 'overstock' | 'nofeed';

export interface SkuStock {
  product: Product;
  onHand: number | null;
  drr45: number;
  drr60: number;
  drr90: number;
  cover: number | null;
  bucket: CoverBucket;
  earliestExpiryDays: number | null;
  adSpend30: number;
  call: StockCall;
  reason: string;
}

export const BUCKETS: { id: CoverBucket; label: string }[] = [
  { id: 'stockout', label: 'Stockout · <1 day' },
  { id: 'critical', label: 'Critical · 1–24 days' },
  { id: 'watch', label: 'Watch · 25–44 days' },
  { id: 'healthy', label: 'Healthy · 45–60 days' },
  { id: 'overstock', label: 'Overstock · >60 days' },
  { id: 'nofeed', label: 'No stock feed' },
];

export function bucketFor(cover: number | null): CoverBucket {
  if (cover === null) return 'nofeed';
  if (cover < 1) return 'stockout';
  if (cover < 25) return 'critical';
  if (cover < 45) return 'watch';
  if (cover <= 60) return 'healthy';
  return 'overstock';
}

export class Ops {
  constructor(private core: Core) {}

  /** Units per day sold out of the warehouse (website + non-FBA marketplaces). */
  private runRate(productId: string, days: number) {
    const t = this.core.w.today;
    let units = 0;
    for (let d = t - days; d < t; d++) {
      for (const o of this.core.ordersByDay[d] ?? []) if (o.status !== 'cancelled') for (const l of o.lines) if (l.productId === productId) units += l.qty;
      for (const c of this.core.chByDay[d] ?? []) if (c.productId === productId && (c.channel === 'flipkart' || c.channel === 'nykaa' || c.channel === 'myntra')) units += c.units;
    }
    return units / days;
  }

  inventory(): SkuStock[] {
    return this.core.cached('inventory', () => {
      const w = this.core.w;
      const t = w.today;
      const spend30: Record<string, number> = {};
      const campaignProduct = Object.fromEntries(w.campaigns.map((c) => [c.id, c.productId]));
      for (const a of this.core.ads({ preset: '30d', start: t - 29, end: t })) {
        const pid = campaignProduct[a.campaignId];
        if (pid) spend30[pid] = (spend30[pid] ?? 0) + a.spend;
      }
      return w.products.map((p) => {
        const report = w.stockReports.find((s) => s.source === 'warehouse' && s.productId === p.id);
        const onHand = report?.units ?? null;
        const drr45 = this.runRate(p.id, 45);
        const cover = onHand === null ? null : drr45 > 0 ? onHand / drr45 : Infinity;
        const batches = w.batches.filter((b) => b.productId === p.id && b.facilityId !== 'fba' && b.units > 0);
        const earliestExpiryDays = batches.length ? Math.min(...batches.map((b) => b.expiryDay)) - t : null;
        const adSpend30 = spend30[p.id] ?? 0;
        let call: StockCall = 'OK';
        let reason = 'Cover within range.';
        if (onHand === null) { call = 'NO FEED'; reason = 'SKU has no WMS mapping: unknown, not zero.'; }
        else if (cover! < 25) { call = 'RESTOCK'; reason = `${cover! < 1 ? 'Out of stock' : `${Math.round(cover!)} days of cover`}${adSpend30 > 0 ? ' with ads still pointing at it' : ''}.`; }
        else if (earliestExpiryDays !== null && earliestExpiryDays < 180 && cover! > earliestExpiryDays * 0.6) { call = 'CLEAR / BUNDLE'; reason = `Earliest batch expires in ${Math.round(earliestExpiryDays / 30.4)} months; quick commerce and marketplaces reject short-dated stock.`; }
        else if (cover! > 150 && drr45 < 5) { call = 'KILL'; reason = `${Math.round(cover!)} days of cover at ${drr45.toFixed(1)} units/day: discontinue and liquidate.`; }
        else if (cover! > 60 && adSpend30 < 20000) { call = 'PROMOTE'; reason = `${Math.round(cover!)} days of cover and little spend behind it.`; }
        return {
          product: p, onHand, drr45, drr60: this.runRate(p.id, 60), drr90: this.runRate(p.id, 90),
          cover: cover === Infinity ? 9999 : cover, bucket: bucketFor(cover === Infinity ? 9999 : cover),
          earliestExpiryDays, adSpend30, call, reason,
        };
      });
    });
  }

  stockReconciliation() {
    return this.core.cached('stockrec', () => {
      const w = this.core.w;
      const wh = Object.fromEntries(w.stockReports.filter((s) => s.source === 'warehouse').map((s) => [s.productId, s.units]));
      const sources: { id: 'warehouse' | 'shopify' | 'amazon_fba' | 'qc_dark_stores'; label: string }[] = [
        { id: 'warehouse', label: 'Warehouse system' }, { id: 'shopify', label: 'Shopify' },
        { id: 'amazon_fba', label: 'Amazon FBA' }, { id: 'qc_dark_stores', label: 'Quick-commerce dark stores' },
      ];
      return sources.map((s) => {
        const rows = w.stockReports.filter((x) => x.source === s.id && x.units !== null);
        if (s.id === 'warehouse') return { ...s, skus: rows.length, match: null as number | null, mismatches: [] as string[] };
        // FBA and dark stores hold separate stock: match = SKU present in both systems with sellable units
        const comparable = s.id === 'shopify';
        const mismatches: string[] = [];
        let ok = 0;
        for (const x of rows) {
          const base = wh[x.productId];
          const good = comparable ? base !== null && base !== undefined && Math.abs((x.units ?? 0) - base) <= Math.max(5, base * 0.02) : (x.units ?? 0) > 0 && base !== null && base !== undefined;
          if (good) ok++;
          else mismatches.push(this.core.productById[x.productId].name);
        }
        return { ...s, skus: rows.length, match: safeDiv(ok, rows.length), mismatches };
      });
    });
  }

  /** Landing pages for ads vs stock behind them. */
  spendVsStock(r: DateRange) {
    return this.core.cached(`svs:${rangeKey(r)}`, () => {
      const inv = Object.fromEntries(this.inventory().map((s) => [s.product.id, s]));
      const byDest: Record<string, { spend: number; productId?: string; path: string }> = {};
      const campaigns = Object.fromEntries(this.core.w.campaigns.map((c) => [c.id, c]));
      for (const a of this.core.ads(r)) {
        const c = campaigns[a.campaignId];
        if (!c.destination || c.destination === '/') continue;
        const b = (byDest[c.destination] ||= { spend: 0, productId: c.productId, path: c.destination });
        b.spend += a.spend;
      }
      return Object.values(byDest).map((d) => {
        const s = d.productId ? inv[d.productId] : undefined;
        const isProductPage = d.path.startsWith('/products');
        return {
          path: d.path, label: s ? s.product.name : d.path.startsWith('/pages') ? 'Regimen bundle page' : 'Collection page',
          spend: d.spend, cover: isProductPage ? s?.cover ?? null : null, buyable: isProductPage ? (s?.onHand ?? 0) > 0 : null,
          applicable: isProductPage,
        };
      }).sort((a, b) => (a.cover ?? 1e9) - (b.cover ?? 1e9));
    });
  }

  fulfilment(r: DateRange) {
    return this.core.cached(`ful:${rangeKey(r)}`, () => {
      const w = this.core.w;
      const couriers = Object.fromEntries(w.couriers.map((c) => [c.id, { ...c, ships: 0, pickupSum: 0, delivSum: 0, delivN: 0, delivs: [] as number[], rto: 0, resolved: 0, cost: 0, cod: 0, over: 0, overG: 0 }]));
      let ships = 0, delivered = 0, rto = 0, resolved = 0, freight = 0, orderValue = 0, overcharge = 0, overKg = 0, pickedIn24 = 0, pending = 0;
      const delivAll: number[] = [];
      const cod = { orders: 0, value: 0, rto: 0, resolved: 0, collected: 0, pending: 0 };
      const pre = { orders: 0, value: 0, rto: 0, resolved: 0 };
      const pin: Record<string, { city: string; shipped: number; rto: number; resolved: number; cod: number }> = {};
      for (const o of this.core.orders(r)) {
        const s = this.core.shipByOrder.get(o.id);
        if (!s) continue;
        const c = couriers[s.courierId];
        ships++; c.ships++;
        orderValue += o.gross;
        freight += s.freight + s.codFee;
        c.cost += s.freight + s.codFee;
        c.pickupSum += s.pickupHours;
        if (s.pickupHours <= 24) pickedIn24++;
        const slab = Math.ceil(s.catalogueWeightG / 500) * 500;
        if (s.billedWeightG > slab) {
          const extra = s.freight * (1 - slab / s.billedWeightG);
          overcharge += extra; c.over += extra;
          overKg += (s.billedWeightG - slab) / 1000; c.overG += s.billedWeightG - slab;
        }
        const isResolved = s.status === 'delivered' || s.status === 'rto' || s.status === 'returned';
        if (s.status === 'in_transit') pending++;
        if (isResolved) { resolved++; c.resolved++; }
        if (s.status === 'rto') { rto++; c.rto++; }
        if (s.status === 'delivered' || s.status === 'returned') delivered++;
        if (s.deliveryDays !== null && s.status !== 'rto') { c.delivSum += s.deliveryDays; c.delivN++; c.delivs.push(s.deliveryDays); delivAll.push(s.deliveryDays); }
        if (o.payment === 'cod') c.cod++;
        const bucket = o.payment === 'cod' ? cod : pre;
        bucket.orders++; bucket.value += o.gross;
        if (isResolved) bucket.resolved++;
        if (s.status === 'rto') bucket.rto++;
        if (o.payment === 'cod' && (s.status === 'delivered' || s.status === 'returned')) {
          if (s.codRemitted) cod.collected += s.codAmount; else cod.pending += s.codAmount;
        }
        const p = (pin[o.pincode] ||= { city: o.city, shipped: 0, rto: 0, resolved: 0, cod: 0 });
        p.shipped++;
        if (isResolved) p.resolved++;
        if (s.status === 'rto') p.rto++;
        if (o.payment === 'cod') p.cod++;
      }
      const p90 = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length * 0.9)]; };
      return {
        ships, delivered, pending, rtoRate: safeDiv(rto, resolved),
        codRto: safeDiv(cod.rto, cod.resolved), prepaidRto: safeDiv(pre.rto, pre.resolved),
        freight, freightPct: safeDiv(freight, orderValue), overcharge, overKg,
        pickedIn24: safeDiv(pickedIn24, ships), p90: p90(delivAll),
        couriers: Object.values(couriers).filter((c) => c.ships > 0).map((c) => ({
          id: c.id, name: c.name, service: c.service, ships: c.ships, pickup: safeDiv(c.pickupSum, c.ships), delivery: safeDiv(c.delivSum, c.delivN),
          p90: p90(c.delivs), rtoRate: safeDiv(c.rto, c.resolved), costPerOrder: safeDiv(c.cost, c.ships), codShare: safeDiv(c.cod, c.ships), overcharge: c.over,
        })).sort((a, b) => b.ships - a.ships),
        cod: { ...cod, aov: safeDiv(cod.value, cod.orders), rtoRate: safeDiv(cod.rto, cod.resolved) },
        prepaid: { ...pre, aov: safeDiv(pre.value, pre.orders), rtoRate: safeDiv(pre.rto, pre.resolved) },
        pincodes: Object.entries(pin).filter(([, p]) => p.resolved >= 25).map(([code, p]) => ({ code, city: p.city, shipped: p.shipped, rtoRate: p.rto / p.resolved, codShare: p.cod / p.shipped }))
          .sort((a, b) => b.rtoRate - a.rtoRate).slice(0, 8),
        minPincode: 25,
      };
    });
  }
}
