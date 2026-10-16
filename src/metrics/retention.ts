/** Repeat rates, monthly cohorts and LTV on revenue and on CM1. */
import type { Day, Order } from '../domain/types';
import { type Core, isRecognised } from './core';
import { safeDiv } from './format';
import { dateOf, monthName } from './range';

const REGIMEN_STEPS = new Set(['serum', 'shampoo', 'conditioner', 'oil']);

export class Retention {
  constructor(private core: Core) {}

  private customers() {
    return this.core.cached('customers', () => {
      const map = new Map<number, Order[]>();
      for (const o of this.core.w.orders) {
        if (o.customerId <= 0 || o.status === 'cancelled') continue;
        const list = map.get(o.customerId);
        if (list) list.push(o);
        else map.set(o.customerId, [o]);
      }
      // Only customers whose first order falls inside the warehouse window
      const out: { first: Day; orders: Order[] }[] = [];
      for (const list of map.values()) if (list[0].isFirstOrder) out.push({ first: list[0].day, orders: list });
      return out;
    });
  }

  repeatRates() {
    return this.core.cached('repeat', () => {
      const t = this.core.w.today;
      const rate = (window: number) => {
        let eligible = 0, repeated = 0;
        for (const c of this.customers()) {
          if (c.first > t - window) continue;
          eligible++;
          if (c.orders.some((o, i) => i > 0 && o.day - c.first <= window)) repeated++;
        }
        return { rate: safeDiv(repeated, eligible), eligible };
      };
      // Regimen attach: orders in the last 90 days carrying 2+ regimen steps or the kit
      let orders = 0, attach = 0;
      for (const o of this.core.w.orders) {
        if (o.day < t - 90 || !isRecognised(o)) continue;
        orders++;
        const steps = new Set(o.lines.map((l) => l.productId).filter((p) => REGIMEN_STEPS.has(p)));
        if (steps.size >= 2 || o.lines.some((l) => l.productId === 'regimen')) attach++;
      }
      return { d14: rate(14), d30: rate(30), d90: rate(90), regimenAttach: safeDiv(attach, orders) };
    });
  }

  /** Cumulative share of each month's new customers who ordered again by month k. */
  cohorts() {
    return this.core.cached('cohorts', () => {
      const cal = this.core.cal;
      const t = this.core.w.today;
      const monthIndex = (d: Day) => { const dt = dateOf(cal, d); return dt.getUTCFullYear() * 12 + dt.getUTCMonth(); };
      const groups = new Map<number, { label: string; firstDay: Day; customers: { first: Day; orders: Order[] }[] }>();
      for (const c of this.customers()) {
        const m = monthIndex(c.first);
        const g = groups.get(m) ?? { label: `${monthName(cal, c.first)} cohort`, firstDay: c.first, customers: [] };
        g.firstDay = Math.min(g.firstDay, c.first);
        g.customers.push(c);
        groups.set(m, g);
      }
      const nowM = monthIndex(t);
      const rows = [...groups.entries()].sort((a, b) => a[0] - b[0]).filter(([m]) => m < nowM).map(([m, g]) => {
        const maxK = Math.min(6, nowM - m - 0);
        const cells: (number | null)[] = [];
        for (let k = 1; k <= 6; k++) {
          if (k > maxK) { cells.push(null); continue; }
          let rep = 0;
          for (const c of g.customers) if (c.orders.some((o, i) => i > 0 && monthIndex(o.day) - m <= k && monthIndex(o.day) - m >= 1)) rep++;
          cells.push(rep / g.customers.length);
        }
        return { label: g.label, customers: g.customers.length, cells, complete: maxK };
      });
      return rows.slice(-6);
    });
  }

  ltv(cm1Pct: number | null) {
    return this.core.cached(`ltv:${cm1Pct?.toFixed(4)}`, () => {
      const t = this.core.w.today;
      const points: { month: number; revenue: number; cm1: number | null; n: number }[] = [];
      for (let m = 0; m <= 6; m++) {
        let n = 0, rev = 0;
        for (const c of this.customers()) {
          if (c.first > t - m * 30 - 1) continue;
          n++;
          for (const o of c.orders) if (o.day - c.first <= m * 30 && isRecognised(o)) rev += o.net;
        }
        if (n < 200) break;
        const avg = rev / n;
        points.push({ month: m, revenue: avg, cm1: cm1Pct === null ? null : avg * cm1Pct, n });
      }
      return points;
    });
  }
}
