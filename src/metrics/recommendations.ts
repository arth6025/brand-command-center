/**
 * Decision engine observations. Each carries its working so the team can
 * disagree. Recording a decision is a sign-off for a person to act in the ad
 * platform; nothing here moves spend.
 */
import type { Core } from './core';
import { inr, pct, xm } from './format';
import type { Marketing } from './marketing';
import type { Ops } from './ops';
import { type DateRange, rangeKey } from './range';

export type RecType = 'SPEND' | 'SETUP' | 'CREATIVE' | 'MEASUREMENT' | 'STOCK';

export interface Recommendation {
  id: string;
  type: RecType;
  atStake: number;
  title: string;
  body: string;
  suggested: string;
  working: string[];
  primaryAction: string;
}

export function buildRecommendations(core: Core, mk: Marketing, ops: Ops, r: DateRange): Recommendation[] {
  return core.cached(`recs:${rangeKey(r)}`, () => {
    const out: Recommendation[] = [];
    const rows = mk.campaigns(r);
    const days = r.end - r.start + 1;
    const scale = rows.filter((x) => x.verdict === 'SCALE').sort((a, b) => (b.roasMid ?? 0) - (a.roasMid ?? 0))[0];

    for (const row of rows) {
      const c = row.campaign;
      if (row.verdict === 'STOP') {
        out.push({
          id: `stop:${c.id}`, type: 'SPEND', atStake: row.spend,
          title: `${c.name} is below break-even with no single fixable cause`,
          body: `Mid-lens ROAS ${xm(row.roasMid)} vs break-even ${xm(row.breakEven)} over ${days} days. ${row.reasons.slice(1).join(' ')}`,
          suggested: scale ? `pause and move the budget explicitly to ${scale.campaign.name} (SCALE).` : 'pause and hold the budget.',
          working: row.reasons, primaryAction: 'Record decision',
        });
      } else if (row.verdict === 'FIX') {
        const type = row.cause === 'landing' ? 'SETUP' : row.cause === 'creative' ? 'CREATIVE' : 'SPEND';
        const title = row.cause === 'landing' ? `${c.name}: clicks land but don't convert` : row.cause === 'creative' ? `${c.name}: the creative is not stopping the scroll` : `${c.name}: paying too much for reach`;
        const suggested = row.cause === 'landing'
          ? 'fix the landing page, offer or price, not the ad. Setup fixes cost nothing to try and need no spend sign-off.'
          : row.cause === 'creative' ? 'brief two new hooks against the top creative angle; keep the audience.' : 'tighten bids or narrow the audience; re-read in 7 days.';
        out.push({ id: `fix:${c.id}`, type, atStake: row.spend, title, body: row.reasons.slice(1).join(' '), suggested, working: row.reasons, primaryAction: 'Record decision' });
      } else if (row.verdict === 'HOLD' && (row.frequency ?? 0) > 4) {
        out.push({
          id: `freq:${c.id}`, type: 'CREATIVE', atStake: row.spend * 0.3,
          title: `${c.name} is saturating at frequency ${row.frequency!.toFixed(1)}`,
          body: `Still above break-even (${xm(row.roasMid)} vs ${xm(row.breakEven)}), but CPM is ${inr(row.cpm)} and rising as the same people see the ads.`,
          suggested: 'refresh creatives or widen the retargeting window before adding budget.', working: row.reasons, primaryAction: 'Record decision',
        });
      }
    }

    // Measurement: Google Search/Shopping campaigns without a declared intent
    const google = rows.filter((x) => x.campaign.platform === 'google' && ['search_generic', 'search_brand', 'shopping', 'advantage'].includes(x.campaign.objective));
    const untagged = google.filter((x) => x.campaign.intentTag === null);
    const gSpend = google.reduce((a, x) => a + x.spend, 0);
    const uSpend = untagged.reduce((a, x) => a + x.spend, 0);
    if (untagged.length) {
      out.push({
        id: 'measure:google-intent', type: 'MEASUREMENT', atStake: uSpend,
        title: `${untagged.length} Google campaigns don't declare brand vs non-brand intent`,
        body: `${pct(uSpend / gSpend, 0)} of Search/Shopping spend is unclassified. Rename or tag them; a missing "brand" token is not evidence of non-brand.`,
        suggested: 'add [NB] or [B] to each campaign name.', working: untagged.map((x) => `${x.campaign.name}: ${inr(x.spend)}`), primaryAction: 'Tag campaigns',
      });
    }
    // Measurement: creatives flagged for missing UTMs
    for (const cr of core.w.creatives.filter((x) => x.qa.some((q) => q.kind === 'measurement'))) {
      const spend = mk.creatives(r).find((x) => x.creative.id === cr.id)?.spend ?? 0;
      if (!spend) continue;
      out.push({
        id: `utm:${cr.id}`, type: 'MEASUREMENT', atStake: spend,
        title: `${cr.name} links to a page with no UTM`,
        body: 'Orders from this ad fall to direct, so last-click ROAS for its campaign is understated and the verdict leans pessimistic.',
        suggested: 'add utm_source/utm_campaign/utm_content to the ad URL.', working: [`Spend in window: ${inr(spend)}`], primaryAction: 'Record decision',
      });
    }
    // Stock: ads pointing at pages whose stock will run out first
    for (const s of ops.spendVsStock(r)) {
      if (!s.applicable || s.cover === null || s.cover >= 10) continue;
      out.push({
        id: `stock:${s.path}`, type: 'STOCK', atStake: s.spend,
        title: `${s.label}: spend will outlive the stock`,
        body: `${s.cover < 1 ? 'Out of stock' : `${Math.round(s.cover)} days of cover`} while ${inr(s.spend)} of ads in the window point at ${s.path}.`,
        suggested: s.cover < 1 ? 'pause ads to this page until stock lands, or redirect to the regimen page.' : 'raise a PO now and cap daily budget until it lands.',
        working: [`Cover = warehouse on-hand ÷ 45-day run rate`], primaryAction: 'Record decision',
      });
    }
    return out.sort((a, b) => b.atStake - a.atStake);
  });
}
