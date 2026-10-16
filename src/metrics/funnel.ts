/** Store conversion funnel (Shopify + checkout app) and GA4 channel funnel. */
import type { EntryPageType, TrafficSource } from '../domain/types';
import { type Core, isRecognised } from './core';
import { safeDiv } from './format';
import { type DateRange, rangeKey } from './range';

function percentile(xs: number[], q: number) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

export const SOURCE_LABEL: Record<TrafficSource, string> = {
  meta: 'Meta', google: 'Google', snapchat: 'Snapchat', organic: 'Organic', direct: 'Direct', email: 'Email', affiliate: 'Affiliate',
};

export const ENTRY_LABEL: Record<EntryPageType, string> = {
  homepage: 'Homepage', collection: 'Collections', pdp: 'Product pages', bundle: 'Bundle page', other: 'Other pages',
};

export class Funnel {
  constructor(private core: Core) {}

  /** Benchmarks = 75th percentile of daily rates over the trailing 90 days. */
  private benchmarks() {
    return this.core.cached('funnel-bench', () => {
      const t = this.core.w.today;
      const atc: number[] = [], chk: number[] = [];
      for (const s of this.core.w.shopifySessions) {
        if (s.day < t - 90 || s.day >= t) continue;
        atc.push(s.addToCart / s.sessions);
        chk.push(s.checkout / s.addToCart);
      }
      return { atc: percentile(atc, 0.75)!, chk: percentile(chk, 0.75)! };
    });
  }

  store(r: DateRange) {
    return this.core.cached(`store-funnel:${rangeKey(r)}`, () => {
      let sessions = 0, atc = 0, chk = 0;
      for (const s of this.core.w.shopifySessions) if (s.day >= r.start && s.day <= r.end) { sessions += s.sessions; atc += s.addToCart; chk += s.checkout; }
      let orders = 0, net = 0;
      for (const o of this.core.orders(r)) { if (o.status === 'cancelled') continue; orders++; if (isRecognised(o)) net += o.net; }
      const bench = this.benchmarks();
      const aov = safeDiv(net, orders) ?? 0;
      const closeFromAtc = safeDiv(orders, atc) ?? 0;
      const atcRate = safeDiv(atc, sessions);
      const chkRate = safeDiv(chk, atc);
      const pdpLeak = atcRate !== null && atcRate < bench.atc ? sessions * (bench.atc - atcRate) * closeFromAtc * aov : 0;

      // Router economics from GA4 sessions by entry
      const routers: Record<string, { sessions: number; atc: number; purchases: number }> = {};
      for (const s of this.core.w.sessions) {
        if (s.day < r.start || s.day > r.end) continue;
        const b = (routers[s.entry] ||= { sessions: 0, atc: 0, purchases: 0 });
        b.sessions += s.sessions; b.atc += s.addToCart; b.purchases += s.purchases;
      }
      const routerRows = (Object.entries(routers) as [EntryPageType, { sessions: number; atc: number; purchases: number }][]).map(([entry, b]) => ({
        entry, label: ENTRY_LABEL[entry], sessions: b.sessions, atcRate: safeDiv(b.atc, b.sessions), revPerSession: safeDiv(b.purchases * aov, b.sessions),
      })).sort((a, b) => b.sessions - a.sessions);
      const best = Math.max(...routerRows.filter((x) => x.sessions > 0).map((x) => x.revPerSession ?? 0));
      const home = routerRows.find((x) => x.entry === 'homepage');
      const routingLeak = home && home.revPerSession !== null ? Math.max(0, (best - home.revPerSession) * home.sessions * 0.5) : 0;

      return {
        steps: [
          { key: 'sessions', label: 'Sessions', source: 'Shopify', count: sessions, rate: null as number | null, bench: null as number | null },
          { key: 'atc', label: 'Added to cart', source: 'Shopify', count: atc, rate: atcRate, bench: bench.atc },
          { key: 'checkout', label: 'Reached checkout', source: 'Checkout app', count: chk, rate: chkRate, bench: bench.chk },
          { key: 'orders', label: 'Order placed', source: 'Orders webhook', count: orders, rate: safeDiv(orders, chk), bench: null },
        ],
        aov, pdpLeak, routingLeak, routers: routerRows, bestRevPerSession: best,
        partial: r.end === this.core.w.today,
      };
    });
  }

  products(r: DateRange) {
    return this.core.cached(`pdp:${rangeKey(r)}`, () => {
      const agg: Record<string, { views: number; atc: number; chk: number; units: number; net: number }> = {};
      for (const p of this.core.w.pdpDaily) {
        if (p.day < r.start || p.day > r.end) continue;
        const b = (agg[p.productId] ||= { views: 0, atc: 0, chk: 0, units: 0, net: 0 });
        b.views += p.pdpViews; b.atc += p.addToCart; b.chk += p.checkout;
      }
      for (const o of this.core.orders(r)) {
        if (!isRecognised(o)) continue;
        for (const l of o.lines) {
          const b = (agg[l.productId] ||= { views: 0, atc: 0, chk: 0, units: 0, net: 0 });
          b.units += l.qty; b.net += l.net;
        }
      }
      const rates = Object.values(agg).filter((b) => b.views > 500).map((b) => b.atc / b.views).sort((a, b) => a - b);
      const med = rates.length ? rates[Math.floor(rates.length / 2)] : 0;
      return Object.entries(agg).map(([pid, b]) => {
        const atcRate = safeDiv(b.atc, b.views);
        let status: 'OK' | 'SELLS OFF-PDP' | 'WEAK PDP' = 'OK';
        if (atcRate !== null && atcRate < med * 0.6) status = 'WEAK PDP';
        else if (b.units > b.atc * 0.62 * 1.4) status = 'SELLS OFF-PDP';
        return { product: this.core.productById[pid], views: b.views, atc: b.atc, atcRate, atcToCheckout: safeDiv(b.chk, b.atc), units: b.units, net: b.net, status };
      }).sort((a, b) => b.net - a.net);
    });
  }

  /** GA4 is complete through yesterday; the range is clipped so today never dilutes it. */
  ga4Range(r: DateRange): DateRange {
    return { ...r, end: Math.min(r.end, this.core.w.today - 1), start: Math.min(r.start, this.core.w.today - 1) };
  }

  channels(r: DateRange) {
    const g = this.ga4Range(r);
    return this.core.cached(`chfunnel:${rangeKey(g)}`, () => {
      const agg: Record<string, { sessions: number; views: number; atc: number; chk: number; orders: number }> = {};
      let ga4Sessions = 0, ga4Purchases = 0;
      for (const s of this.core.w.sessions) {
        if (s.day < g.start || s.day > g.end) continue;
        const b = (agg[s.source] ||= { sessions: 0, views: 0, atc: 0, chk: 0, orders: 0 });
        b.sessions += s.sessions; b.views += s.pdpViews; b.atc += s.addToCart; b.chk += s.checkout; b.orders += s.purchases;
        ga4Sessions += s.sessions; ga4Purchases += s.purchases;
      }
      let shopSessions = 0;
      for (const s of this.core.w.shopifySessions) if (s.day >= g.start && s.day <= g.end) shopSessions += s.sessions;
      let shopOrders = 0, stamped = 0;
      for (const o of this.core.orders(g)) { if (o.status === 'cancelled') continue; shopOrders++; if (o.source !== 'direct') stamped++; }

      // Tracking health: yesterday's GA4/Shopify coverage vs trailing 14-day average
      const cov = (d: number) => {
        let a = 0, b = 0;
        for (const s of this.core.w.sessions) if (s.day === d) a += s.sessions;
        for (const s of this.core.w.shopifySessions) if (s.day === d) b += s.sessions;
        return safeDiv(a, b) ?? 0;
      };
      const y = this.core.w.today - 1;
      let avg = 0;
      for (let d = y - 14; d < y; d++) avg += cov(d) / 14;
      const health = safeDiv(cov(y), avg);

      const MIN_SESSIONS = 1500;
      const rows = (Object.keys(SOURCE_LABEL) as TrafficSource[]).filter((s) => agg[s]).map((s) => {
        const b = agg[s];
        return {
          source: s, label: SOURCE_LABEL[s], ...b, readable: b.sessions >= MIN_SESSIONS * Math.max(1, (g.end - g.start + 1) / 30),
          atcRate: safeDiv(b.atc, b.views), checkoutRate: safeDiv(b.chk, b.atc), purchaseCvr: safeDiv(b.orders, b.sessions),
          viewRate: safeDiv(b.views, b.sessions), closeRate: safeDiv(b.orders, b.chk),
        };
      }).sort((a, b) => b.sessions - a.sessions);
      const readable = rows.filter((x) => x.readable && x.purchaseCvr !== null);
      const worst = readable.length ? readable.reduce((a, b) => (b.purchaseCvr! < a.purchaseCvr! ? b : a)).source : null;
      const best = readable.length ? readable.reduce((a, b) => (b.purchaseCvr! > a.purchaseCvr! ? b : a)).source : null;
      return {
        range: g, rows, worst, best,
        sessionsSeen: safeDiv(ga4Sessions, shopSessions), ordersSeen: safeDiv(ga4Purchases, shopOrders), ordersStamped: safeDiv(stamped, shopOrders),
        trackingHealth: health,
      };
    });
  }

  /** Stage-by-stage gap for one channel vs all other channels (summed numerator ÷ summed denominator). */
  diagnose(r: DateRange, source: TrafficSource) {
    const ch = this.channels(r);
    const me = ch.rows.find((x) => x.source === source);
    if (!me) return [];
    const others = ch.rows.filter((x) => x.source !== source);
    const sum = (k: 'sessions' | 'views' | 'atc' | 'chk' | 'orders') => others.reduce((a, x) => a + x[k], 0);
    const stages = [
      { key: 'view', label: 'Product views per session', num: 'views', den: 'sessions' },
      { key: 'atc', label: 'Product view → add to cart', num: 'atc', den: 'views' },
      { key: 'chk', label: 'Add to cart → checkout', num: 'chk', den: 'atc' },
      { key: 'close', label: 'Checkout → order', num: 'orders', den: 'chk' },
    ] as const;
    return stages.map((s) => {
      const mine = safeDiv(me[s.num], me[s.den]);
      const bench = safeDiv(sum(s.num), sum(s.den));
      const gap = mine !== null && bench !== null ? mine - bench : null;
      // Orders if only this stage matched the benchmark, everything downstream unchanged
      const extra = mine && bench && gap !== null && gap < 0 ? me.orders * (bench / mine - 1) : 0;
      return { ...s, mine, bench, gap, extraOrders: extra };
    });
  }
}

export type ReportDim = 'channel' | 'entry' | 'week';
export type ReportMetric = 'sessions' | 'atc' | 'checkout' | 'ga4_purchases' | 'net_orders';

export const REPORT_DIMS: { id: ReportDim; label: string }[] = [
  { id: 'channel', label: 'Channel' }, { id: 'entry', label: 'Entry page' }, { id: 'week', label: 'Week' },
];
export const REPORT_METRICS: { id: ReportMetric; label: string }[] = [
  { id: 'sessions', label: 'Sessions' }, { id: 'atc', label: 'Add to cart' }, { id: 'checkout', label: 'Checkout' },
  { id: 'ga4_purchases', label: 'GA4 purchases' }, { id: 'net_orders', label: 'Net orders (Shopify)' },
];

/** Curated builder: refuses combinations that cannot be joined honestly. */
export function validateReport(dim: ReportDim, metrics: ReportMetric[]): string | null {
  if (!metrics.length) return 'Pick at least one metric.';
  if (metrics.includes('net_orders') && dim === 'entry') {
    return 'Refused: Shopify stamps the landing page of the first session, GA4 stamps every session. Joining them by entry page double-counts multi-session buyers. Use GA4 purchases for entry-page cuts.';
  }
  return null;
}

export function runReport(core: Core, r: DateRange, dim: ReportDim, metrics: ReportMetric[]) {
  const g = { ...r, end: Math.min(r.end, core.w.today - 1) };
  const keyOf = (day: number, source: TrafficSource, entry: EntryPageType) =>
    dim === 'channel' ? SOURCE_LABEL[source] : dim === 'entry' ? ENTRY_LABEL[entry] : `W${Math.floor((day - g.start) / 7) + 1}`;
  const rows: Record<string, Record<ReportMetric, number>> = {};
  const get = (k: string) => (rows[k] ||= { sessions: 0, atc: 0, checkout: 0, ga4_purchases: 0, net_orders: 0 });
  for (const s of core.w.sessions) {
    if (s.day < g.start || s.day > g.end) continue;
    const b = get(keyOf(s.day, s.source, s.entry));
    b.sessions += s.sessions; b.atc += s.addToCart; b.checkout += s.checkout; b.ga4_purchases += s.purchases;
  }
  if (metrics.includes('net_orders')) {
    for (const o of core.orders(g)) {
      if (o.status === 'cancelled') continue;
      get(keyOf(o.day, o.source, o.entry)).net_orders++;
    }
  }
  return Object.entries(rows).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.sessions - a.sessions);
}
