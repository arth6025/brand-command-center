import { useCallback, useMemo, useState } from 'react';
import { CATEGORY_ORDER, CONNECTOR_BY_ID, CONNECTORS, type ConnectorDef } from '../connectors/registry';
import { type FeedHealth } from '../metrics/health';
import { ago, compact } from '../metrics/format';
import { dayLabel } from '../metrics/range';
import { ROUTE_LABEL } from '../nav';
import { type RouteId, useApp } from '../state/app';
import { Badge, Card, Drawer, Note, PageHead, type Tone } from '../ui/kit';

const TONE: Record<FeedHealth['status'], Tone> = {
  ok: 'good', stale: 'crit', partial: 'warn', awaiting_approval: 'warn', not_connected: 'neutral', error: 'crit',
};

const METHOD_LABEL: Record<ConnectorDef['method'], string> = {
  api: 'API pull', webhook: 'Webhook + API', warehouse_export: 'Warehouse export', portal_report: 'Scheduled portal report', sheet: 'Governed sheet',
};

/**
 * Connector catalogue. Credentials never touch the browser: the ingestion
 * service holds them and lands normalised tables; this screen shows what each
 * source provides, its status, and what it unlocks.
 */
export default function Connectors() {
  const { engine, param, navigate } = useApp();
  const feeds = useMemo(() => Object.fromEntries(engine.health.feeds().map((f) => [f.def.id, f])), [engine]);
  const [filter, setFilter] = useState<'all' | 'attention' | 'available'>('all');
  const selected = param && CONNECTOR_BY_ID[param] ? CONNECTOR_BY_ID[param] : null;
  const close = useCallback(() => navigate('connectors'), [navigate]);

  const visible = CONNECTORS.filter((c) => {
    const s = feeds[c.id]?.status;
    if (filter === 'attention') return s === 'stale' || s === 'partial' || s === 'awaiting_approval' || s === 'error';
    if (filter === 'available') return s === 'not_connected';
    return true;
  });
  const counts = {
    connected: CONNECTORS.filter((c) => feeds[c.id]?.status !== 'not_connected').length,
    attention: CONNECTORS.filter((c) => ['stale', 'partial', 'awaiting_approval', 'error'].includes(feeds[c.id]?.status)).length,
  };

  return (
    <>
      <PageHead
        title="Connectors"
        sub={`${counts.connected} of ${CONNECTORS.length} sources connected · ${counts.attention} need attention · ad platforms, payments, attribution, storefront, marketplaces, quick commerce, logistics, WMS and ERP`}
        actions={
          <div className="row">
            {(['all', 'attention', 'available'] as const).map((f) => (
              <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'attention' ? `Needs attention · ${counts.attention}` : 'Not connected'}
              </button>
            ))}
          </div>
        }
      />

      {CATEGORY_ORDER.map((cat) => {
        const list = visible.filter((c) => c.category === cat);
        if (!list.length) return null;
        return (
          <div key={cat} className="mt">
            <div className="nav-label" style={{ padding: '0 0 6px' }}>{cat}</div>
            <div className="grid g3">
              {list.map((c) => {
                const f = feeds[c.id];
                return (
                  <Card key={c.id} className="stat clickable" onClick={() => navigate('connectors', c.id)}>
                    <div className="stat-top">
                      <span className="strong">{c.name}</span>
                      <span style={{ marginLeft: 'auto' }}><Badge tone={TONE[f.status]}>{f.label}</Badge></span>
                    </div>
                    <div className="small soft">{METHOD_LABEL[c.method]} · {c.scheduleLabel}</div>
                    <div className="small muted">
                      {f.run.lastSyncAt ? `Synced ${ago(engine.w.generatedAt - f.run.lastSyncAt)} · ${compact(f.run.rows)} rows` : f.run.message ?? c.notes ?? 'Not connected'}
                    </div>
                    <div className="row" style={{ gap: 4 }}>{c.unlocks.slice(0, 3).map((u) => <span key={u} className="chip">{u}</span>)}</div>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}

      {selected && <ConnectorDrawer def={selected} feed={feeds[selected.id]} onClose={close} />}
    </>
  );
}

function ConnectorDrawer({ def, feed, onClose }: { def: ConnectorDef; feed: FeedHealth; onClose: () => void }) {
  const { engine, navigate, notify } = useApp();
  const checklist = [
    `Source: ${def.name}`,
    `Auth: ${def.auth}`,
    `Method: ${METHOD_LABEL[def.method]}, ${def.scheduleLabel}`,
    `Lands tables: ${def.tables.join(', ')}`,
    'Store credentials in the ingestion service secret store (never in this app)',
    'Backfill 13 months so previous-year overlays work',
  ];
  return (
    <Drawer title={def.name} onClose={onClose}>
      <div className="row"><Badge tone={TONE[feed.status]}>{feed.label}</Badge><span className="small muted">{def.category}</span></div>
      {(feed.run.message || def.notes) && <div className="mt-s"><Note>{feed.run.message ?? def.notes}</Note></div>}
      <table className="def-table mt">
        <tbody>
          <tr><td>Method</td><td>{METHOD_LABEL[def.method]}</td></tr>
          <tr><td>Auth</td><td>{def.auth}</td></tr>
          <tr><td>Schedule</td><td>{def.scheduleLabel} · stale when data lags more than one cycle beyond expected</td></tr>
          <tr><td>Last sync</td><td>{feed.run.lastSyncAt ? `${ago(engine.w.generatedAt - feed.run.lastSyncAt)}` : '—'}</td></tr>
          <tr><td>Latest data</td><td>{feed.run.latestDataDay === null ? '—' : dayLabel(engine.cal, feed.run.latestDataDay, true)}</td></tr>
          <tr><td>Rows</td><td>{feed.run.rows ? feed.run.rows.toLocaleString('en-IN') : '—'}</td></tr>
          <tr><td>Tables</td><td>{def.tables.map((t) => <code key={t} style={{ marginRight: 6 }}>{t}</code>)}</td></tr>
          <tr><td>Unlocks</td><td>{def.unlocks.join(', ')}</td></tr>
          <tr><td>Screens</td><td>{def.pages.map((p, i) => (
            <span key={p}>{i > 0 && ' · '}<a href={`#/${p}`} onClick={(e) => { e.preventDefault(); navigate(p as RouteId); }}>{ROUTE_LABEL[p as RouteId] ?? p}</a></span>
          ))}</td></tr>
        </tbody>
      </table>
      <h3 className="mt">Setup checklist</h3>
      <ol className="small soft">{checklist.map((c) => <li key={c}>{c}</li>)}</ol>
      <button className="btn" onClick={() => { void navigator.clipboard?.writeText(checklist.join('\n')).then(() => notify('Checklist copied'), () => notify('Copy failed')); }}>Copy checklist</button>
      <p className="small muted mt">Credentials are entered in the ingestion service, not here. This app reads only the normalised tables it lands.</p>
    </Drawer>
  );
}
