/** Feed freshness computed from connector runs — never set by hand. */
import { CONNECTORS, type ConnectorDef } from '../connectors/registry';
import type { ConnectorRun } from '../domain/types';
import { type Core } from './core';

export type FeedStatus = 'ok' | 'stale' | 'awaiting_approval' | 'not_connected' | 'partial' | 'error';

export interface FeedHealth {
  def: ConnectorDef;
  run: ConnectorRun;
  status: FeedStatus;
  label: string;
  lagDays: number | null;
}

export class Health {
  constructor(private core: Core) {}

  feeds(): FeedHealth[] {
    return this.core.cached('feeds', () => {
      const w = this.core.w;
      const now = w.generatedAt;
      return CONNECTORS.map((def) => {
        const run = w.connectorRuns.find((x) => x.connectorId === def.id) ?? { connectorId: def.id, lastSyncAt: null, latestDataDay: null, rows: 0, status: 'not_connected' as const };
        if (run.status === 'not_connected' || run.status === 'awaiting_approval' || run.status === 'error') {
          return { def, run, status: run.status, label: run.status === 'not_connected' ? 'NOT CONNECTED' : run.status === 'awaiting_approval' ? 'AWAITING APPROVAL' : 'ERROR', lagDays: null };
        }
        const lagDays = run.latestDataDay === null ? null : w.today - run.latestDataDay;
        const syncLagMin = run.lastSyncAt === null ? Infinity : (now - run.lastSyncAt) / 60000;
        // Daily-or-slower feeds are expected to lag one day; faster feeds should hold today
        const subDaily = def.scheduleMinutes < 24 * 60;
        const expectedLag = subDaily ? 0 : 1;
        const dataLate = lagDays !== null && lagDays > expectedLag + 1;
        const syncLate = subDaily && syncLagMin > Math.max(def.scheduleMinutes * 3, 90);
        let status: FeedStatus = 'ok';
        if (def.id === 'sku_costs') status = 'partial';
        else if (dataLate || syncLate) status = 'stale';
        else if (run.status === 'partial') status = 'partial';
        let label = status === 'ok' ? 'OK' : status === 'stale' ? `${lagDays ?? '?'} DAYS STALE` : 'PARTIAL';
        if (def.id === 'sku_costs') label = `${Math.round(this.core.ladder({ preset: '30d', start: w.today - 29, end: w.today }, 'all').cogsCoverage * 100)}% COVERED`;
        return { def, run, status, label, lagDays };
      });
    });
  }

  /** Header indicator: freshest critical feed and count of feeds needing attention. */
  summary() {
    const feeds = this.feeds();
    const critical = feeds.filter((f) => ['shopify', 'meta', 'google_ads', 'razorpay', 'shiprocket'].includes(f.def.id));
    const lastSync = Math.max(...critical.map((f) => f.run.lastSyncAt ?? 0));
    const attention = feeds.filter((f) => f.status === 'stale' || f.status === 'error' || f.status === 'partial' || f.status === 'awaiting_approval');
    return { lastSync, attention: attention.length, staleIds: feeds.filter((f) => f.status === 'stale').map((f) => f.def.id) };
  }
}
