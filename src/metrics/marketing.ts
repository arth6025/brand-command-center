/**
 * Paid marketing: channel lenses, campaign verdicts, recommendations, creatives.
 *
 * Verdict lens: platform ROAS over-claims and last-click under-credits, so the
 * verdict reads the geometric mean of the two ("truth sits between") and compares
 * it with website break-even MER from the contribution ladder.
 */
import type { AdPlatform, Campaign, Creative, TrafficSource } from '../domain/types';
import { type Core, isRecognised } from './core';
import { inr, pct, safeDiv, xm } from './format';
import { type DateRange, rangeKey } from './range';

export type Verdict = 'SCALE' | 'HOLD' | 'FIX' | 'STOP' | 'BRAND';
export type FixCause = 'creative' | 'landing' | 'audience';

export interface CampaignRow {
  campaign: Campaign;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  claimedRevenue: number;
  claimedPurchases: number;
  lcRevenue: number;
  lcOrders: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  cvr: number | null;
  frequency: number | null;
  roasClaimed: number | null;
  roasLastClick: number | null;
  roasMid: number | null;
  attribution: number | null;
  trend: number | null;
  verdict: Verdict;
  cause?: FixCause;
  reasons: string[];
  breakEven: number | null;
}

export interface ChannelLensRow {
  key: string;
  label: string;
  spend: number | null;
  platformRevenue: number | null;
  platformRoas: number | null;
  lcRevenue: number;
  lcRoas: number | null;
  platformOrders: number | null;
  lcOrders: number;
}

const PAID_SOURCES: Record<string, TrafficSource> = { meta: 'meta', google: 'google', snapchat: 'snapchat' };

function median(xs: number[]) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class Marketing {
  constructor(private core: Core) {}

  channelLenses(r: DateRange): ChannelLensRow[] {
    return this.core.cached(`lens:${rangeKey(r)}`, () => {
      const byPlat: Record<string, { spend: number; claimed: number; claimedOrders: number }> = {};
      const campaignPlat = Object.fromEntries(this.core.w.campaigns.map((c) => [c.id, c.platform]));
      for (const a of this.core.ads(r)) {
        const p = campaignPlat[a.campaignId];
        const b = (byPlat[p] ||= { spend: 0, claimed: 0, claimedOrders: 0 });
        b.spend += a.spend;
        b.claimed += a.claimedRevenue / 1.18;
        b.claimedOrders += a.claimedPurchases;
      }
      const lc: Record<string, { rev: number; orders: number }> = {};
      for (const o of this.core.orders(r)) {
        if (!isRecognised(o)) continue;
        const b = (lc[o.source] ||= { rev: 0, orders: 0 });
        b.rev += o.net;
        b.orders++;
      }
      const rows: ChannelLensRow[] = [];
      const labels: Record<string, string> = { meta: 'Meta', google: 'Google', snapchat: 'Snapchat' };
      for (const p of ['meta', 'google', 'snapchat'] as AdPlatform[]) {
        const b = byPlat[p];
        if (!b) continue;
        const l = lc[PAID_SOURCES[p]] ?? { rev: 0, orders: 0 };
        rows.push({
          key: p, label: labels[p], spend: b.spend, platformRevenue: b.claimed, platformRoas: safeDiv(b.claimed, b.spend),
          lcRevenue: l.rev, lcRoas: safeDiv(l.rev, b.spend), platformOrders: b.claimedOrders, lcOrders: l.orders,
        });
      }
      const unpaid = ['organic', 'direct', 'email', 'affiliate'].reduce((a, s) => ({ rev: a.rev + (lc[s]?.rev ?? 0), orders: a.orders + (lc[s]?.orders ?? 0) }), { rev: 0, orders: 0 });
      rows.push({ key: 'unpaid', label: 'Organic · Direct · Email · Affiliate', spend: null, platformRevenue: null, platformRoas: null, lcRevenue: unpaid.rev, lcRoas: null, platformOrders: null, lcOrders: unpaid.orders });
      return rows;
    });
  }

  campaigns(r: DateRange): CampaignRow[] {
    return this.core.cached(`campaigns:${rangeKey(r)}`, () => this.computeCampaigns(r));
  }

  private computeCampaigns(r: DateRange): CampaignRow[] {
    const be = this.core.ladder(r, 'website').breakEvenMer;
    const agg: Record<string, { spend: number; impr: number; clicks: number; reach: number; claimed: number; claimedOrders: number; lcRev: number; lcOrders: number; recentSpend: number; recentRev: number; priorSpend: number; priorRev: number }> = {};
    const recentStart = r.end - 6;
    const priorStart = r.end - 13;
    const get = (id: string) => (agg[id] ||= { spend: 0, impr: 0, clicks: 0, reach: 0, claimed: 0, claimedOrders: 0, lcRev: 0, lcOrders: 0, recentSpend: 0, recentRev: 0, priorSpend: 0, priorRev: 0 });
    for (const a of this.core.ads({ ...r, start: Math.min(r.start, priorStart) })) {
      const b = get(a.campaignId);
      if (a.day >= recentStart) b.recentSpend += a.spend;
      else if (a.day >= priorStart) b.priorSpend += a.spend;
      if (a.day < r.start) continue;
      b.spend += a.spend;
      b.impr += a.impressions;
      b.clicks += a.clicks;
      b.reach += a.reach;
      b.claimed += a.claimedRevenue / 1.18;
      b.claimedOrders += a.claimedPurchases;
    }
    for (const o of this.core.orders({ ...r, start: Math.min(r.start, priorStart) })) {
      if (!o.campaignId || !isRecognised(o)) continue;
      const b = get(o.campaignId);
      if (o.day >= recentStart) b.recentRev += o.net;
      else if (o.day >= priorStart) b.priorRev += o.net;
      if (o.day < r.start) continue;
      b.lcRev += o.net;
      b.lcOrders++;
    }

    const rows: CampaignRow[] = [];
    for (const c of this.core.w.campaigns) {
      const b = agg[c.id];
      if (!b || b.spend <= 0) continue;
      const roasClaimed = safeDiv(b.claimed, b.spend);
      const roasLastClick = safeDiv(b.lcRev, b.spend);
      const roasMid = roasClaimed !== null && roasLastClick !== null ? Math.sqrt(roasClaimed * roasLastClick) : null;
      const recent = safeDiv(b.recentRev, b.recentSpend);
      const prior = safeDiv(b.priorRev, b.priorSpend);
      rows.push({
        campaign: c, spend: b.spend, impressions: b.impr, clicks: b.clicks, reach: b.reach,
        claimedRevenue: b.claimed, claimedPurchases: b.claimedOrders, lcRevenue: b.lcRev, lcOrders: b.lcOrders,
        ctr: safeDiv(b.clicks, b.impr), cpm: safeDiv(b.spend * 1000, b.impr), cpc: safeDiv(b.spend, b.clicks),
        cvr: safeDiv(b.lcOrders, b.clicks), frequency: safeDiv(b.impr, b.reach),
        roasClaimed, roasLastClick, roasMid, attribution: safeDiv(b.lcOrders, b.claimedOrders),
        trend: recent !== null && prior !== null && prior > 0 && r.end - r.start >= 13 ? (recent - prior) / prior : null,
        verdict: 'HOLD', reasons: [], breakEven: be,
      });
    }

    // Platform medians for diagnosis (brand/awareness excluded)
    const perf = rows.filter((x) => !['search_brand', 'awareness'].includes(x.campaign.objective));
    const medians: Record<string, { ctr: number | null; cvr: number | null; cpm: number | null; cpc: number | null }> = {};
    for (const p of new Set(perf.map((x) => x.campaign.platform))) {
      const xs = perf.filter((x) => x.campaign.platform === p);
      medians[p] = {
        ctr: median(xs.map((x) => x.ctr ?? NaN)), cvr: median(xs.map((x) => x.cvr ?? NaN)),
        cpm: median(xs.map((x) => x.cpm ?? NaN)), cpc: median(xs.map((x) => x.cpc ?? NaN)),
      };
    }

    for (const row of rows) {
      const c = row.campaign;
      if (c.objective === 'search_brand' || c.objective === 'awareness') {
        row.verdict = 'BRAND';
        row.reasons.push(c.objective === 'search_brand' ? 'Brand search captures existing demand; judged on impression share and CPC, not ROAS.' : 'Awareness: judged on reach and cost per 1,000 reached, not ROAS.');
        continue;
      }
      const mid = row.roasMid;
      if (be === null || mid === null) {
        row.verdict = 'HOLD';
        row.reasons.push('Break-even MER unavailable: CM1 is not positive or no revenue in window.');
        continue;
      }
      row.reasons.push(`Mid-lens ROAS ${xm(mid)} (platform ${xm(row.roasClaimed)} · last-click ${xm(row.roasLastClick)}) vs break-even ${xm(be)}.`);
      const decaying = row.trend !== null && row.trend < -0.15;
      const saturated = (row.frequency ?? 0) > 4;
      if (mid >= be) {
        if (saturated || decaying) {
          row.verdict = 'HOLD';
          if (saturated) row.reasons.push(`Frequency ${row.frequency!.toFixed(1)} is above 4: the audience is saturating.`);
          if (decaying) row.reasons.push(`Last-click ROAS down ${pct(Math.abs(row.trend!), 0)} week on week: decaying.`);
        } else {
          row.verdict = 'SCALE';
          row.reasons.push(`Above break-even, frequency ${row.frequency?.toFixed(1)}, ROAS ${row.trend !== null ? `trend ${pct(row.trend, 0, true)}` : 'steady'}.`);
        }
        continue;
      }
      const m = medians[c.platform];
      const causes: { cause: FixCause; text: string }[] = [];
      if (m?.ctr && row.ctr !== null && row.ctr < m.ctr * 0.75) causes.push({ cause: 'creative', text: `CTR ${pct(row.ctr, 2)} vs ${pct(m.ctr, 2)} platform median: the creative is not stopping the scroll.` });
      if (m?.cvr && row.cvr !== null && row.cvr < m.cvr * 0.7) causes.push({ cause: 'landing', text: `Click-to-order ${pct(row.cvr, 2)} vs ${pct(m.cvr, 2)} median: clicks land but don't convert.` });
      const costMetric = c.platform === 'google' ? 'cpc' : 'cpm';
      const cost = row[costMetric];
      const costMed = m?.[costMetric];
      if (cost !== null && costMed && cost > costMed * 1.35) causes.push({ cause: 'audience', text: `${costMetric.toUpperCase()} ${inr(cost)} vs ${inr(costMed)} median: paying too much to reach this audience.` });
      if (causes.length === 1) {
        row.verdict = 'FIX';
        row.cause = causes[0].cause;
        row.reasons.push(causes[0].text);
      } else if (causes.length === 0 && mid >= be * 0.85) {
        row.verdict = 'HOLD';
        row.reasons.push(`Within 15% of break-even and no lever stands out: hold spend flat and re-read next week.`);
      } else {
        row.verdict = 'STOP';
        if (causes.length === 0) row.reasons.push('CTR, CPM and click-to-order all sit near the platform median: no single lever explains it.');
        else causes.forEach((x) => row.reasons.push(x.text));
        if (causes.length > 1) row.reasons.push('More than one lever is broken: cheaper to stop and rebuild than to fix in place.');
      }
    }
    return rows.sort((a, b) => b.spend - a.spend);
  }

  verdictCounts(r: DateRange) {
    const counts: Record<Verdict, number> = { SCALE: 0, HOLD: 0, FIX: 0, STOP: 0, BRAND: 0 };
    for (const c of this.campaigns(r)) counts[c.verdict]++;
    return counts;
  }

  /** Share of recognised website orders carrying a channel stamp (anything but direct). */
  stampCoverage(r: DateRange) {
    let all = 0, stamped = 0;
    for (const o of this.core.orders(r)) {
      if (!isRecognised(o)) continue;
      all++;
      if (o.source !== 'direct') stamped++;
    }
    return safeDiv(stamped, all);
  }

  creatives(r: DateRange) {
    return this.core.cached(`creatives:${rangeKey(r)}`, () => {
      const be = this.core.ladder(r, 'website').breakEvenMer ?? 2;
      const agg: Record<string, { spend: number; impr: number; clicks: number; reach: number; claimed: number; lcRev: number; lcOrders: number }> = {};
      for (const a of this.core.ads(r)) {
        const b = (agg[a.creativeId] ||= { spend: 0, impr: 0, clicks: 0, reach: 0, claimed: 0, lcRev: 0, lcOrders: 0 });
        b.spend += a.spend; b.impr += a.impressions; b.clicks += a.clicks; b.reach += a.reach; b.claimed += a.claimedRevenue / 1.18;
      }
      for (const o of this.core.orders(r)) {
        if (!o.creativeId || !isRecognised(o)) continue;
        const b = agg[o.creativeId];
        if (b) { b.lcRev += o.net; b.lcOrders++; }
      }
      const ctrs = Object.values(agg).filter((b) => b.impr > 0).map((b) => b.clicks / b.impr);
      const ctrMed = median(ctrs) ?? 0.01;
      return this.core.w.creatives.map((cr: Creative) => {
        const b = agg[cr.id] ?? { spend: 0, impr: 0, clicks: 0, reach: 0, claimed: 0, lcRev: 0, lcOrders: 0 };
        const lc = safeDiv(b.lcRev, b.spend);
        const pl = safeDiv(b.claimed, b.spend);
        const roas = lc !== null && pl !== null ? Math.sqrt(lc * pl) : null;
        const ctr = safeDiv(b.clicks, b.impr);
        let call: 'KEEP' | 'WATCH' | 'FIX' | 'STOP' = 'KEEP';
        const campaign = this.core.w.campaigns.find((c) => c.id === cr.campaignId)!;
        const brand = campaign.objective === 'search_brand' || campaign.objective === 'awareness';
        if (cr.qa.length) call = 'FIX';
        else if (!brand && roas !== null && roas < be * 0.6) call = 'STOP';
        else if (!brand && ((roas !== null && roas < be) || (ctr !== null && ctr < ctrMed * 0.7))) call = 'WATCH';
        return { creative: cr, campaign, spend: b.spend, roas, roasLastClick: lc, ctr, frequency: safeDiv(b.impr, b.reach), call };
      }).filter((x) => x.spend > 0).sort((a, b) => b.spend - a.spend);
    });
  }
}
