/**
 * Indexes over the warehouse plus the contribution ladder: the single source of
 * truth for revenue, margin and break-even. Every other module reads from here,
 * so the banner, the ladder and the campaign verdicts always agree.
 */
import type { AdDaily, ChannelDaily, Day, GatewayPayment, Order, Shipment, Warehouse } from '../domain/types';
import { safeDiv } from './format';
import { type Calendar, type DateRange, rangeKey } from './range';

export type Scope = 'all' | 'website';

export interface LadderLine {
  key: string;
  label: string;
  value: number | null;
  kind: 'total' | 'deduct' | 'gap';
  note: string;
  /** Share of the line backed by real charges (vs governed rates). */
  realShare?: number;
}

export interface Ladder {
  scope: Scope;
  netRevenue: number;
  grossSales: number;
  orders: number;
  units: number;
  cogs: number;
  cogsCoverage: number;
  gm: number;
  freight: number;
  rto: number;
  paymentFees: number;
  marketplaceFees: number;
  packaging: number | null;
  cm1: number;
  adSpend: number;
  cm2: number;
  lines: LadderLine[];
  cm1Pct: number | null;
  breakEvenMer: number | null;
  blendedMer: number | null;
  merGap: number | null;
  revenueNeeded: number | null;
}

/** Order counts toward revenue only once it is neither cancelled nor reversed. */
export function isRecognised(o: Order) {
  return o.status === 'delivered' || o.status === 'in_transit';
}

export class Core {
  readonly w: Warehouse;
  readonly cal: Calendar;
  readonly ordersByDay: Order[][];
  readonly adByDay: AdDaily[][];
  readonly chByDay: ChannelDaily[][];
  readonly chAdsByDay: Warehouse['channelAds'][];
  readonly shipByOrder = new Map<number, Shipment>();
  readonly payByOrder = new Map<number, GatewayPayment>();
  readonly productById: Record<string, Warehouse['products'][number]>;
  private costIndex: Record<string, { fromDay: Day; unitCost: number }[]> = {};
  private memo = new Map<string, unknown>();

  constructor(w: Warehouse) {
    this.w = w;
    this.cal = { day0Utc: w.day0 + 5.5 * 3600 * 1000, today: w.today };
    const n = w.today + 1;
    this.ordersByDay = Array.from({ length: n }, () => []);
    this.adByDay = Array.from({ length: n }, () => []);
    this.chByDay = Array.from({ length: n }, () => []);
    this.chAdsByDay = Array.from({ length: n }, () => []);
    for (const o of w.orders) this.ordersByDay[o.day]?.push(o);
    for (const a of w.adDaily) this.adByDay[a.day]?.push(a);
    for (const c of w.channelDaily) this.chByDay[c.day]?.push(c);
    for (const c of w.channelAds) this.chAdsByDay[c.day]?.push(c);
    for (const s of w.shipments) this.shipByOrder.set(s.orderId, s);
    for (const p of w.payments) if (p.orderId !== null) this.payByOrder.set(p.orderId, p);
    this.productById = Object.fromEntries(w.products.map((p) => [p.id, p]));
    for (const c of w.skuCosts) (this.costIndex[c.productId] ||= []).push(c);
    for (const list of Object.values(this.costIndex)) list.sort((a, b) => a.fromDay - b.fromDay);
  }

  /** Memoise a computation per key (ranges are immutable once built). */
  cached<T>(key: string, fn: () => T): T {
    if (this.memo.has(key)) return this.memo.get(key) as T;
    const v = fn();
    this.memo.set(key, v);
    return v;
  }

  /** Dated unit cost on a given day, or null when the SKU is missing from the sheet. */
  unitCost(productId: string, day: Day): number | null {
    const list = this.costIndex[productId];
    if (!list) return null;
    let cost: number | null = null;
    for (const c of list) if (c.fromDay <= day) cost = c.unitCost;
    return cost;
  }

  *orders(r: DateRange): Generator<Order> {
    for (let d = Math.max(0, r.start); d <= Math.min(this.w.today, r.end); d++) yield* this.ordersByDay[d];
  }

  *ads(r: DateRange): Generator<AdDaily> {
    for (let d = Math.max(0, r.start); d <= Math.min(this.w.today, r.end); d++) yield* this.adByDay[d];
  }

  *channelRows(r: DateRange): Generator<ChannelDaily> {
    for (let d = Math.max(0, r.start); d <= Math.min(this.w.today, r.end); d++) yield* this.chByDay[d];
  }

  *channelAds(r: DateRange): Generator<Warehouse['channelAds'][number]> {
    for (let d = Math.max(0, r.start); d <= Math.min(this.w.today, r.end); d++) yield* this.chAdsByDay[d];
  }

  websiteAdSpend(r: DateRange) {
    let s = 0;
    for (const a of this.ads(r)) s += a.spend;
    return s;
  }

  ladder(r: DateRange, scope: Scope = 'all'): Ladder {
    return this.cached(`ladder:${scope}:${rangeKey(r)}`, () => this.computeLadder(r, scope));
  }

  private computeLadder(r: DateRange, scope: Scope): Ladder {
    const g = this.w.governance;
    let net = 0, gross = 0, orders = 0, units = 0, costedUnits = 0, cogs = 0;
    let freight = 0, freightReal = 0, freightGov = 0, rto = 0, fees = 0, feesGov = 0;
    let shippedOrders = 0;
    const unbilledCutoff = this.w.today - 1; // couriers bill a day later

    for (const o of this.orders(r)) {
      if (o.status === 'cancelled') continue;
      const ship = this.shipByOrder.get(o.id);
      shippedOrders++;
      if (ship && o.day < unbilledCutoff) {
        freight += ship.freight + ship.codFee;
        freightReal += ship.freight + ship.codFee;
        rto += ship.rtoFreight;
      } else {
        const est = g.freightPerOrder + (o.payment === 'cod' ? 35 : 0);
        freight += est;
        freightGov += est;
        if (o.payment === 'cod') rto += g.rtoRate * g.freightPerOrder * 1.9;
      }
      if (!isRecognised(o)) continue;
      orders++;
      net += o.net;
      gross += o.gross;
      for (const l of o.lines) {
        units += l.qty;
        const c = this.unitCost(l.productId, o.day);
        if (c !== null) {
          cogs += c * l.qty;
          costedUnits += l.qty;
        }
      }
      if (o.payment === 'prepaid') {
        const p = this.payByOrder.get(o.id);
        if (p) fees += p.fee;
        else {
          const est = o.gross * g.paymentFeePct;
          fees += est;
          feesGov += est;
        }
      }
    }

    let mktFees = 0;
    let adSpend = this.websiteAdSpend(r);
    if (scope === 'all') {
      for (const c of this.channelRows(r)) {
        const recognised = c.netRevenue - c.returnsValue;
        net += recognised;
        gross += c.gmv;
        units += c.units;
        orders += c.units; // marketplace rows are unit-level; one unit ≈ one order line
        const cost = this.unitCost(c.productId, c.day);
        if (cost !== null) {
          cogs += cost * c.units;
          costedUnits += c.units;
        }
        mktFees += c.commission + c.logistics;
      }
      for (const a of this.channelAds(r)) adSpend += a.spend;
    }

    const coverage = units ? costedUnits / units : 1;
    const gm = net - cogs;
    const packaging = g.packagingPerOrder === null ? null : g.packagingPerOrder * shippedOrders;
    const cm1 = gm - freight - rto - fees - mktFees - (packaging ?? 0);
    const cm2 = cm1 - adSpend;
    const cm1Pct = safeDiv(cm1, net);
    const breakEvenMer = cm1Pct && cm1Pct > 0 ? 1 / cm1Pct : null;
    const blendedMer = safeDiv(net, adSpend);
    const merGap = blendedMer !== null && breakEvenMer !== null ? blendedMer - breakEvenMer : null;

    const lines: LadderLine[] = [
      { key: 'net', label: 'Net revenue', value: net, kind: 'total', note: scope === 'all' ? 'all channels, ex-GST, after cancellations, RTO and returns' : 'website orders, ex-GST, after cancellations, RTO and returns' },
      { key: 'cogs', label: '− COGS', value: cogs, kind: 'deduct', note: `dated cost per SKU on the order date · ${Math.round(coverage * 100)}% of units costed` },
      { key: 'gm', label: 'GM', value: gm, kind: 'total', note: 'after goods' },
      { key: 'freight', label: '− Freight · COD fees', value: freight, kind: 'deduct', note: 'courier invoices; governed rate for orders not yet billed', realShare: freight ? freightReal / freight : 1 },
      { key: 'rto', label: '− RTO', value: rto, kind: 'deduct', note: 'return freight on RTO parcels; governed provision on unbilled COD' },
      { key: 'fees', label: '− Payment fees', value: fees, kind: 'deduct', note: 'Razorpay fee per capture', realShare: fees ? 1 - feesGov / fees : 1 },
    ];
    if (scope === 'all') lines.push({ key: 'mkt', label: '− Marketplace commission · logistics', value: mktFees, kind: 'deduct', note: 'settlement fees from SP-API, seller APIs and portal reports' });
    lines.push(
      { key: 'packaging', label: '− Packaging', value: packaging, kind: packaging === null ? 'gap' : 'deduct', note: packaging === null ? 'not set: ₹0 means not set, not free' : 'governed rate per shipped order' },
      { key: 'cm1', label: 'CM1', value: cm1, kind: 'total', note: 'break-even MER = 1 ÷ CM1%' },
      { key: 'ads', label: '− Ad spend (all platforms)', value: adSpend, kind: 'deduct', note: scope === 'all' ? 'Meta + Google + Snapchat + marketplace + quick-commerce ads' : 'Meta + Google + Snapchat' },
      { key: 'cm2', label: 'CM2', value: cm2, kind: 'total', note: 'after marketing' },
    );

    return {
      scope, netRevenue: net, grossSales: gross, orders, units, cogs, cogsCoverage: coverage, gm, freight, rto,
      paymentFees: fees, marketplaceFees: mktFees, packaging, cm1, adSpend, cm2, lines, cm1Pct, breakEvenMer,
      blendedMer, merGap, revenueNeeded: breakEvenMer !== null ? adSpend * breakEvenMer : null,
    };
  }

  /** Website KPIs from Shopify. */
  storeKpis(r: DateRange) {
    return this.cached(`kpis:${rangeKey(r)}`, () => {
      let orders = 0, net = 0, newCustomers = 0;
      for (const o of this.orders(r)) {
        if (o.status === 'cancelled') continue;
        orders++;
        if (isRecognised(o)) net += o.net;
        if (o.isFirstOrder) newCustomers++;
      }
      let sessions = 0;
      for (const s of this.w.shopifySessions) if (s.day >= r.start && s.day <= r.end) sessions += s.sessions;
      const spend = this.websiteAdSpend(r);
      return { orders, net, newCustomers, sessions, conversion: safeDiv(orders, sessions), cac: safeDiv(spend, newCustomers), aov: safeDiv(net, orders), spend };
    });
  }

  /** Daily net revenue for the scope, for the trend chart. */
  dailyRevenue(r: DateRange, scope: Scope): { day: Day; value: number }[] {
    return this.cached(`daily:${scope}:${rangeKey(r)}`, () => {
      const out: { day: Day; value: number }[] = [];
      for (let d = r.start; d <= r.end; d++) {
        if (d < 0 || d > this.w.today) {
          out.push({ day: d, value: NaN });
          continue;
        }
        let v = 0;
        for (const o of this.ordersByDay[d]) if (isRecognised(o)) v += o.net;
        if (scope === 'all') for (const c of this.chByDay[d]) v += c.netRevenue - c.returnsValue;
        out.push({ day: d, value: v });
      }
      return out;
    });
  }
}
