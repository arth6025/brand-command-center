import { beforeAll, describe, expect, it } from 'vitest';
import { generateWarehouse } from '../../data/generate';
import { Engine } from '../engine';
import { solve } from '../plan';
import { presetRange, previousRange } from '../range';
import { inr, pct } from '../format';
import { validateReport } from '../funnel';
import { bucketFor } from '../ops';

let e: Engine;
beforeAll(() => { e = new Engine(generateWarehouse()); });

describe('contribution ladder', () => {
  it('lines reconcile: net − deductions = CM1, CM1 − ads = CM2', () => {
    for (const scope of ['all', 'website'] as const) {
      const l = e.core.ladder(presetRange(e.cal, '30d'), scope);
      const cm1 = l.netRevenue - l.cogs - l.freight - l.rto - l.paymentFees - l.marketplaceFees - (l.packaging ?? 0);
      expect(l.cm1).toBeCloseTo(cm1, 4);
      expect(l.cm2).toBeCloseTo(l.cm1 - l.adSpend, 4);
      expect(l.gm).toBeCloseTo(l.netRevenue - l.cogs, 4);
    }
  });
  it('break-even MER is 1 ÷ CM1% and revenue needed = spend × break-even', () => {
    const l = e.core.ladder(presetRange(e.cal, '30d'), 'all');
    expect(l.breakEvenMer!).toBeCloseTo(l.netRevenue / l.cm1, 6);
    expect(l.revenueNeeded!).toBeCloseTo(l.adSpend * l.breakEvenMer!, 2);
    expect(l.merGap!).toBeCloseTo(l.blendedMer! - l.breakEvenMer!, 6);
  });
  it('unset packaging is a gap, never zero', () => {
    const l = e.core.ladder(presetRange(e.cal, '7d'), 'all');
    expect(l.packaging).toBeNull();
    expect(l.lines.find((x) => x.key === 'packaging')!.kind).toBe('gap');
  });
  it('reports COGS coverage below 100% because a SKU is missing from the cost sheet', () => {
    const l = e.core.ladder(presetRange(e.cal, '30d'), 'all');
    expect(l.cogsCoverage).toBeLessThan(1);
    expect(l.cogsCoverage).toBeGreaterThan(0.9);
  });
  it('all-channel revenue exceeds website revenue', () => {
    const r = presetRange(e.cal, '30d');
    expect(e.core.ladder(r, 'all').netRevenue).toBeGreaterThan(e.core.ladder(r, 'website').netRevenue);
  });
});

describe('campaign verdicts', () => {
  it('every spending campaign gets exactly one verdict with reasons', () => {
    const rows = e.marketing.campaigns(presetRange(e.cal, '30d'));
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      expect(['SCALE', 'HOLD', 'FIX', 'STOP', 'BRAND']).toContain(r.verdict);
      expect(r.reasons.length).toBeGreaterThan(0);
      if (r.verdict === 'FIX') expect(r.cause).toBeDefined();
    }
  });
  it('SCALE campaigns sit at or above break-even on the mid lens; STOP below', () => {
    for (const r of e.marketing.campaigns(presetRange(e.cal, '30d'))) {
      if (r.verdict === 'SCALE') expect(r.roasMid!).toBeGreaterThanOrEqual(r.breakEven!);
      if (r.verdict === 'STOP') expect(r.roasMid!).toBeLessThan(r.breakEven!);
    }
  });
  it('mid lens sits between platform and last-click ROAS', () => {
    for (const r of e.marketing.campaigns(presetRange(e.cal, '30d'))) {
      const lo = Math.min(r.roasClaimed!, r.roasLastClick!), hi = Math.max(r.roasClaimed!, r.roasLastClick!);
      expect(r.roasMid!).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(r.roasMid!).toBeLessThanOrEqual(hi + 1e-9);
    }
  });
  it('brand search and awareness are judged as BRAND', () => {
    const rows = e.marketing.campaigns(presetRange(e.cal, '30d'));
    for (const r of rows.filter((x) => ['search_brand', 'awareness'].includes(x.campaign.objective))) expect(r.verdict).toBe('BRAND');
  });
});

describe('trading room solver', () => {
  const base = { line: 'Serum', asp: 500, conv: 0.05, roas: 2, touched: {} };
  it('quantity drives sales, views and spend', () => {
    const s = solve({ ...base, driver: 'qty', value: 100 });
    expect(s.sales).toBe(50000); expect(s.views).toBe(2000); expect(s.spend).toBe(25000);
  });
  it('sales drives quantity and spend', () => {
    const s = solve({ ...base, driver: 'sales', value: 100000 });
    expect(s.qty).toBe(200); expect(s.spend).toBe(50000);
  });
  it('spend drives sales and quantity', () => {
    const s = solve({ ...base, driver: 'spend', value: 10000 });
    expect(s.sales).toBe(20000); expect(s.qty).toBe(40);
  });
});

describe('ranges and formatting', () => {
  it('previous range has equal length and ends the day before', () => {
    const r = presetRange(e.cal, '7d');
    const p = previousRange(r);
    expect(p.end).toBe(r.start - 1);
    expect(p.end - p.start).toBe(r.end - r.start);
  });
  it('formats lakh and crore', () => {
    expect(inr(1234)).toBe('₹1,234');
    expect(inr(254000)).toBe('₹2.54L');
    expect(inr(12500000)).toBe('₹1.25Cr');
    expect(inr(-300000)).toBe('−₹3L');
    expect(pct(0.1234)).toBe('12.3%');
  });
});

describe('ops and health', () => {
  it('cover buckets follow the thresholds', () => {
    expect(bucketFor(null)).toBe('nofeed');
    expect(bucketFor(0.5)).toBe('stockout');
    expect(bucketFor(10)).toBe('critical');
    expect(bucketFor(30)).toBe('watch');
    expect(bucketFor(50)).toBe('healthy');
    expect(bucketFor(90)).toBe('overstock');
  });
  it('SKU without a stock feed is unknown, not zero', () => {
    const s = e.ops.inventory().find((x) => x.product.id === 'dandruff')!;
    expect(s.onHand).toBeNull();
    expect(s.call).toBe('NO FEED');
  });
  it('freshness is computed: the stale portal report is flagged, GA4 lagging a day is not', () => {
    const feeds = e.health.feeds();
    expect(feeds.find((f) => f.def.id === 'instamart')!.status).toBe('stale');
    expect(feeds.find((f) => f.def.id === 'ga4')!.status).toBe('ok');
    expect(feeds.find((f) => f.def.id === 'erpnext')!.status).toBe('awaiting_approval');
  });
  it('custom report refuses dishonest joins', () => {
    expect(validateReport('entry', ['net_orders'])).toMatch(/Refused/);
    expect(validateReport('channel', ['sessions', 'net_orders'])).toBeNull();
  });
});

describe('every module computes without throwing for every preset', () => {
  it('runs', () => {
    for (const p of ['today', 'yesterday', '7d', 'mtd', '30d', '3m'] as const) {
      const r = presetRange(e.cal, p);
      e.core.ladder(r, 'all'); e.core.storeKpis(r); e.marketing.channelLenses(r); e.marketing.campaigns(r); e.marketing.creatives(r);
      e.funnel.store(r); e.funnel.products(r); e.funnel.channels(r); e.ops.fulfilment(r); e.ops.spendVsStock(r);
      e.channels.cm2(r); e.channels.matrix(r); e.channels.amazon(r); e.finance.reconciliation(r); e.recommendations(r);
    }
    e.retention.repeatRates(); e.retention.cohorts(); e.retention.ltv(0.5); e.channels.darkStores(); e.ops.stockReconciliation();
    const plan = e.plan.defaults().map(solve);
    expect(e.plan.board(plan).length).toBe(plan.length);
  });
});

describe('channel groups and the CM2 bridge', () => {
  it('channel-group ladders add up to the all-channel ladder', () => {
    const r = presetRange(e.cal, '30d');
    const parts = (['website', 'marketplace', 'qc'] as const).map((s) => e.core.ladder(r, s));
    const all = e.core.ladder(r, 'all');
    for (const k of ['netRevenue', 'cogs', 'adSpend', 'cm1', 'cm2', 'marketplaceFees'] as const) {
      expect(parts.reduce((a, l) => a + l[k], 0)).toBeCloseTo(all[k], 2);
    }
  });
  it('every scope ladder reconciles', () => {
    for (const scope of ['website', 'marketplace', 'qc'] as const) {
      const l = e.core.ladder(presetRange(e.cal, '30d'), scope);
      expect(l.cm1).toBeCloseTo(l.gm - l.freight - l.rto - l.paymentFees - l.marketplaceFees - (l.packaging ?? 0), 4);
      expect(l.cm2).toBeCloseTo(l.cm1 - l.adSpend, 4);
    }
  });
  it('bridge steps sum exactly to the CM2 change, for every scope and range', () => {
    for (const scope of ['all', 'website', 'marketplace', 'qc'] as const) {
      for (const p of ['7d', '30d', 'mtd'] as const) {
        const r = presetRange(e.cal, p);
        const b = e.core.cm2Bridge(r, previousRange(r), scope);
        expect(b.from + b.steps.reduce((a, s) => a + s.value, 0)).toBeCloseTo(b.to, 2);
      }
    }
  });
});
