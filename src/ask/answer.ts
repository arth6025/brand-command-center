/**
 * Ask: answers only from computed numbers.
 *
 * `buildContext` is the exact payload the Claude proxy receives. When the proxy
 * isn't running, `localAnswer` answers the common questions deterministically
 * from the same payload, so the assistant never sees anything but these numbers.
 */
import type { Engine } from '../metrics/engine';
import { inr, pct, xm } from '../metrics/format';
import { type DateRange, dayLabel, previousRange } from '../metrics/range';

export function buildContext(e: Engine, r: DateRange) {
  const prev = previousRange(r);
  const l = e.core.ladder(r, 'all');
  const lp = e.core.ladder(prev, 'all');
  const web = e.core.ladder(r, 'website');
  const k = e.core.storeKpis(r);
  const kp = e.core.storeKpis(prev);
  const camps = e.marketing.campaigns(r);
  const campsPrev = Object.fromEntries(e.marketing.campaigns(prev).map((c) => [c.campaign.id, c]));
  const products = e.funnel.products(r);
  const productsPrev = Object.fromEntries(e.funnel.products(prev).map((p) => [p.product.id, p]));
  const ful = e.ops.fulfilment(r);
  const recon = e.finance.reconciliation(r);
  const az = e.channels.amazon(r);
  const rep = e.retention.repeatRates();
  return {
    range: { from: dayLabel(e.cal, r.start, true), to: dayLabel(e.cal, r.end, true), todayIncludedPartial: r.end === e.cal.today },
    overview: {
      netRevenue: l.netRevenue, netRevenuePrev: lp.netRevenue, adSpend: l.adSpend, adSpendPrev: lp.adSpend,
      blendedMer: l.blendedMer, blendedMerPrev: lp.blendedMer, breakEvenMer: l.breakEvenMer, cm1: l.cm1, cm2: l.cm2, cm2Prev: lp.cm2,
      cogsCoverage: l.cogsCoverage, packagingSet: l.packaging !== null,
      website: { netRevenue: web.netRevenue, mer: web.blendedMer, breakEvenMer: web.breakEvenMer, cm2: web.cm2 },
      orders: k.orders, ordersPrev: kp.orders, conversion: k.conversion, conversionPrev: kp.conversion, newCustomers: k.newCustomers, cac: k.cac,
    },
    campaigns: camps.map((c) => ({
      id: c.campaign.id, name: c.campaign.name, platform: c.campaign.platform, verdict: c.verdict, cause: c.cause ?? null, spend: c.spend,
      spendPrev: campsPrev[c.campaign.id]?.spend ?? null, roasMid: c.roasMid, roasMidPrev: campsPrev[c.campaign.id]?.roasMid ?? null,
      roasLastClick: c.roasLastClick, frequency: c.frequency, productId: c.campaign.productId ?? null,
    })),
    products: products.map((p) => ({ id: p.product.id, name: p.product.name, net: p.net, atcRate: p.atcRate, atcRatePrev: productsPrev[p.product.id]?.atcRate ?? null, status: p.status })),
    inventory: e.ops.inventory().map((s) => ({ id: s.product.id, name: s.product.name, onHand: s.onHand, coverDays: s.cover, call: s.call, adSpend30: s.adSpend30 })),
    fulfilment: { rtoRate: ful.rtoRate, codRto: ful.codRto, prepaidRto: ful.prepaidRto, freightPct: ful.freightPct, weightOvercharge: ful.overcharge, worstPincodes: ful.pincodes.slice(0, 3) },
    cash: { booked: recon.summary.booked, cashIn: recon.summary.cashIn, receivable: recon.summary.receivable, gatewayInTransit: recon.prepaid.inTransit, codPending: recon.cod.pending, codOverdue: recon.cod.overdue, orphanCaptures: recon.prepaid.orphanCount },
    amazon: { net: az.revenue.net, ads: az.ads.spend, acos: az.ads.acos, contribution: az.profit.contribution, claimable: az.claims.claimable, lostSalesStockout: az.inventory.lostSales },
    retention: { repeat30: rep.d30.rate, repeat90: rep.d90.rate, regimenAttach: rep.regimenAttach },
    stale: e.health.feeds().filter((f) => f.status === 'stale').map((f) => f.def.name),
  };
}

type Ctx = ReturnType<typeof buildContext>;

export const SUGGESTED = [
  'Why did MER move this period?',
  'Which campaigns should we stop?',
  'Where is cash stuck?',
  'What is about to stock out?',
  'Is RTO getting worse?',
];

export function localAnswer(question: string, c: Ctx): { answer: string; sources: string[] } {
  const q = question.toLowerCase();
  const o = c.overview;
  const stale = c.stale.length ? `\nNote: ${c.stale.join(', ')} is stale; its rows are missing from the latest days.` : '';

  if (/mer|break.?even|efficien|roas/.test(q)) {
    const dir = (o.blendedMer ?? 0) >= (o.blendedMerPrev ?? 0) ? 'rose' : 'fell';
    const revChg = (o.netRevenue - o.netRevenuePrev) / (o.netRevenuePrev || 1);
    const spendChg = (o.adSpend - o.adSpendPrev) / (o.adSpendPrev || 1);
    const movers = c.campaigns.filter((x) => x.spendPrev !== null).map((x) => ({ ...x, d: x.spend - (x.spendPrev ?? 0) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const top = movers[0];
    const weak = c.products.filter((p) => p.atcRate !== null && p.atcRatePrev !== null).sort((a, b) => (a.atcRate! - a.atcRatePrev!) - (b.atcRate! - b.atcRatePrev!))[0];
    let s = `Blended MER ${dir} from ${xm(o.blendedMerPrev)} to ${xm(o.blendedMer)}: revenue ${pct(revChg, 1, true)} while ad spend moved ${pct(spendChg, 1, true)}. Break-even is ${xm(o.breakEvenMer)}, so the business is ${(o.blendedMer ?? 0) >= (o.breakEvenMer ?? 0) ? 'above' : 'below'} break-even.`;
    if (top) s += `\nLargest spend change: ${top.name} (${inr(top.spendPrev)} → ${inr(top.spend)}), mid-lens ROAS ${xm(top.roasMidPrev)} → ${xm(top.roasMid)}.`;
    if (weak && weak.atcRate! < weak.atcRatePrev!) s += `\n${weak.name} add-to-cart fell ${pct(weak.atcRatePrev, 1)} → ${pct(weak.atcRate, 1)}.`;
    return { answer: s + stale, sources: ['Overview', 'Campaigns', 'Conversion funnel'] };
  }
  if (/stop|pause|kill|scale|campaign|spend/.test(q)) {
    const stop = c.campaigns.filter((x) => x.verdict === 'STOP');
    const fix = c.campaigns.filter((x) => x.verdict === 'FIX');
    const scale = c.campaigns.filter((x) => x.verdict === 'SCALE');
    const list = (xs: typeof stop) => xs.map((x) => `${x.name} (${inr(x.spend)}, ${xm(x.roasMid)})`).join('; ') || 'none';
    return {
      answer: `Break-even MER is ${xm(o.website.breakEvenMer)} on the website.\nSTOP: ${list(stop)}.\nFIX: ${list(fix)}.\nSCALE: ${list(scale)}.\n${inr(stop.reduce((a, x) => a + x.spend, 0))} sits in STOP campaigns this period.`,
      sources: ['Campaigns', 'Review recommendations'],
    };
  }
  if (/cash|settle|receiv|remit|payout|stuck/.test(q)) {
    const cs = c.cash;
    return {
      answer: `${inr(cs.receivable)} of ${inr(cs.booked)} booked has not turned into cash yet (${pct(cs.cashIn / (cs.booked || 1), 0)} converted).\nGateway settlements in transit: ${inr(cs.gatewayInTransit)}. COD awaiting remittance: ${inr(cs.codPending)}, of which ${inr(cs.codOverdue)} is past 10 days. ${cs.orphanCaptures} captures have no Shopify order.`,
      sources: ['Revenue reconciliation'],
    };
  }
  if (/stock|inventory|cover|restock|out of/.test(q)) {
    const risky = c.inventory.filter((s) => s.call === 'RESTOCK' || s.call === 'NO FEED');
    return {
      answer: risky.map((s) => s.onHand === null ? `${s.name}: no stock feed, unknown not zero.` : `${s.name}: ${Math.round(s.coverDays ?? 0)} days of cover, ${inr(s.adSpend30)} of ads in the last 30 days.`).join('\n') || 'No SKU is below 25 days of cover.',
      sources: ['Inventory', 'Campaigns'],
    };
  }
  if (/rto|courier|cod|return|deliver/.test(q)) {
    const f = c.fulfilment;
    return {
      answer: `RTO is ${pct(f.rtoRate)} of resolved shipments: COD ${pct(f.codRto)} vs prepaid ${pct(f.prepaidRto)}. Worst pincodes: ${f.worstPincodes.map((p) => `${p.code} ${p.city} ${pct(p.rtoRate, 0)}`).join(', ')}. Weight overcharges to claim back: ${inr(f.weightOvercharge)}.`,
      sources: ['Fulfilment'],
    };
  }
  if (/amazon|acos/.test(q)) {
    const a = c.amazon;
    return { answer: `Amazon net ${inr(a.net)}, ads ${inr(a.ads)} (ACoS ${pct(a.acos)}), contribution ${inr(a.contribution)}. ${inr(a.lostSalesStockout)} est. lost to the Serum stock-out; ${inr(a.claimable)} claimable.`, sources: ['Amazon command centre'] };
  }
  if (/repeat|retention|cohort|ltv/.test(q)) {
    const r = c.retention;
    return { answer: `30-day repeat ${pct(r.repeat30)}, 90-day ${pct(r.repeat90)}. ${pct(r.regimenAttach)} of orders carry 2+ regimen steps.`, sources: ['Retention'] };
  }
  return {
    answer: `Net revenue ${inr(o.netRevenue)} (${pct((o.netRevenue - o.netRevenuePrev) / (o.netRevenuePrev || 1), 1, true)}), ad spend ${inr(o.adSpend)}, blended MER ${xm(o.blendedMer)} vs break-even ${xm(o.breakEvenMer)}, CM2 ${inr(o.cm2)}.\nI answer only from computed numbers: try asking about MER, campaigns, cash, stock, RTO, Amazon or retention.`,
    sources: ['Overview'],
  };
}

let proxyUp: Promise<boolean> | null = null;
function proxyAvailable() {
  proxyUp ??= fetch('/api/health').then((res) => res.ok, () => false);
  return proxyUp;
}

export async function ask(question: string, e: Engine, r: DateRange): Promise<{ answer: string; sources: string[]; via: 'claude' | 'local' }> {
  const context = buildContext(e, r);
  if (!(await proxyAvailable())) return { ...localAnswer(question, context), via: 'local' };
  try {
    const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, context }) });
    if (res.ok) {
      const body = (await res.json()) as { answer?: string };
      if (body.answer) return { answer: body.answer, sources: [], via: 'claude' };
    }
  } catch {
    /* proxy not running: fall through to the local answerer */
  }
  return { ...localAnswer(question, context), via: 'local' };
}
