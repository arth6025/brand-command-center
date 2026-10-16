/**
 * Trading Room: monthly plan per product line.
 *   sales = ASP × quantity
 *   product views = quantity ÷ conversion
 *   spend = sales ÷ target ROAS
 * ASP, conversion and ROAS are parameters; exactly one of quantity / sales /
 * spend is the driver the user locked, and the other two are solved.
 */
import { type Core, isRecognised } from './core';
import { safeDiv } from './format';
import { daysInMonth, startOfMonth } from './range';

export type Driver = 'qty' | 'sales' | 'spend';

export interface PlanRow {
  line: string;
  asp: number;
  conv: number;
  roas: number;
  driver: Driver;
  /** Value of the driver. */
  value: number;
  /** Which parameters the user overrode (for the yellow cells). */
  touched: Partial<Record<'asp' | 'conv' | 'roas', boolean>>;
}

export interface SolvedRow extends PlanRow {
  qty: number;
  sales: number;
  views: number;
  spend: number;
}

export function solve(row: PlanRow): SolvedRow {
  const asp = Math.max(row.asp, 0.01);
  const roas = Math.max(row.roas, 0.01);
  const conv = Math.max(row.conv, 0.0001);
  let qty: number, sales: number, spend: number;
  if (row.driver === 'qty') { qty = row.value; sales = qty * asp; spend = sales / roas; }
  else if (row.driver === 'sales') { sales = row.value; qty = sales / asp; spend = sales / roas; }
  else { spend = row.value; sales = spend * roas; qty = sales / asp; }
  return { ...row, qty, sales, spend, views: qty / conv };
}

export class Plan {
  constructor(private core: Core) {}

  lines() {
    return [...new Set(this.core.w.products.map((p) => p.line))];
  }

  /** Defaults from the trailing 90 days of real website sales. */
  defaults(): PlanRow[] {
    return this.core.cached('plan-defaults', () => {
      const t = this.core.w.today;
      const r = { preset: 'custom' as const, start: t - 90, end: t - 1 };
      const lineOf = Object.fromEntries(this.core.w.products.map((p) => [p.id, p.line]));
      const agg: Record<string, { units: number; net: number; views: number; spend: number }> = {};
      const get = (l: string) => (agg[l] ||= { units: 0, net: 0, views: 0, spend: 0 });
      let totalNet = 0;
      for (const o of this.core.orders(r)) {
        if (!isRecognised(o)) continue;
        for (const l of o.lines) { const b = get(lineOf[l.productId]); b.units += l.qty; b.net += l.net; totalNet += l.net; }
      }
      for (const p of this.core.w.pdpDaily) if (p.day >= r.start && p.day <= r.end) get(lineOf[p.productId]).views += p.pdpViews;
      const campaignProduct = Object.fromEntries(this.core.w.campaigns.map((c) => [c.id, c.productId]));
      let generic = 0;
      for (const a of this.core.ads(r)) {
        const pid = campaignProduct[a.campaignId];
        if (pid) get(lineOf[pid]).spend += a.spend;
        else generic += a.spend;
      }
      return this.lines().filter((l) => agg[l]?.units).map((line) => {
        const b = agg[line];
        const spend = b.spend + generic * (b.net / totalNet);
        const days = 90;
        return {
          line, asp: Math.round(b.net / b.units), conv: safeDiv(b.units, b.views) ?? 0.02, roas: Math.round((safeDiv(b.net, spend) ?? 2) * 100) / 100,
          driver: 'qty' as Driver, value: Math.round((b.units / days) * 30 * 1.08), touched: {},
        };
      });
    });
  }

  /** Plan vs actual for the current month, by week. */
  board(plan: SolvedRow[]) {
    const cal = this.core.cal;
    const t = this.core.w.today;
    const som = startOfMonth(cal, t);
    const dim = daysInMonth(cal, t);
    const elapsed = t - som + this.core.w.todayElapsed;
    const lineOf = Object.fromEntries(this.core.w.products.map((p) => [p.id, p.line]));
    const actual: Record<string, { weeks: number[]; daily: number[] }> = {};
    for (let d = som; d <= t; d++) {
      for (const o of this.core.ordersByDay[d]) {
        if (!isRecognised(o)) continue;
        for (const l of o.lines) {
          const a = (actual[lineOf[l.productId]] ||= { weeks: [0, 0, 0, 0, 0], daily: Array(dim).fill(0) });
          a.weeks[Math.min(4, Math.floor((d - som) / 7))] += l.net;
          a.daily[d - som] += l.net;
        }
      }
    }
    return plan.map((p) => {
      const a = actual[p.line] ?? { weeks: [0, 0, 0, 0, 0], daily: Array(dim).fill(0) };
      const mtd = a.weeks.reduce((x, y) => x + y, 0);
      const perDayTarget = p.sales / dim;
      const pace = safeDiv(mtd / elapsed, perDayTarget);
      // Consecutive full days (ending yesterday) below 0.8× daily plan
      let streak = 0;
      for (let i = t - som - 1; i >= 0; i--) { if (a.daily[i] < 0.8 * perDayTarget) streak++; else break; }
      const currentWeek = Math.floor((t - som) / 7);
      return {
        line: p.line, target: p.sales, mtd, weeks: a.weeks.map((v, i) => (i > currentWeek ? null : v)),
        eom: (mtd / elapsed) * dim, pace, alert: streak >= 3 ? streak : 0,
      };
    });
  }
}
