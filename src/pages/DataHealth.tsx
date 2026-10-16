import { useEffect, useRef, useState } from 'react';
import { ask, SUGGESTED } from '../ask/answer';
import { type FeedHealth } from '../metrics/health';
import { ago, compact } from '../metrics/format';
import { dayLabel } from '../metrics/range';
import { METRIC_BY_ID, METRICS } from '../metrics/registry';
import { CONNECTOR_BY_ID } from '../connectors/registry';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, PageHead, type Tone } from '../ui/kit';

const STATUS_TONE: Record<FeedHealth['status'], Tone> = {
  ok: 'good', stale: 'crit', partial: 'warn', awaiting_approval: 'warn', not_connected: 'neutral', error: 'crit',
};

export default function DataHealth() {
  const { engine, range, param, navigate } = useApp();
  const feeds = engine.health.feeds();
  const [metricId, setMetricId] = useState(param === 'registry' ? METRICS[0].id : 'blended_mer');
  const registryRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<{ text: string; sources: string[]; via: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const m = METRIC_BY_ID[metricId];

  useEffect(() => {
    if (param === 'registry') registryRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [param]);

  const run = async (question: string) => {
    if (!question.trim()) return;
    setQ(question);
    setBusy(true);
    const r = await ask(question, engine, range);
    setAnswer({ text: r.answer, sources: r.sources, via: r.via });
    setBusy(false);
  };

  const connected = feeds.filter((f) => f.status !== 'not_connected');
  return (
    <>
      <PageHead
        title="Data health"
        sub={`Connectors, schedules and coverage · freshness is computed from each feed's last sync and latest data, never set by hand`}
        actions={<button className="btn" onClick={() => navigate('connectors')}>Manage connectors →</button>}
      />

      <div className="grid split-7-5">
        <Card>
          <CardHead title="Data feeds" sub={`${connected.length} connected · ${feeds.filter((f) => f.status === 'ok').length} healthy`} />
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr><th>Feed</th><th>Schedule</th><th className="num">Rows</th><th>Latest data</th><th>Status</th><th>Unlocks</th></tr>
              </thead>
              <tbody>
                {feeds.map((f) => (
                  <tr key={f.def.id} className="clickable" onClick={() => navigate('connectors', f.def.id)} title={f.run.message ?? f.def.notes}>
                    <td>{f.def.name}</td>
                    <td className="small">{f.def.scheduleLabel}</td>
                    <td className="num">{f.run.rows ? compact(f.run.rows) : '—'}</td>
                    <td className="small nowrap">
                      {f.run.latestDataDay === null ? '—' : f.run.latestDataDay === engine.cal.today ? 'today' : f.run.latestDataDay === engine.cal.today - 1 ? 'yesterday' : dayLabel(engine.cal, f.run.latestDataDay)}
                      {f.run.lastSyncAt && <div className="muted tiny">synced {ago(engine.w.generatedAt - f.run.lastSyncAt)}</div>}
                    </td>
                    <td><Badge tone={STATUS_TONE[f.status]}>{f.label}</Badge>{f.run.message && <div className="tiny muted" style={{ maxWidth: 200 }}>{f.run.message}</div>}</td>
                    <td className="small muted">{f.def.unlocks.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="stack">
          <Card>
            <CardHead title={`Metric definition — ${m.name}`} sub="Every card opens its registered definition" />
            <table className="def-table">
              <tbody>
                <tr><td>Formula</td><td>{m.formula}</td></tr>
                <tr><td>Sources</td><td>{m.sources.map((s) => CONNECTOR_BY_ID[s]?.name ?? s).join(' · ')}</td></tr>
                <tr><td>Timezone</td><td>{m.timezone}</td></tr>
                <tr><td>Caveats</td><td>{m.caveats}</td></tr>
                <tr><td>Change log</td><td>{m.changelog.length ? m.changelog.map((c) => <div key={c.date}>{c.date} — {c.note}</div>) : '—'}</td></tr>
              </tbody>
            </table>
          </Card>
          <Card>
            <CardHead title="Ask" sub="Grounded in the page's computed numbers and the evidence library · never free SQL" />
            <form className="row" onSubmit={(e) => { e.preventDefault(); void run(q); }}>
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why did MER fall this week?" style={{ flex: 1 }} aria-label="Question" />
              <button className="btn primary" disabled={busy}>{busy ? '…' : 'Ask'}</button>
            </form>
            <div className="suggestions">{SUGGESTED.slice(0, 3).map((s) => <button key={s} className="chip" onClick={() => void run(s)}>{s}</button>)}</div>
            {answer && (
              <div className="ask-answer">
                {answer.text}
                <div className="cite">{answer.sources.length > 0 && `Sources: ${answer.sources.join(', ')} · `}{answer.via === 'claude' ? 'Claude' : 'local answerer'}</div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <div ref={registryRef}>
        <Card className="mt">
          <CardHead title="Metric registry" sub="One registered definition per metric: formula, sources, timezone, caveats, change log" />
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Metric</th><th>Formula</th><th>Caveats</th></tr></thead>
              <tbody>
                {METRICS.map((x) => (
                  <tr key={x.id} className={`clickable ${x.id === metricId ? 'selected' : ''}`} onClick={() => { setMetricId(x.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                    <td className="strong nowrap">{x.name}</td>
                    <td className="small">{x.formula}</td>
                    <td className="small muted">{x.caveats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <BuiltFrom sources={['connector job logs', 'metric registry', 'Claude API for Ask, fed computed page data only']} />
    </>
  );
}
