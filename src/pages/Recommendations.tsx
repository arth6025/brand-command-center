import { useEffect, useMemo, useState } from 'react';
import type { Experiment } from '../domain/types';
import { inr, pct } from '../metrics/format';
import { dayLabel, describeRange } from '../metrics/range';
import type { Recommendation, RecType } from '../metrics/recommendations';
import { type Decision, useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Empty, Note, PageHead, Seg, exportCsv, type Tone } from '../ui/kit';

const TYPE_TONE: Record<RecType, Tone> = { SPEND: 'crit', SETUP: 'warn', CREATIVE: 'info', MEASUREMENT: 'neutral', STOCK: 'crit' };
const TYPES: { id: RecType | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' }, { id: 'SPEND', label: 'Spend' }, { id: 'SETUP', label: 'Setup' },
  { id: 'CREATIVE', label: 'Creative' }, { id: 'MEASUREMENT', label: 'Measurement' }, { id: 'STOCK', label: 'Stock' },
];
type StateFilter = 'all' | 'open' | 'decided';

const dateText = (at: number) => new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Evidence status: a test is readable only once it has spent its pre-declared minimum. */
function evidenceOf(x: Experiment): { label: string; tone: Tone } {
  if (x.status === 'concluded') return { label: 'Concluded', tone: 'info' };
  if (x.spentSoFar < x.minSpend) return { label: 'Too early', tone: 'warn' };
  return { label: 'Readable', tone: 'good' };
}

export default function Recommendations() {
  const { engine, range, param, decisions, decide, undoDecision, notify } = useApp();
  const recs = engine.recommendations(range);
  const [type, setType] = useState<RecType | 'ALL'>('ALL');
  const [state, setState] = useState<StateFilter>('all');
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [formFor, setFormFor] = useState<string | null>(null);
  const [owner, setOwner] = useState('');
  const [note, setNote] = useState('');

  const byRec = useMemo(() => new Map(decisions.map((d) => [d.recId, d])), [decisions]);

  // Deep link from a campaign drawer: #/recommendations/<recId> opens its form
  useEffect(() => {
    if (!param || !recs.some((r) => r.id === param) || byRec.has(param)) return;
    setFormFor(param);
    window.setTimeout(() => document.getElementById(`rec-${param}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    // only on arrival; later decisions should not reopen the form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  const countOf = (t: RecType | 'ALL') => recs.filter((r) => t === 'ALL' || r.type === t).length;
  // Open first, then decided; each group keeps the engine's at-stake order
  const shown = recs
    .filter((r) => type === 'ALL' || r.type === type)
    .filter((r) => state === 'all' || (state === 'open' ? !byRec.has(r.id) : byRec.has(r.id)))
    .sort((a, b) => Number(byRec.has(a.id)) - Number(byRec.has(b.id)));
  const openCount = recs.filter((r) => !byRec.has(r.id)).length;

  const toggleWorking = (id: string) => setWorking((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const startForm = (id: string) => { setFormFor(id); setOwner(''); setNote(''); };
  const save = (r: Recommendation) => {
    if (!owner.trim()) return;
    decide({ recId: r.id, action: 'recorded', owner: owner.trim(), note: note.trim(), at: Date.now() });
    setFormFor(null);
    notify(`Recorded for ${owner.trim()} to carry out · nothing was changed in the ad platform`);
  };
  const park = (r: Recommendation) => {
    decide({ recId: r.id, action: 'parked', owner: '', note: '', at: Date.now() });
    if (formFor === r.id) setFormFor(null);
    notify('Parked · it stays in the log and can be undone');
  };
  const undo = (id: string) => { undoDecision(id); notify('Decision removed · back to open'); };

  const exportLog = () => {
    const title = new Map(recs.map((r) => [r.id, r]));
    exportCsv('decisions-log.csv', [
      ['Recommendation', 'Type', 'At stake (current window)', 'Action', 'Owner', 'Note', 'Date'],
      ...[...decisions].sort((a, b) => b.at - a.at).map((d: Decision) => {
        const r = title.get(d.recId);
        return [r?.title ?? d.recId, r?.type ?? '', r ? Math.round(r.atStake) : '', d.action, d.owner, d.note, new Date(d.at).toISOString()];
      }),
    ]);
  };

  const exps = engine.w.experiments;
  const running = exps.filter((x) => x.status === 'running');

  return (
    <>
      <PageHead
        title="Recommendations"
        sub={`${describeRange(engine.cal, range)} · ${openCount} open · ${decisions.length} in the decisions log`}
        actions={<button className="btn" onClick={exportLog} disabled={!decisions.length}>Export decisions log</button>}
      />
      <Note>Nothing here has been changed. Recording an action is a sign-off for a person to carry out in Meta or Google; the system never moves spend.</Note>

      <div className="grid split-7-5 mt">
        <div className="stack">
          <div className="row">
            {TYPES.map((t) => (
              <button key={t.id} type="button" className="chip" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                {t.label} <span className="muted">{countOf(t.id)}</span>
              </button>
            ))}
            <div className="spacer" />
            <Seg<StateFilter> small label="Decision state" value={state} onChange={setState} options={[{ id: 'all', label: 'All' }, { id: 'open', label: 'Open' }, { id: 'decided', label: 'Decided' }]} />
          </div>

          {shown.length === 0 && <Card><Empty>Nothing matches these filters.</Empty></Card>}
          {shown.map((r) => {
            const d = byRec.get(r.id);
            return (
              <Card key={r.id} className={`rec ${d ? 'decided' : ''}`}>
                <div id={`rec-${r.id}`} className="meta">
                  <Badge tone={TYPE_TONE[r.type]}>{r.type}</Badge>
                  <span>{inr(r.atStake)} at stake</span>
                  {d && <Badge tone={d.action === 'recorded' ? 'good' : 'neutral'}>{d.action}</Badge>}
                </div>
                <div className="title">{r.title}</div>
                <div className="body">{r.body}</div>
                <div className="small"><strong>Suggested:</strong> {r.suggested}</div>

                {d ? (
                  <div className="row small soft">
                    <span>
                      {d.action === 'recorded' ? `Recorded for ${d.owner}` : 'Parked'} on {dateText(d.at)}
                      {d.note && <> · “{d.note}”</>}
                    </span>
                    <button className="btn ghost" onClick={() => undo(r.id)}>Undo</button>
                    <button className="btn ghost" onClick={() => toggleWorking(r.id)} aria-expanded={working.has(r.id)}>{working.has(r.id) ? 'Hide working' : 'Show working'}</button>
                  </div>
                ) : formFor === r.id ? (
                  <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); save(r); }}>
                    <label className="small soft">Owner — who will carry this out in the ad platform
                      <input type="text" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Name" style={{ display: 'block', width: '100%', marginTop: 4 }} autoFocus />
                    </label>
                    <label className="small soft">Note
                      <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What exactly, and by when" style={{ marginTop: 4 }} />
                    </label>
                    <div className="row">
                      <button type="submit" className="btn primary" disabled={!owner.trim()}>Save</button>
                      <button type="button" className="btn" onClick={() => setFormFor(null)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="row">
                    <button className="btn primary" onClick={() => startForm(r.id)}>{r.primaryAction}</button>
                    <button className="btn" onClick={() => park(r)}>Park</button>
                    <button className="btn" onClick={() => toggleWorking(r.id)} aria-expanded={working.has(r.id)}>{working.has(r.id) ? 'Hide working' : 'Show working'}</button>
                  </div>
                )}

                {working.has(r.id) && (
                  <ul className="working" style={{ margin: 0, paddingLeft: 26 }}>
                    {r.working.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>

        <div className="stack">
          <Card>
            <CardHead title="Experiments — finding out now" sub="Each says whether there is enough evidence to read it yet" />
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Question</th><th className="num">Spent / min</th><th>Evidence</th></tr></thead>
                <tbody>
                  {exps.map((x) => {
                    const ev = evidenceOf(x);
                    return (
                      <tr key={x.id}>
                        <td>{x.question}{x.answer && <div className="tiny muted">{x.answer}</div>}</td>
                        <td className="num">{inr(x.spentSoFar)} / {inr(x.minSpend)}<div className="tiny muted">{pct(Math.min(1, x.spentSoFar / x.minSpend), 0)}</div></td>
                        <td><Badge tone={ev.tone}>{ev.label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHead title="What we now know" sub="Concluded tests become rules in the evidence library" />
            {engine.w.evidence.length === 0 ? <Empty>No concluded tests yet.</Empty> : (
              <ul className="small soft" style={{ margin: 0, paddingLeft: 18 }}>
                {engine.w.evidence.map((e, i) => <li key={i} style={{ margin: '3px 0' }}>{e}</li>)}
              </ul>
            )}
          </Card>

          <Card>
            <CardHead title="Kill / extend rules" sub="Each test carries a hypothesis, variant, minimum spend, read date and a kill rule set before launch" />
            {running.length === 0 ? <Empty>No experiments running.</Empty> : running.map((x, i) => (
              <div key={x.id} className="small" style={{ padding: '8px 0', borderTop: i ? '1px solid var(--hair)' : undefined }}>
                <div className="strong">{x.hypothesis}</div>
                <div className="soft">Variant: {x.variant}</div>
                <div className="soft">
                  Min spend {inr(x.minSpend)} · read {x.readDay < engine.cal.today ? 'due since' : 'on'} {dayLabel(engine.cal, x.readDay)}
                  {x.readDay < engine.cal.today && x.spentSoFar >= x.minSpend && <> · <Badge tone="good">Ready to read</Badge></>}
                </div>
                <div className="soft">Kill rule: {x.killRule}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <BuiltFrom sources={['meta', 'google_ads', 'snapchat', 'shopify', 'ga4', 'wms']} />
    </>
  );
}
