/**
 * Simulated warehouse for a hair-care regimen D2C brand.
 *
 * This is a stand-in for real connector output: it produces row-level tables
 * with the same shape and the same failure modes real feeds have (partial today,
 * GA4 lagging a day, a stale portal report, a SKU missing from the cost sheet,
 * a SKU with no stock feed, platform over-claiming, weight overcharges…).
 */
import type {
  AdDaily, AmazonAsinDaily, AmazonClaim, AmazonSettlement, Batch, ChannelDaily, ConnectorRun, Creative,
  CreativeFormat, DarkStoreAvailability, Day, EntryPageType, GatewayPayment, Order, OrderLine, PdpDaily,
  PurchaseOrder, SessionDaily, Shipment, ShopifySessionDaily, SkuCost, StockReport, TrafficSource, Warehouse,
} from '../domain/types';
import {
  CAMPAIGNS, CITIES, COURIERS, DAY0_UTC, DAYS, FACILITIES, PRODUCTS, QC_CITIES, TODAY, UNIT_COST, WEB_MIX,
  type CampaignProfile, type City,
} from './catalog';
import { clamp, mulberry32, normal, pickWeighted, poisson } from './rng';

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const DAY_MS = 86400000;
const GST = 0.18;
const TODAY_ELAPSED = 0.6; // generated at ~14:24 IST

const P = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

export function weekday(d: Day) {
  return new Date(DAY0_UTC + d * DAY_MS).getUTCDay();
}

function calendar(d: Day) {
  const dt = new Date(DAY0_UTC + d * DAY_MS);
  return { m: dt.getUTCMonth() + 1, dd: dt.getUTCDate() };
}

/** Demand multiplier: weekly rhythm, growth, sale events, partial today. */
function demand(d: Day, channel: 'web' | 'amazon' | 'qc' | 'mkt' = 'web') {
  const wk = [1.08, 0.97, 0.95, 0.96, 0.98, 1.02, 1.06][weekday(d)];
  let f = wk * (0.86 + 0.0009 * d);
  const { m, dd } = calendar(d);
  if (m === 8 && dd >= 8 && dd <= 15) f *= channel === 'web' ? 1.18 : 1.1;
  if (m === 10 && dd >= 1 && dd <= 9) f *= channel === 'amazon' ? 1.9 : channel === 'mkt' ? 1.6 : 1.12;
  if (channel === 'qc') f *= 0.8 + 0.0022 * d; // QC growing fast
  if (d === TODAY) f *= TODAY_ELAPSED;
  return f;
}

function availableProducts(d: Day) {
  return PRODUCTS.filter((p) => p.launchDay <= d);
}

const SOURCE_PROFILE: Record<TrafficSource, { cvr: number; atc: number; chk: number }> = {
  meta: { cvr: 0.0105, atc: 0.056, chk: 0.43 },
  google: { cvr: 0.024, atc: 0.082, chk: 0.46 },
  snapchat: { cvr: 0.006, atc: 0.031, chk: 0.42 },
  organic: { cvr: 0.026, atc: 0.09, chk: 0.46 },
  direct: { cvr: 0.034, atc: 0.11, chk: 0.47 },
  email: { cvr: 0.041, atc: 0.12, chk: 0.48 },
  affiliate: { cvr: 0.029, atc: 0.081, chk: 0.47 },
};

const CREATIVE_HOOKS = [
  'Hair fall in 30 days', 'Dermat-tested routine', 'Rosemary + redensyl', '₹649 starter pack', 'Real customer, 8 weeks',
  'Morning routine in 60s', 'Before / after, week 12', 'Why sulphates matter', 'Free shipping above ₹499', 'Founder explains',
];

export function generateWarehouse(seed = 20261016): Warehouse {
  const r = mulberry32(seed);
  const products = PRODUCTS;

  // ── Cost sheet: dated costs, one revision in Aug; curl never entered ─────────
  const skuCosts: SkuCost[] = [];
  for (const [pid, cost] of Object.entries(UNIT_COST)) {
    skuCosts.push({ productId: pid, fromDay: -500, unitCost: Math.round(cost * 0.94) });
    skuCosts.push({ productId: pid, fromDay: 133, unitCost: cost }); // 1 Aug revision
  }

  // ── Creatives ───────────────────────────────────────────────────────────────
  const creatives: Creative[] = [];
  const angles: Creative['angle'][] = ['problem_solution', 'ingredient', 'price_offer', 'testimonial', 'routine', 'before_after'];
  const formats: CreativeFormat[] = ['video', 'carousel', 'static'];
  let cn = 1;
  for (const c of CAMPAIGNS) {
    for (let i = 0; i < c.creatives; i++) {
      const id = `cr${String(cn).padStart(2, '0')}`;
      const fmt = c.platform === 'google' && c.objective !== 'awareness' ? 'static' : formats[(cn + i) % 3];
      creatives.push({
        id, campaignId: c.id,
        name: `Creative ${String(cn).padStart(2, '0')}`,
        format: c.objective === 'awareness' ? 'video' : fmt,
        productId: c.productId,
        angle: angles[(cn * 7 + i) % angles.length],
        hook: CREATIVE_HOOKS[(cn * 3 + i) % CREATIVE_HOOKS.length],
        language: (['Hindi/English', 'English', 'Hindi/English', 'Hindi', 'Tamil'] as const)[cn % 5],
        launchDay: Math.max(c.startDay, 0) + i * 9,
        hue: (cn * 47) % 360,
        qa: [],
      });
      cn++;
    }
  }
  // QA flags the vision model raised (ranked by spend later)
  const flag = (idx: number, kind: 'creative' | 'artwork' | 'measurement', note: string) => creatives[idx]?.qa.push({ kind, note });
  flag(0, 'creative', 'Low legibility: text over a busy background, unreadable on mobile.');
  flag(8, 'artwork', 'Product not visible in the first 2 seconds of the video.');
  flag(13, 'measurement', 'Ad links to a page with no UTM; orders cannot be attributed.');
  flag(17, 'artwork', 'Price on creative (₹599) does not match the PDP (₹549).');
  flag(5, 'creative', 'Hook lands after 4s; 3-second hold rate below account median.');

  const creativesByCampaign: Record<string, Creative[]> = {};
  for (const cr of creatives) (creativesByCampaign[cr.campaignId] ||= []).push(cr);

  // ── Website orders ───────────────────────────────────────────────────────────
  const orders: Order[] = [];
  const shipments: Shipment[] = [];
  const payments: GatewayPayment[] = [];
  const adDaily: AdDaily[] = [];
  const sessions: SessionDaily[] = [];
  const shopifySessions: ShopifySessionDaily[] = [];
  const pdpDaily: PdpDaily[] = [];
  let orderId = 100001;
  let customerSeq = 1;
  const repeatQueue: Map<Day, { customerId: number; regimen: boolean }[]> = new Map();
  const cityWeights = CITIES.map((c) => c.weight);
  const badPincodes = new Set(['800014', '834009', '208012', '226021', '781017']);

  const scheduleRepeats = (customerId: number, firstDay: Day, regimenBuyer: boolean) => {
    let p = regimenBuyer ? 0.34 : 0.24;
    let day = firstDay;
    for (let k = 0; k < 4; k++) {
      if (r() > p) break;
      day += Math.max(8, Math.round(normal(r, regimenBuyer ? 34 : 42, 12)));
      if (day > TODAY) break;
      const list = repeatQueue.get(day) ?? [];
      list.push({ customerId, regimen: regimenBuyer });
      repeatQueue.set(day, list);
      p = regimenBuyer ? 0.48 : 0.38;
    }
  };

  const pickMixProduct = (d: Day) => {
    const avail = availableProducts(d);
    return pickWeighted(r, avail.map((p) => p.id), avail.map((p) => WEB_MIX[p.id]));
  };

  const pickCity = (): City => pickWeighted(r, CITIES, cityWeights);

  // Track per-day aggregates for sessions
  type Agg = { orders: Record<TrafficSource, number>; byProductUnits: Record<string, number> };

  const makeOrder = (
    d: Day, source: TrafficSource, isNew: boolean, customerId: number, primary: string | undefined,
    campaign?: CampaignProfile, regimenBias = false,
  ): Order => {
    const lines: OrderLine[] = [];
    const first = primary ?? (regimenBias && r() < 0.35 ? 'regimen' : pickMixProduct(d));
    const add = (pid: string, qty: number) => {
      const price = P[pid].asp;
      lines.push({ productId: pid, qty, net: 0 });
      return price * qty;
    };
    let gross = add(first, r() < 0.12 ? 2 : 1);
    if (r() < 0.24) {
      const second = pickMixProduct(d);
      if (second !== first) gross += add(second, 1);
    }
    // Mask is a frequent cart add-on (sells off-PDP)
    if (first !== 'mask' && P.mask.launchDay <= d && r() < 0.035) gross += add('mask', 1);
    const discountRate = campaign?.objective === 'retargeting' ? 0.15 : r() < 0.4 ? 0.1 : 0.05;
    const discount = Math.round(gross * discountRate);
    const shipping = gross - discount < 499 ? 49 : 0;
    const grossAfter = gross - discount + shipping;
    const net = Math.round((grossAfter / (1 + GST)) * 100) / 100;
    // allocate net to lines by list value
    const listTotal = lines.reduce((s, l) => s + P[l.productId].asp * l.qty, 0);
    for (const l of lines) l.net = Math.round(((P[l.productId].asp * l.qty) / listTotal) * net * 100) / 100;

    const city = pickCity();
    const codBase = city.tier === 1 ? 0.3 : city.tier === 2 ? 0.48 : 0.6;
    const payment = r() < codBase * (isNew ? 1 : 0.7) ? 'cod' : 'prepaid';
    const pinSuffix = String(1 + Math.floor(r() * 5) * 4 + (city.tier === 3 ? 4 : 0)).padStart(3, '0');
    const pincode = city.prefix + pinSuffix;

    let entry: EntryPageType;
    let entryPath: string;
    if (campaign?.destination) {
      entryPath = campaign.destination;
      entry = entryPath === '/' ? 'homepage' : entryPath.startsWith('/pages') ? 'bundle' : entryPath.startsWith('/collections') ? 'collection' : 'pdp';
    } else if (campaign) {
      entry = 'pdp';
      entryPath = P[first].path;
    } else {
      entry = pickWeighted(r, ['homepage', 'collection', 'pdp', 'other'] as EntryPageType[], source === 'organic' ? [0.35, 0.15, 0.4, 0.1] : [0.6, 0.15, 0.2, 0.05]);
      entryPath = entry === 'homepage' ? '/' : entry === 'collection' ? '/collections/all' : entry === 'pdp' ? P[first].path : '/blogs/hair-care';
    }

    // Status
    let status: Order['status'];
    const rtoP = payment === 'cod' ? (badPincodes.has(pincode) ? 0.38 : city.tier === 1 ? 0.12 : city.tier === 2 ? 0.2 : 0.27) : 0.025;
    const x = r();
    if (x < 0.028) status = 'cancelled';
    else if (d >= TODAY - 4 && r() < 0.85 - (TODAY - d) * 0.15) status = 'in_transit';
    else if (r() < rtoP) status = 'rto';
    else if (r() < 0.014) status = 'returned';
    else status = 'delivered';

    const o: Order = {
      id: orderId++, day: d, customerId, isFirstOrder: isNew, lines, gross: grossAfter, discount, net, payment, source,
      campaignId: campaign?.id, creativeId: undefined, entry, entryPath, city: city.name, pincode, status,
    };
    if (campaign) {
      const crs = creativesByCampaign[campaign.id].filter((c) => c.launchDay <= d);
      const cr = crs.length ? crs[Math.floor(r() * crs.length)] : creativesByCampaign[campaign.id][0];
      // One creative is missing UTMs → orders lose their stamp
      if (cr.qa.some((q) => q.kind === 'measurement')) {
        o.campaignId = undefined;
        o.source = 'direct';
      } else o.creativeId = cr.id;
    }
    return o;
  };

  const shipOrder = (o: Order, city: City | undefined) => {
    if (o.status === 'cancelled') return;
    const tier = city?.tier ?? 2;
    const courier = pickWeighted(r, COURIERS, tier === 1 ? [0.45, 0.15, 0.25, 0.15] : [0.55, 0.15, 0.3, 0]);
    const catW = o.lines.reduce((s, l) => s + P[l.productId].catalogueWeightG * l.qty, 0) + 60;
    let billed = Math.ceil(catW / 500) * 500;
    if (courier.id === 'dlv' && r() < 0.18) billed += 500; // weight discrepancy
    if (courier.id === 'xb' && r() < 0.08) billed += 500;
    const slabRate = courier.id === 'bd' ? 66 : courier.id === 'sfx' ? 82 : courier.id === 'dlv' ? 44 : 41;
    const freight = (billed / 500) * slabRate + (tier === 3 ? 12 : 0);
    const codFee = o.payment === 'cod' ? Math.max(32, o.gross * 0.018) : 0;
    const baseDays = courier.id === 'sfx' ? 1.4 : courier.id === 'bd' ? 2.3 : courier.id === 'dlv' ? 3.8 : 4.1;
    const deliveryDays = o.status === 'in_transit' ? null : Math.max(1, Math.round((baseDays + (tier - 1) * 1.1 + Math.abs(normal(r, 0, 1))) * 10) / 10);
    const pickupHours = Math.max(2, Math.round(normal(r, courier.id === 'sfx' ? 9 : courier.id === 'xb' ? 26 : 17, 8)));
    const delivered = o.status === 'delivered' || o.status === 'returned';
    shipments.push({
      orderId: o.id, day: o.day, courierId: courier.id, billedWeightG: billed, catalogueWeightG: catW,
      freight: Math.round(freight), codFee: Math.round(codFee), rtoFreight: o.status === 'rto' ? Math.round(freight * 0.9) : 0,
      pickupHours, deliveryDays, status: o.status, codAmount: o.payment === 'cod' ? o.gross : 0,
      codRemitted: o.payment === 'cod' && delivered && o.day < TODAY - 9 - (courier.id === 'xb' ? 4 : 0) && !(o.day > TODAY - 60 && r() < (courier.id === 'xb' ? 0.09 : 0.015)),
    });
  };

  const cityByName = Object.fromEntries(CITIES.map((c) => [c.name, c]));

  for (let d = 0; d < DAYS; d++) {
    const agg: Agg = { orders: { meta: 0, google: 0, snapchat: 0, organic: 0, direct: 0, email: 0, affiliate: 0 }, byProductUnits: {} };
    const dayOrders: Order[] = [];
    const f = demand(d, 'web');

    // Paid campaigns
    for (const c of CAMPAIGNS) {
      if (c.startDay > d) continue;
      const lateDecay = c.decay && d > TODAY - 21 ? 1 - c.decay * ((d - (TODAY - 21)) / 21) : 1;
      const spendDay = c.spend * (d === TODAY ? TODAY_ELAPSED : 1) * (0.88 + r() * 0.24) * (0.9 + 0.0006 * d);
      const roasDay = c.roas * lateDecay * (0.85 + r() * 0.3) * (f / (d === TODAY ? TODAY_ELAPSED : 1)) / 1.0;
      const revenueTarget = spendDay * roasDay;
      const aov = c.productId ? (P[c.productId].asp * 1.15) / 1.18 : 760 / 1.18;
      const n = poisson(r, revenueTarget / aov);
      const source: TrafficSource = c.platform === 'meta' ? 'meta' : c.platform === 'google' ? 'google' : 'snapchat';
      const campaignOrders: Order[] = [];
      for (let i = 0; i < n; i++) {
        const isNew = r() < c.newShare;
        const cust = isNew ? customerSeq++ : Math.max(1, Math.floor(r() * customerSeq));
        const primary = c.productId ?? (r() < 0.6 ? pickMixProduct(d) : undefined);
        const o = makeOrder(d, source, isNew, cust, primary, c);
        campaignOrders.push(o);
        dayOrders.push(o);
      }
      // Ad delivery per creative
      const crs = creativesByCampaign[c.id].filter((x) => x.launchDay <= d);
      const live = crs.length ? crs : creativesByCampaign[c.id].slice(0, 1);
      const weights = live.map((_, i) => 1 / (i + 1));
      const wsum = weights.reduce((a, b) => a + b, 0);
      live.forEach((cr, i) => {
        const share = weights[i] / wsum;
        const spend = spendDay * share;
        const cpm = c.cpm * (0.9 + r() * 0.2) * (c.freq > 4 ? 1 + (d / DAYS) * 0.25 : 1);
        const impressions = Math.round((spend / cpm) * 1000);
        const ctrBase = cr.qa.some((q) => q.kind === 'creative') ? c.ctr * 0.7 : c.ctr;
        const clicks = Math.round(impressions * ctrBase * (0.9 + r() * 0.2));
        const lcOrders = campaignOrders.filter((o) => o.creativeId === cr.id);
        const lcRev = lcOrders.reduce((s, o) => s + o.gross, 0);
        const claimedPurchases = Math.round(Math.max(lcOrders.length, n * share) * c.claimMult * (0.9 + r() * 0.2));
        adDaily.push({
          day: d, creativeId: cr.id, campaignId: c.id, spend: Math.round(spend), impressions,
          reach: Math.round(impressions / c.freq), clicks, claimedPurchases,
          claimedRevenue: Math.round((lcRev > 0 ? lcRev / Math.max(1, lcOrders.length) : aov * 1.18) * claimedPurchases),
        });
      });
    }

    // Unpaid sources (new customers)
    const unpaid: [TrafficSource, number, number][] = [
      ['organic', 34, 0.7], ['direct', 26, 0.45], ['email', 10, 0.2], ['affiliate', 12, 0.85],
    ];
    for (const [src, base, newShare] of unpaid) {
      const n = poisson(r, base * f);
      for (let i = 0; i < n; i++) {
        const isNew = r() < newShare;
        const cust = isNew ? customerSeq++ : Math.max(1, Math.floor(r() * Math.max(1, customerSeq)));
        dayOrders.push(makeOrder(d, src, isNew, cust, undefined, undefined, !isNew));
      }
    }
    // Legacy customers (first order before the window) keep buying
    const legacy = poisson(r, 32 * f * Math.max(0.55, 1 - d / 600));
    for (let i = 0; i < legacy; i++) {
      const src = pickWeighted(r, ['direct', 'email', 'organic', 'meta'] as TrafficSource[], [0.45, 0.3, 0.15, 0.1]);
      dayOrders.push(makeOrder(d, src, false, -(1 + Math.floor(r() * 40000)), undefined, undefined, true));
    }
    // Scheduled repeats from in-window cohorts
    for (const rep of repeatQueue.get(d) ?? []) {
      if (d === TODAY && r() > TODAY_ELAPSED) continue;
      const src = pickWeighted(r, ['direct', 'email', 'organic', 'meta', 'google'] as TrafficSource[], [0.36, 0.28, 0.14, 0.14, 0.08]);
      dayOrders.push(makeOrder(d, src, false, rep.customerId, rep.regimen && r() < 0.5 ? 'regimen' : undefined, undefined, rep.regimen));
    }

    for (const o of dayOrders) {
      orders.push(o);
      if (o.isFirstOrder) scheduleRepeats(o.customerId, d, o.lines.some((l) => l.productId === 'regimen'));
      shipOrder(o, cityByName[o.city]);
      if (o.status !== 'cancelled') agg.orders[o.source]++;
      for (const l of o.lines) agg.byProductUnits[l.productId] = (agg.byProductUnits[l.productId] ?? 0) + l.qty;
      if (o.payment === 'prepaid') {
        const settled = d + (weekday(d) === 5 ? 3 : weekday(d) === 6 ? 2 : 2);
        payments.push({
          paymentId: `pay_${o.id.toString(36)}`, orderId: o.id, day: d, amount: o.gross,
          fee: Math.round(o.gross * 0.0236 * 100) / 100, settlementDay: settled <= TODAY ? settled : null,
          refunded: o.status === 'returned' || o.status === 'cancelled' ? o.gross : 0,
        });
      }
    }
    // Orphan captures: payment captured, no Shopify order (webhook drop)
    if (r() < 0.22) {
      payments.push({ paymentId: `pay_orph${d}`, orderId: null, day: d, amount: Math.round(600 + r() * 900), fee: 20, settlementDay: d + 2 <= TODAY ? d + 2 : null, refunded: 0 });
    }

    // Sessions (GA4 sees ~84% of sessions, ~86% of purchases; never today)
    let shopSessions = 0, shopAtc = 0, shopChk = 0;
    for (const src of Object.keys(agg.orders) as TrafficSource[]) {
      const prof = SOURCE_PROFILE[src];
      const o = agg.orders[src];
      const trueSessions = (o / prof.cvr) * (0.94 + r() * 0.12);
      const atc = trueSessions * prof.atc;
      const chk = atc * prof.chk;
      shopSessions += trueSessions; shopAtc += atc; shopChk += chk;
      if (d === TODAY) continue;
      const entries: [EntryPageType, number][] = src === 'meta' || src === 'snapchat'
        ? [['pdp', 0.62], ['bundle', 0.14], ['collection', 0.2], ['homepage', 0.04]]
        : src === 'google' ? [['homepage', 0.3], ['pdp', 0.45], ['collection', 0.2], ['other', 0.05]]
          : [['homepage', 0.52], ['collection', 0.16], ['pdp', 0.22], ['other', 0.1]];
      for (const [entry, share] of entries) {
        const s = trueSessions * share * 0.84;
        const routerBoost = entry === 'homepage' ? 0.8 : entry === 'collection' ? 1.05 : entry === 'bundle' ? 1.2 : entry === 'other' ? 0.6 : 1;
        sessions.push({
          day: d, source: src, entry,
          sessions: Math.round(s),
          pdpViews: Math.round(s * (entry === 'pdp' ? 1.35 : 0.72)),
          addToCart: Math.round(s * prof.atc * routerBoost),
          checkout: Math.round(s * prof.atc * routerBoost * prof.chk),
          purchases: Math.round(o * share * 0.86 * routerBoost),
        });
      }
    }
    shopifySessions.push({ day: d, sessions: Math.round(shopSessions), addToCart: Math.round(shopAtc), checkout: Math.round(shopChk) });

    // PDP funnel per product (checkout events app)
    for (const p of availableProducts(d)) {
      const units = agg.byProductUnits[p.id] ?? 0;
      const atcRate = p.id === 'curl' ? 0.031 : p.id === 'mask' ? 0.05 : p.id === 'regimen' ? 0.085 : 0.075;
      const offPdp = p.id === 'mask' ? 0.45 : 0.9; // share of units that came through its own PDP
      const atc = (units * offPdp) / 0.62;
      const views = atc / atcRate;
      pdpDaily.push({ day: d, productId: p.id, pdpViews: Math.round(views), addToCart: Math.round(atc), checkout: Math.round(atc * 0.68) });
    }
  }

  // ── Marketplaces & quick commerce ───────────────────────────────────────────
  const channelDaily: ChannelDaily[] = [];
  const channelAds: Warehouse['channelAds'] = [];
  const CH = {
    amazon: { units: 210, priceF: 0.9, comm: 0.155, logistics: 58, ret: 0.04, mix: { serum: 0.32, shampoo: 0.2, conditioner: 0.1, oil: 0.16, regimen: 0.08, dandruff: 0.09, mask: 0.05 } },
    flipkart: { units: 55, priceF: 0.88, comm: 0.19, logistics: 62, ret: 0.06, mix: { serum: 0.35, shampoo: 0.25, oil: 0.25, dandruff: 0.15 } },
    nykaa: { units: 62, priceF: 0.92, comm: 0.3, logistics: 18, ret: 0.03, mix: { serum: 0.3, shampoo: 0.2, conditioner: 0.15, regimen: 0.15, mask: 0.1, curl: 0.1 } },
    myntra: { units: 18, priceF: 0.9, comm: 0.28, logistics: 30, ret: 0.08, mix: { serum: 0.4, shampoo: 0.3, oil: 0.3 } },
    blinkit: { units: 150, priceF: 0.95, comm: 0.03, logistics: 0, ret: 0.01, mix: { serum: 0.34, shampoo: 0.26, oil: 0.2, conditioner: 0.1, dandruff: 0.1 } },
    zepto: { units: 105, priceF: 0.95, comm: 0.03, logistics: 0, ret: 0.01, mix: { serum: 0.36, shampoo: 0.28, oil: 0.22, dandruff: 0.14 } },
    instamart: { units: 80, priceF: 0.95, comm: 0.03, logistics: 0, ret: 0.01, mix: { serum: 0.38, shampoo: 0.3, oil: 0.32 } },
  } as const;
  const QC_TRANSFER = 0.58; // brand sells to QC at ~58% of MRP (sell-in)
  for (let d = 0; d < DAYS; d++) {
    for (const [ch, cfg] of Object.entries(CH) as [keyof typeof CH, (typeof CH)[keyof typeof CH]][]) {
      const isQc = ch === 'blinkit' || ch === 'zepto' || ch === 'instamart';
      // Portal reports land daily for yesterday; Instamart has been stale for 3 days
      if (isQc || ch === 'nykaa' || ch === 'myntra') {
        if (d >= TODAY) continue;
        if (ch === 'instamart' && d >= TODAY - 3) continue;
      }
      const f = demand(d, ch === 'amazon' ? 'amazon' : isQc ? 'qc' : 'mkt') * (d === TODAY ? 1 : 1);
      let chNet = 0;
      for (const [pid, share] of Object.entries(cfg.mix)) {
        const prod = P[pid];
        if (prod.launchDay > d) continue;
        let units = poisson(r, cfg.units * 0.8 * share * f);
        if (ch === 'amazon' && pid === 'serum' && d > TODAY - 12 && d < TODAY - 6) units = Math.round(units * 0.3); // FBA stock-out
        if (units === 0) continue;
        const price = prod.asp * cfg.priceF;
        const gmv = units * price;
        const netRevenue = isQc ? (units * prod.mrp * QC_TRANSFER * (0.96 + r() * 0.1)) / (1 + GST) : gmv / (1 + GST);
        const returnsValue = netRevenue * cfg.ret * (0.7 + r() * 0.6);
        channelDaily.push({
          day: d, channel: ch, productId: pid, units, gmv: Math.round(gmv), netRevenue: Math.round(netRevenue),
          commission: Math.round(netRevenue * cfg.comm), logistics: Math.round(units * cfg.logistics), returnsValue: Math.round(returnsValue),
        });
        chNet += netRevenue;
      }
      const adCfg: Record<string, [Warehouse['channelAds'][number]['platform'], number, number]> = {
        amazon: ['amazon_ads', 0.2, 3.1], flipkart: ['flipkart_ads', 0.12, 3.5], blinkit: ['blinkit_ads', 0.1, 5.2], zepto: ['zepto_ads', 0.09, 5.6], instamart: ['instamart_ads', 0.08, 4.8],
      };
      const ad = adCfg[ch];
      if (ad) {
        const spend = chNet * ad[1] * (0.85 + r() * 0.3);
        channelAds.push({ day: d, platform: ad[0], spend: Math.round(spend), attributedSales: Math.round(spend * ad[2] * (0.85 + r() * 0.3)) });
      }
    }
  }

  // Purchase orders (sell-in) weekly per QC channel × city × hero SKU
  const purchaseOrders: PurchaseOrder[] = [];
  let poSeq = 1;
  for (let d = 0; d < TODAY; d += 7) {
    for (const ch of ['blinkit', 'zepto', 'instamart'] as const) {
      for (const city of QC_CITIES) {
        for (const pid of Object.keys(CH[ch].mix)) {
          const ordered = Math.round((CH[ch].units * (CH[ch].mix as Record<string, number>)[pid] * 7 * demand(d, 'qc')) / QC_CITIES.length * (0.8 + r() * 0.4));
          const poorFill = city === 'Hyderabad' && pid === 'serum' && d > TODAY - 35;
          const fill = poorFill ? 0.55 + r() * 0.1 : 0.84 + r() * 0.14;
          purchaseOrders.push({ id: `PO-${ch.slice(0, 2).toUpperCase()}-${String(poSeq++).padStart(5, '0')}`, channel: ch, day: d, city, productId: pid, orderedUnits: ordered, filledUnits: Math.round(ordered * Math.min(1, fill)) });
        }
      }
    }
  }
  const darkStores: DarkStoreAvailability[] = [];
  for (const ch of ['blinkit', 'zepto', 'instamart'] as const) {
    for (const city of QC_CITIES) {
      for (const pid of Object.keys(CH[ch].mix)) {
        const bad = city === 'Hyderabad' && pid === 'serum';
        darkStores.push({ channel: ch, city, productId: pid, inStock: bad ? 0.58 + r() * 0.08 : clamp(0.86 + r() * 0.13, 0, 0.99), daysOfCover: bad ? 2 + r() * 2 : 8 + r() * 14 });
      }
    }
  }

  // ── Inventory ───────────────────────────────────────────────────────────────
  // Run rate (non-FBA, non-QC channels) over the last 45 days, to size stock
  const drr: Record<string, number> = {};
  for (const o of orders) if (o.day > TODAY - 45 && o.day < TODAY) for (const l of o.lines) drr[l.productId] = (drr[l.productId] ?? 0) + l.qty / 45;
  for (const row of channelDaily) if (row.day > TODAY - 45 && ['flipkart', 'nykaa', 'myntra'].includes(row.channel)) drr[row.productId] = (drr[row.productId] ?? 0) + row.units / 45;
  const targetCover: Record<string, number> = { serum: 9, shampoo: 52, conditioner: 74, oil: 31, regimen: 22, curl: 0.4, dandruff: 40, mask: 128, beard: 210 };
  const batches: Batch[] = [];
  for (const p of products) {
    const units = Math.round((drr[p.id] ?? 1) * targetCover[p.id]);
    const expiryMonths = p.id === 'mask' ? 4 : p.id === 'beard' ? 9 : 14 + Math.floor(r() * 6);
    const split = p.id === 'beard' || p.id === 'curl' ? [1] : [0.62, 0.38];
    split.forEach((s, i) => batches.push({
      productId: p.id, facilityId: i === 0 ? 'bhw' : 'blr', batch: `${p.sku.slice(4, 7)}-${2600 + i * 7 + Math.floor(r() * 5)}`,
      units: Math.round(units * s), expiryDay: TODAY + Math.round(expiryMonths * 30.4) + i * 20,
    }));
    if (p.asin) batches.push({ productId: p.id, facilityId: 'fba', batch: 'FBA', units: Math.round((p.id === 'serum' ? 6 : 28) * 210 * ((CH.amazon.mix as Record<string, number>)[p.id] ?? 0.02)), expiryDay: TODAY + 400 });
  }
  const stockReports: StockReport[] = [];
  for (const p of products) {
    const wh = batches.filter((b) => b.productId === p.id && b.facilityId !== 'fba').reduce((s, b) => s + b.units, 0);
    const noFeed = p.id === 'dandruff';
    stockReports.push({ source: 'warehouse', productId: p.id, units: noFeed ? null : wh });
    stockReports.push({ source: 'shopify', productId: p.id, units: noFeed ? 320 : Math.max(0, wh + (p.id === 'oil' ? 140 : p.id === 'mask' ? -60 : 0)) });
    if (p.asin) stockReports.push({ source: 'amazon_fba', productId: p.id, units: batches.find((b) => b.productId === p.id && b.facilityId === 'fba')?.units ?? 0 });
    const qcUnits = darkStores.filter((x) => x.productId === p.id).reduce((s, x) => s + x.daysOfCover * 6, 0);
    if (qcUnits) stockReports.push({ source: 'qc_dark_stores', productId: p.id, units: Math.round(qcUnits) });
  }
  // Remove stock rows for the no-feed SKU from batches (WMS has no mapping)
  const batchesFinal = batches.filter((b) => !(b.productId === 'dandruff' && b.facilityId !== 'fba'));

  // ── Amazon specifics ───────────────────────────────────────────────────────
  const amazonAsin: AmazonAsinDaily[] = [];
  for (let d = Math.max(0, TODAY - 90); d <= TODAY; d++) {
    for (const p of products) {
      if (!p.asin) continue;
      amazonAsin.push({ day: d, productId: p.id, buyBoxPct: p.id === 'oil' ? 0.78 + r() * 0.08 : 0.94 + r() * 0.05, sessions: Math.round(400 * ((CH.amazon.mix as Record<string, number>)[p.id] ?? 0.02) * 10 * demand(d, 'amazon')) });
    }
  }
  const amazonSettlements: AmazonSettlement[] = [];
  for (let s = 0, i = 1; s < DAYS + 14; s += 14, i++) {
    const end = s + 13;
    const net = channelDaily.filter((x) => x.channel === 'amazon' && x.day >= s && x.day <= end).reduce((a, x) => a + x.netRevenue * 1.18 - x.commission - x.logistics - x.returnsValue, 0);
    const ads = channelAds.filter((x) => x.platform === 'amazon_ads' && x.day >= s && x.day <= end).reduce((a, x) => a + x.spend, 0);
    const payout = end + 3;
    amazonSettlements.push({
      id: `SET-${String(i).padStart(3, '0')}`, startDay: s, endDay: end, payoutDay: payout,
      amount: Math.round(net - ads * 0.0 - net * 0.012),
      status: payout <= TODAY ? 'paid' : end <= TODAY ? 'scheduled' : 'forecast',
    });
  }
  const amazonClaims: AmazonClaim[] = [];
  const kinds: AmazonClaim['kind'][] = ['lost', 'damaged', 'short_received', 'removal', 'refund_mismatch'];
  for (let i = 0; i < 46; i++) {
    const p = products.filter((x) => x.asin)[Math.floor(r() * 7)];
    const units = 1 + Math.floor(r() * (i % 9 === 0 ? 40 : 6));
    amazonClaims.push({ id: `CLM-${4000 + i}`, kind: kinds[i % 5], productId: p.id, units, value: Math.round(units * p.asp * 0.85), eventDay: TODAY - Math.floor(r() * 175) });
  }

  // ── Experiments & evidence ─────────────────────────────────────────────────
  const experiments = [
    { id: 'x1', question: 'Does a price-led hook beat a benefit-led hook for the Serum?', hypothesis: 'Price-led hooks lift CTR ≥ 15% without hurting CVR', variant: '₹649 starter hook vs “hair fall in 30 days”', minSpend: 150000, spentSoFar: 62000, readDay: TODAY + 9, killRule: 'Stop if CVR drops > 20% after ₹75k', status: 'running' as const },
    { id: 'x2', question: 'Does the bundle page lift AOV vs the PDP?', hypothesis: 'Regimen page raises AOV ≥ 12% at equal CVR', variant: '/pages/hair-fall-regimen vs serum PDP', minSpend: 120000, spentSoFar: 131000, readDay: TODAY - 2, killRule: 'Stop if CVR drops > 25%', status: 'running' as const },
    { id: 'x3', question: 'Does UGC video beat studio static?', hypothesis: 'UGC lifts CTR and CVR', variant: 'UGC 9:16 vs studio 1:1', minSpend: 100000, spentSoFar: 100000, readDay: TODAY - 30, killRule: '—', status: 'concluded' as const, answer: 'UGC video beat studio static on CTR, no CVR difference detected.' },
  ];
  const evidence = [
    'UGC video beat studio static on CTR, no CVR difference detected.',
    'Free-shipping threshold at ₹499 raised AOV by 6% with no CVR loss.',
    'Hindi/English hooks beat English-only on CTR in tier-2 cities; no difference in metros.',
    '“No difference we could detect” counts as an answer: Tamil captions on Serum ads, 4 weeks.',
  ];

  // ── Connector runs (freshness is computed from these) ─────────────────────
  const generatedAt = DAY0_UTC - IST_OFFSET_MS + TODAY * DAY_MS + TODAY_ELAPSED * DAY_MS;
  const min = 60000;
  const run = (connectorId: string, agoMin: number | null, latest: Day | null, rows: number, status: ConnectorRun['status'], message?: string): ConnectorRun =>
    ({ connectorId, lastSyncAt: agoMin === null ? null : generatedAt - agoMin * min, latestDataDay: latest, rows, status, message });
  const connectorRuns: ConnectorRun[] = [
    run('shopify', 3, TODAY, orders.length, 'ok'),
    run('checkout_events', 140, TODAY, pdpDaily.length, 'ok'),
    run('meta', 22, TODAY, adDaily.filter((a) => a.campaignId.startsWith('m')).length, 'ok'),
    run('google_ads', 31, TODAY, adDaily.filter((a) => a.campaignId.startsWith('g')).length, 'ok'),
    run('snapchat', 95, TODAY, adDaily.filter((a) => a.campaignId.startsWith('s')).length, 'ok'),
    run('tiktok', null, null, 0, 'not_connected'),
    run('razorpay', 12, TODAY, payments.length, 'ok'),
    run('ga4', 9 * 60, TODAY - 1, sessions.length, 'ok'),
    run('triple_whale', null, null, 0, 'not_connected'),
    run('littledata', 40, TODAY, 18230, 'ok'),
    run('amazon_sp', 48, TODAY, channelDaily.filter((c) => c.channel === 'amazon').length, 'ok'),
    run('amazon_ads', 52, TODAY, channelAds.filter((c) => c.platform === 'amazon_ads').length, 'ok'),
    run('flipkart', 200, TODAY, channelDaily.filter((c) => c.channel === 'flipkart').length, 'ok'),
    run('nykaa', 10 * 60, TODAY - 1, channelDaily.filter((c) => c.channel === 'nykaa' || c.channel === 'myntra').length, 'ok'),
    run('blinkit', 9 * 60, TODAY - 1, channelDaily.filter((c) => c.channel === 'blinkit').length, 'ok'),
    run('zepto', 9.5 * 60, TODAY - 1, channelDaily.filter((c) => c.channel === 'zepto').length, 'ok'),
    run('instamart', 3 * 24 * 60 + 300, TODAY - 4, channelDaily.filter((c) => c.channel === 'instamart').length, 'stale', 'Report email not received since Mon; portal password rotated?'),
    run('shiprocket', 18, TODAY, shipments.length, 'ok'),
    run('wms', 26, TODAY, batchesFinal.length, 'partial', '1 SKU (ARA-ADS-200) has no WMS mapping'),
    run('erpnext', null, null, 0, 'awaiting_approval', 'Read-only API role requested from finance'),
    run('sku_costs', 76 * 24 * 60, 133, skuCosts.length, 'partial'),
    run('governance', 30 * 24 * 60, TODAY, 5, 'ok'),
  ];

  return {
    brand: { name: (import.meta.env?.VITE_BRAND_NAME as string | undefined) || 'Arata', category: 'Hair care · regimen' },
    day0: DAY0_UTC - IST_OFFSET_MS,
    today: TODAY,
    todayElapsed: TODAY_ELAPSED,
    generatedAt,
    products,
    skuCosts,
    orders,
    shipments,
    couriers: COURIERS,
    payments,
    campaigns: CAMPAIGNS.map(({ id, platform, name, objective, productId, destination, intentTag, startDay }) => ({ id, platform, name, objective, productId, destination, intentTag, startDay })),
    creatives,
    adDaily,
    sessions,
    shopifySessions,
    pdpDaily,
    facilities: FACILITIES,
    batches: batchesFinal,
    stockReports,
    channelDaily,
    channelAds,
    purchaseOrders,
    darkStores,
    amazonSettlements,
    amazonClaims,
    amazonAsin,
    experiments,
    evidence,
    connectorRuns,
    governance: { gstRate: GST, freightPerOrder: 72, rtoRate: 0.12, paymentFeePct: 0.0236, packagingPerOrder: null, cacCoverageThreshold: 0.8 },
  };
}
