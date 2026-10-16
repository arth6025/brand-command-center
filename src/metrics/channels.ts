/** Amazon command centre and CM2 by sales channel (marketplaces + quick commerce). */
import type { ChannelModel, SalesChannel } from '../domain/types';
import { type Core } from './core';
import { safeDiv } from './format';
import { type DateRange, rangeKey } from './range';

export const CHANNEL_META: Record<SalesChannel, { label: string; model: ChannelModel; modelLabel: string; connector: string; adPlatform?: string }> = {
  website: { label: 'Website', model: 'd2c', modelLabel: 'D2C', connector: 'shopify' },
  amazon: { label: 'Amazon', model: 'marketplace', modelLabel: 'marketplace', connector: 'amazon_sp', adPlatform: 'amazon_ads' },
  flipkart: { label: 'Flipkart', model: 'marketplace', modelLabel: 'marketplace', connector: 'flipkart', adPlatform: 'flipkart_ads' },
  blinkit: { label: 'Blinkit', model: 'sell_in', modelLabel: 'sell-in (PO)', connector: 'blinkit', adPlatform: 'blinkit_ads' },
  zepto: { label: 'Zepto', model: 'sell_in', modelLabel: 'sell-in (PO)', connector: 'zepto', adPlatform: 'zepto_ads' },
  instamart: { label: 'Swiggy Instamart', model: 'sell_in', modelLabel: 'sell-in (PO)', connector: 'instamart', adPlatform: 'instamart_ads' },
  nykaa: { label: 'Nykaa', model: 'marketplace', modelLabel: 'marketplace', connector: 'nykaa' },
  myntra: { label: 'Myntra', model: 'marketplace', modelLabel: 'marketplace', connector: 'nykaa' },
};

export const CHANNEL_ORDER: SalesChannel[] = ['website', 'amazon', 'blinkit', 'zepto', 'instamart', 'nykaa', 'flipkart', 'myntra'];

export interface ChannelCm2Row {
  channel: SalesChannel;
  netRevenue: number;
  cogs: number;
  gmPct: number | null;
  fees: number;
  logistics: number | null;
  ads: number;
  cm2: number;
  cm2Pct: number | null;
  units: number;
}

export class Channels {
  constructor(private core: Core) {}

  cm2(r: DateRange): ChannelCm2Row[] {
    return this.core.cached(`cm2ch:${rangeKey(r)}`, () => {
      const web = this.core.ladder(r, 'website');
      const rows: Record<string, ChannelCm2Row> = {};
      rows.website = {
        channel: 'website', netRevenue: web.netRevenue, cogs: web.cogs, gmPct: safeDiv(web.gm, web.netRevenue),
        fees: web.paymentFees, logistics: web.freight + web.rto, ads: web.adSpend, cm2: web.cm2 - 0, cm2Pct: safeDiv(web.cm2, web.netRevenue), units: web.units,
      };
      for (const c of this.core.channelRows(r)) {
        const row = (rows[c.channel] ||= { channel: c.channel, netRevenue: 0, cogs: 0, gmPct: null, fees: 0, logistics: 0, ads: 0, cm2: 0, cm2Pct: null, units: 0 });
        row.netRevenue += c.netRevenue - c.returnsValue;
        row.cogs += (this.core.unitCost(c.productId, c.day) ?? 0) * c.units;
        row.fees += c.commission;
        row.logistics = (row.logistics ?? 0) + c.logistics;
        row.units += c.units;
      }
      const adToChannel: Record<string, SalesChannel> = { amazon_ads: 'amazon', flipkart_ads: 'flipkart', blinkit_ads: 'blinkit', zepto_ads: 'zepto', instamart_ads: 'instamart' };
      for (const a of this.core.channelAds(r)) {
        const ch = adToChannel[a.platform];
        if (ch && rows[ch]) rows[ch].ads += a.spend;
      }
      for (const row of Object.values(rows)) {
        if (row.channel === 'website') continue;
        row.gmPct = safeDiv(row.netRevenue - row.cogs, row.netRevenue);
        if (CHANNEL_META[row.channel].model === 'sell_in') row.logistics = null;
        row.cm2 = row.netRevenue - row.cogs - row.fees - (row.logistics ?? 0) - row.ads;
        row.cm2Pct = safeDiv(row.cm2, row.netRevenue);
      }
      return CHANNEL_ORDER.filter((c) => rows[c]).map((c) => rows[c]);
    });
  }

  /** Product × channel revenue share (row-normalised per product). */
  matrix(r: DateRange) {
    return this.core.cached(`matrix:${rangeKey(r)}`, () => {
      const cols: SalesChannel[] = ['website', 'amazon', 'blinkit', 'zepto', 'instamart', 'nykaa'];
      const cells: Record<string, Record<string, number>> = {};
      const add = (pid: string, ch: string, v: number) => { const row = (cells[pid] ||= {}); row[ch] = (row[ch] ?? 0) + v; };
      for (const o of this.core.orders(r)) if (o.status === 'delivered' || o.status === 'in_transit') for (const l of o.lines) add(l.productId, 'website', l.net);
      for (const c of this.core.channelRows(r)) add(c.productId, cols.includes(c.channel) ? c.channel : 'others', c.netRevenue);
      const allCols = [...cols, 'others'];
      const rows = this.core.w.products.filter((p) => cells[p.id]).map((p) => {
        const total = Object.values(cells[p.id]).reduce((a, b) => a + b, 0);
        return { product: p, total, shares: allCols.map((c) => safeDiv(cells[p.id][c] ?? 0, total) ?? 0) };
      }).sort((a, b) => b.total - a.total);
      return { cols: allCols.map((c) => (c === 'others' ? 'Others' : CHANNEL_META[c as SalesChannel].label)), rows };
    });
  }

  darkStores() {
    return this.core.cached('darkstores', () => {
      const w = this.core.w;
      const t = w.today;
      const cities = [...new Set(w.darkStores.map((d) => d.city))];
      return cities.map((city) => {
        const ds = w.darkStores.filter((d) => d.city === city);
        const pos = w.purchaseOrders.filter((p) => p.city === city && p.day >= t - 30);
        const ordered = pos.reduce((a, p) => a + p.orderedUnits, 0);
        const filled = pos.reduce((a, p) => a + p.filledUnits, 0);
        const heroSerum = ds.filter((d) => d.productId === 'serum');
        return {
          city,
          inStock: ds.reduce((a, d) => a + d.inStock, 0) / ds.length,
          heroInStock: heroSerum.length ? heroSerum.reduce((a, d) => a + d.inStock, 0) / heroSerum.length : null,
          fillRate: safeDiv(filled, ordered),
          cover: ds.reduce((a, d) => a + d.daysOfCover, 0) / ds.length,
        };
      }).sort((a, b) => a.inStock - b.inStock);
    });
  }

  amazon(r: DateRange) {
    return this.core.cached(`amazon:${rangeKey(r)}`, () => {
      const w = this.core.w;
      const t = w.today;
      let units = 0, gmv = 0, net = 0, fees = 0, logistics = 0, returns = 0, cogs = 0;
      const perAsin: Record<string, { net: number; fees: number; cogs: number; units: number }> = {};
      for (const c of this.core.channelRows(r)) {
        if (c.channel !== 'amazon') continue;
        units += c.units; gmv += c.gmv; net += c.netRevenue; fees += c.commission; logistics += c.logistics; returns += c.returnsValue;
        const cost = (this.core.unitCost(c.productId, c.day) ?? 0) * c.units;
        cogs += cost;
        const b = (perAsin[c.productId] ||= { net: 0, fees: 0, cogs: 0, units: 0 });
        b.net += c.netRevenue - c.returnsValue; b.fees += c.commission + c.logistics; b.cogs += cost; b.units += c.units;
      }
      let ads = 0, adSales = 0;
      for (const a of this.core.channelAds(r)) if (a.platform === 'amazon_ads') { ads += a.spend; adSales += a.attributedSales; }
      const recognised = net - returns;
      const contribution = recognised - fees - logistics - cogs - ads;
      const preAds = recognised - fees - logistics - cogs;

      // FBA stock and stock-out losses
      const fba = w.batches.filter((b) => b.facilityId === 'fba');
      const sellable = fba.reduce((a, b) => a + b.units, 0);
      const drr: Record<string, number> = {};
      for (let d = t - 30; d < t; d++) for (const c of this.core.chByDay[d] ?? []) if (c.channel === 'amazon') drr[c.productId] = (drr[c.productId] ?? 0) + c.units / 30;
      const totalDrr = Object.values(drr).reduce((a, b) => a + b, 0);
      // Serum lost-sales estimate from the stock-out window vs the 30-day pre-window run rate
      let lost = 0;
      const serum = this.core.productById.serum;
      let before = 0;
      for (let d = t - 45; d < t - 15; d++) for (const c of this.core.chByDay[d] ?? []) if (c.channel === 'amazon' && c.productId === 'serum') before += c.units / 30;
      for (let d = Math.max(r.start, t - 11); d <= Math.min(r.end, t - 7); d++) {
        let actual = 0;
        for (const c of this.core.chByDay[d] ?? []) if (c.channel === 'amazon' && c.productId === 'serum') actual += c.units;
        lost += Math.max(0, before - actual) * serum.asp * 0.9;
      }
      const buyBox = w.amazonAsin.filter((a) => a.day >= r.start && a.day <= r.end);
      const bbWeighted = safeDiv(buyBox.reduce((a, x) => a + x.buyBoxPct * x.sessions, 0), buyBox.reduce((a, x) => a + x.sessions, 0));
      const lossMaking = Object.values(perAsin).filter((b) => b.net - b.fees - b.cogs - ads * safeDiv(b.net, recognised)! < 0).length;

      const claimable = w.amazonClaims.filter((c) => c.eventDay > t - 180);
      const expiring = claimable.filter((c) => c.eventDay <= t - 166);
      const nextPayout = w.amazonSettlements.find((s) => s.status === 'scheduled') ?? w.amazonSettlements.find((s) => s.status === 'forecast');
      const next30 = w.amazonSettlements.filter((s) => s.payoutDay > t && s.payoutDay <= t + 30).reduce((a, s) => a + s.amount, 0);

      return {
        inventory: { sellable, locations: 1, cover: safeDiv(sellable, totalDrr), regionalInStock: 0.84, lostSales: lost },
        revenue: { gmv, net: recognised, orders: Math.round(units / 1.08), units, aov: safeDiv(gmv, units / 1.08), buyBox: bbWeighted, refunds: returns },
        ads: { spend: ads, acos: safeDiv(ads, adSales), tacos: safeDiv(ads, gmv), breakEvenAcos: safeDiv(preAds, recognised) },
        profit: { contribution, margin: safeDiv(contribution, recognised), lossMaking, feesPosted: 0.92 },
        asins: Object.entries(perAsin).map(([pid, b]) => {
          const adsAlloc = ads * (safeDiv(b.net, recognised) ?? 0);
          const contrib = b.net - b.fees - adsAlloc - b.cogs;
          return { product: this.core.productById[pid], net: b.net, fees: b.fees, ads: adsAlloc, landed: b.cogs, contribution: contrib, margin: safeDiv(contrib, b.net) };
        }).sort((a, b) => b.net - a.net),
        claims: { claimable: claimable.reduce((a, c) => a + c.value, 0), claimableCount: claimable.length, expiring: expiring.reduce((a, c) => a + c.value, 0), expiringCount: expiring.length, list: claimable },
        payout: { next: nextPayout, next30 },
      };
    });
  }
}
