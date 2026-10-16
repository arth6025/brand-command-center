import { useMemo, useState } from 'react';
import type { TrafficSource } from '../domain/types';
import { compact, num, pct, pts } from '../metrics/format';
import { REPORT_DIMS, REPORT_METRICS, type ReportDim, type ReportMetric, runReport, SOURCE_LABEL, validateReport } from '../metrics/funnel';
import { dayLabel, describeRange } from '../metrics/range';
import { useApp } from '../state/app';
import { load, save } from '../state/storage';
import { Badge, BuiltFrom, Card, CardHead, Empty, Note, PageHead, Seg, Stat } from '../ui/kit';

interface SavedReport {
  name: string;
  dim: ReportDim;
  metrics: ReportMetric[];
}

const DIM_IDS = new Set<string>(REPORT_DIMS.map((d) => d.id));
const METRIC_IDS = new Set<string>(REPORT_METRICS.map((m) => m.id));

/** Saved configs come from localStorage, so drop anything that no longer matches the curated lists. */
function loadReports(): SavedReport[] {
  const raw = load<unknown>('reports', []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is SavedReport =>
    !!r && typeof r === 'object' && typeof (r as SavedReport).name === 'string' && DIM_IDS.has((r as SavedReport).dim)
    && Array.isArray((r as SavedReport).metrics) && (r as SavedReport).metrics.every((m) => METRIC_IDS.has(m)));
}

const ON = { background: 'var(--ink)', color: 'var(--surface)', borderColor: 'var(--ink)', cursor: 'pointer' };
const OFF = { cursor: 'pointer' };

/**
 * Channel funnel: the same steps for every channel from one source (GA4), so
 * channels are comparable. Coverage tiles say how much of the store GA4 sees;
 * the diagnosis names the stage where a channel loses people and what fixing
 * only that stage is worth.
 */
export default function ChannelFunnel() {
  const { engine, range, notify } = useApp();
  const ch = engine.funnel.channels(range);
  const [picked, setPicked] = useState<TrafficSource | null>(null);
  const source = picked && ch.rows.some((r) => r.source === picked) ? picked : ch.worst ?? ch.rows[0]?.source ?? null;
  const diag = source ? engine.funnel.diagnose(range, source) : [];
  const healthy = ch.trackingHealth !== null && ch.trackingHealth >= 0.9;

  // Custom report builder
  const [dim, setDim] = useState<ReportDim>('channel');
  const [metrics, setMetrics] = useState<ReportMetric[]>(['sessions', 'atc', 'checkout']);
  const [ran, setRan] = useState<{ dim: ReportDim; metrics: ReportMetric[] } | null>(null);
  const [saved, setSaved] = useState<SavedReport[]>(loadReports);
  const refusal = validateReport(dim, metrics);
  const report = useMemo(() => (ran ? runReport(engine.core, range, ran.dim, ran.metrics) : null), [engine, range, ran]);

  const toggleMetric = (m: ReportMetric) => setMetrics((xs) => (xs.includes(m) ? xs.filter((x) => x !== m) : REPORT_METRICS.map((x) => x.id).filter((id) => id === m || xs.includes(id))));
  const run = (d: ReportDim, ms: ReportMetric[]) => {
    if (validateReport(d, ms) !== null) return;
    setRan({ dim: d, metrics: ms });
  };
  const nameOf = (d: ReportDim, ms: ReportMetric[]) =>
    `${REPORT_DIMS.find((x) => x.id === d)?.label} × ${ms.map((m) => REPORT_METRICS.find((x) => x.id === m)?.label).join(', ')}`;
  const persist = (next: SavedReport[]) => { setSaved(next); save('reports', next); };
  const saveReport = () => {
    if (refusal !== null) return;
    const name = nameOf(dim, metrics);
    if (saved.some((s) => s.name === name)) { notify('Already saved'); return; }
    persist([...saved, { name, dim, metrics }]);
    notify(`Saved report: ${name}`);
  };

  return (
    <>
      <PageHead
        title="Channel funnel"
        sub={`${describeRange(engine.cal, range)} · GA4 session funnel · complete through ${dayLabel(engine.cal, ch.range.end, true)} (GA4 lands a day at a time, so today is never included)`}
      />

      <div className="grid g4">
        <Stat label="Sessions seen" source="GA4" value={pct(ch.sessionsSeen)} foot="of Shopify sessions" />
        <Stat label="Orders seen" source="GA4" value={pct(ch.ordersSeen)} foot="GA4 purchases vs Shopify orders" />
        <Stat label="Orders stamped" source="Shopify" metric="stamp_coverage" value={pct(ch.ordersStamped)} foot="carry a last-touch channel" />
        <Stat
          label="GA4 tracking health" source="GA4"
          value={<span className="row" style={{ gap: 8 }}>{pct(ch.trackingHealth, 0)} {ch.trackingHealth === null ? <Badge tone="neutral">Unknown</Badge> : healthy ? <Badge tone="good">Healthy</Badge> : <Badge tone="crit">Degraded</Badge>}</span>}
          foot="yesterday's GA4/Shopify coverage vs its trailing 14-day average · alerts below 90%"
        />
      </div>

      <Card className="mt">
        <CardHead title="The funnel, channel by channel" sub="Rates need enough sessions to read; thin channels are shown but not ranked" />
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Channel</th><th className="num">Sessions</th><th className="num">Product views</th><th className="num">Add to cart</th>
                <th className="num">Checkout</th><th className="num">Orders</th><th className="num">ATC rate</th><th className="num">Checkout rate</th><th className="num">Purchase CVR</th>
              </tr>
            </thead>
            <tbody>
              {ch.rows.map((r) => (
                <tr key={r.source} className={`clickable ${r.source === source ? 'selected' : ''}`} onClick={() => setPicked(r.source)}>
                  <td>{r.label}</td>
                  <td className="num">{compact(r.sessions)}</td>
                  <td className="num">{compact(r.views)}</td>
                  <td className="num">{compact(r.atc)}</td>
                  <td className="num">{compact(r.chk)}</td>
                  <td className="num">{compact(r.orders)}</td>
                  {r.readable ? (
                    <>
                      <td className="num">{pct(r.atcRate)}</td>
                      <td className="num">{pct(r.checkoutRate)}</td>
                      <td className="num">
                        {pct(r.purchaseCvr, 2)}
                        {r.source === ch.worst && <> <Badge tone="crit">Worst</Badge></>}
                        {r.source === ch.best && <> <Badge tone="good">Best</Badge></>}
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className="small muted right">too few sessions to read</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ch.rows.length && <Empty>No GA4 sessions in this range.</Empty>}
      </Card>

      <div className="grid g2 mt">
        <Card>
          <CardHead
            title={source ? `Where ${SOURCE_LABEL[source]} loses people` : 'Where a channel loses people'}
            sub="Benchmark = other channels' summed numerator ÷ summed denominator"
          />
          {ch.rows.length > 1 && (
            <div className="mt-s" style={{ overflowX: 'auto', marginBottom: 10 }}>
              <Seg<TrafficSource>
                small label="Channel" value={source ?? ch.rows[0].source} onChange={setPicked}
                options={ch.rows.map((r) => ({ id: r.source, label: r.source === ch.worst ? `${r.label} (worst)` : r.label }))}
              />
            </div>
          )}
          {source && diag.length ? (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr><th>Stage</th><th className="num">{SOURCE_LABEL[source]}</th><th className="num">Others</th><th className="num">Gap</th><th className="num">Orders at that rate</th></tr>
                </thead>
                <tbody>
                  {diag.map((s) => (
                    <tr key={s.key}>
                      <td>{s.label}</td>
                      <td className="num">{pct(s.mine)}</td>
                      <td className="num">{pct(s.bench)}</td>
                      <td className={`num ${(s.gap ?? 0) < 0 ? 'neg' : ''}`}>{pts(s.gap)}</td>
                      <td className="num">{s.extraOrders > 0 ? `+${num(s.extraOrders)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Pick a channel with GA4 sessions in this range.</Empty>}
          {source && !ch.rows.find((r) => r.source === source)?.readable && (
            <div className="mt-s"><Note>{SOURCE_LABEL[source]} has too few sessions in this range for its rates to be reliable; read the gaps as directional.</Note></div>
          )}
          <p className="small muted mt-s">Orders at that rate = extra orders if only this stage matched the benchmark, everything downstream unchanged.</p>
        </Card>

        <Card>
          <CardHead title="Custom reports" sub="A curated builder, not free SQL: combinations that can't be joined honestly are refused by name" />
          <div className="row">
            <span className="small muted">Rows:</span>
            {REPORT_DIMS.map((d) => (
              <button key={d.id} type="button" className="chip" aria-pressed={dim === d.id} style={dim === d.id ? ON : OFF} onClick={() => setDim(d.id)}>{d.label}</button>
            ))}
          </div>
          <div className="row mt-s">
            <span className="small muted">Metrics:</span>
            {REPORT_METRICS.map((m) => {
              const on = metrics.includes(m.id);
              return <button key={m.id} type="button" className="chip" aria-pressed={on} style={on ? ON : OFF} onClick={() => toggleMetric(m.id)}>{on ? '✓ ' : ''}{m.label}</button>;
            })}
          </div>
          {refusal !== null && <div className="mt-s"><Note>{refusal}</Note></div>}
          <div className="row mt-s">
            <button className="btn primary" disabled={refusal !== null} onClick={() => run(dim, metrics)}>Run report</button>
            <button className="btn" disabled={refusal !== null} onClick={saveReport}>Save</button>
          </div>
          {saved.length > 0 && (
            <div className="row mt-s">
              <span className="small muted">Saved:</span>
              {saved.map((s) => (
                <span key={s.name} className="chip">
                  <button type="button" className="btn ghost" style={{ padding: 0, fontSize: 'inherit' }} onClick={() => { setDim(s.dim); setMetrics(s.metrics); run(s.dim, s.metrics); }}>{s.name}</button>
                  <button type="button" className="btn ghost" style={{ padding: 0, fontSize: 'inherit' }} aria-label={`Remove ${s.name}`} onClick={() => persist(saved.filter((x) => x.name !== s.name))}>✕</button>
                </span>
              ))}
            </div>
          )}
          {ran && report && (
            <div className="table-wrap mt">
              <table className="t">
                <thead>
                  <tr>
                    <th>{REPORT_DIMS.find((d) => d.id === ran.dim)?.label}</th>
                    {ran.metrics.map((m) => <th key={m} className="num">{REPORT_METRICS.find((x) => x.id === m)?.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {report.map((r) => (
                    <tr key={r.key}>
                      <td>{r.key}</td>
                      {ran.metrics.map((m) => <td key={m} className="num">{compact(r[m])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.length && <Empty>No rows in this range.</Empty>}
            </div>
          )}
          {ran && <p className="small muted mt-s">GA4 metrics through {dayLabel(engine.cal, ch.range.end)}{ran.dim === 'week' ? ' · W1 starts on the first day of the range' : ''}.</p>}
        </Card>
      </div>

      <BuiltFrom sources={['ga4', 'checkout_events', 'shopify']} />
    </>
  );
}
