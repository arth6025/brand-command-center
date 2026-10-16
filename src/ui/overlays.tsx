import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ask, SUGGESTED } from '../ask/answer';
import { CONNECTOR_BY_ID } from '../connectors/registry';
import { METRIC_BY_ID, METRICS } from '../metrics/registry';
import { dayLabel } from '../metrics/range';
import { NAV } from '../nav';
import { type RouteId, useApp } from '../state/app';
import { Drawer, Modal } from './kit';

export function MetricDrawer() {
  const { metricId, openMetric, navigate } = useApp();
  const close = useCallback(() => openMetric(null), [openMetric]);
  if (!metricId) return null;
  const m = METRIC_BY_ID[metricId];
  if (!m) return null;
  return (
    <Drawer title={`Metric definition · ${m.name}`} onClose={close}>
      <table className="def-table">
        <tbody>
          <tr><td>Formula</td><td>{m.formula}</td></tr>
          <tr><td>Sources</td><td>{m.sources.map((s, i) => (
            <span key={s}>{i > 0 && ' · '}{CONNECTOR_BY_ID[s] ? <a href="#/connectors" onClick={(e) => { e.preventDefault(); close(); navigate('connectors', s); }}>{CONNECTOR_BY_ID[s].name}</a> : s}</span>
          ))}</td></tr>
          <tr><td>Timezone</td><td>{m.timezone}</td></tr>
          <tr><td>Caveats</td><td>{m.caveats}</td></tr>
          <tr><td>Change log</td><td>{m.changelog.length ? m.changelog.map((c) => <div key={c.date}>{c.date}: {c.note}</div>) : <span className="muted">No changes since registration</span>}</td></tr>
        </tbody>
      </table>
      <p className="small muted mt">Every number on screen has one registered definition. The Ask assistant cites these and answers only from computed numbers.</p>
      <button className="btn mt-s" onClick={() => { close(); navigate('health', 'registry'); }}>Open metric registry</button>
    </Drawer>
  );
}

export function AskDrawer() {
  const { askOpen, setAskOpen, askSeed, engine, range } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ q: string; answer: string; sources: string[]; via: string } | null>(null);
  const close = useCallback(() => setAskOpen(false), [setAskOpen]);

  const run = useCallback(async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    const r = await ask(question, engine, range);
    setResult({ q: question, ...r });
    setBusy(false);
  }, [engine, range]);

  useEffect(() => {
    if (askOpen && askSeed) { setQ(askSeed); void run(askSeed); }
  }, [askOpen, askSeed, run]);

  if (!askOpen) return null;
  return (
    <Drawer title="✦ Ask" onClose={close}>
      <p className="small muted" style={{ marginTop: 0 }}>Grounded in this range's computed numbers and the evidence library. Never free SQL, never estimates.</p>
      <form onSubmit={(e) => { e.preventDefault(); void run(q); }} className="row">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why did MER fall this week?" style={{ flex: 1 }} autoFocus aria-label="Question" />
        <button className="btn primary" disabled={busy}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>
      <div className="suggestions">
        {SUGGESTED.map((s) => <button key={s} className="chip" type="button" onClick={() => { setQ(s); void run(s); }}>{s}</button>)}
      </div>
      {result && (
        <div className="ask-answer">
          <div className="small muted" style={{ marginBottom: 4 }}>{result.q}</div>
          {result.answer}
          <div className="cite">
            {result.sources.length > 0 && <>Sources: {result.sources.join(', ')} · </>}
            {result.via === 'claude' ? 'Answered by Claude from computed numbers' : 'Answered locally from computed numbers (Claude proxy not running)'}
          </div>
        </div>
      )}
    </Drawer>
  );
}

interface PaletteItem { label: string; kind: string; run: () => void }

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, navigate, engine, openMetric, ask: askQ } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setPaletteOpen(false); setQ(''); setSel(0); }, [setPaletteOpen]);

  const items = useMemo<PaletteItem[]>(() => {
    const go = (r: RouteId, p: string | null = null) => () => { navigate(r, p); close(); };
    const all: PaletteItem[] = [
      ...NAV.flatMap((g) => g.items.map((i) => ({ label: i.label, kind: 'Screen', run: go(i.id) }))),
      ...engine.w.campaigns.map((c) => ({ label: c.name, kind: `Campaign · ${c.platform}`, run: go('campaigns', c.id) })),
      ...engine.w.products.map((p) => ({ label: `${p.name} · ${p.size}`, kind: `Product · ${p.sku}`, run: go('inventory', p.id) })),
      ...METRICS.map((m) => ({ label: m.name, kind: 'Metric definition', run: () => { openMetric(m.id); close(); } })),
      ...Object.values(CONNECTOR_BY_ID).map((c) => ({ label: c.name, kind: 'Connector', run: go('connectors', c.id) })),
    ];
    const term = q.trim().toLowerCase();
    // Order numbers jump straight to the order
    const asNum = Number(term.replace('#', ''));
    const orderHits: PaletteItem[] = [];
    if (asNum > 100000) {
      const o = engine.w.orders.find((x) => x.id === asNum);
      if (o) orderHits.push({ label: `Order #${o.id} · ${dayLabel(engine.cal, o.day)} · ₹${Math.round(o.gross)} · ${o.status.replace('_', ' ')} · ${o.city}`, kind: 'Order', run: go('fulfilment', String(o.id)) });
    }
    const filtered = term ? all.filter((i) => `${i.label} ${i.kind}`.toLowerCase().includes(term)) : all.slice(0, 18);
    const askItem: PaletteItem[] = term.length > 3 ? [{ label: `Ask: “${q.trim()}”`, kind: 'Ask', run: () => { close(); askQ(q.trim()); } }] : [];
    return [...orderHits, ...filtered.slice(0, 30), ...askItem];
  }, [q, engine, navigate, close, openMetric, askQ]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!paletteOpen) return null;
  return (
    <Modal onClose={close} label="Search">
      <input
        className="palette-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} type="text"
        placeholder="Search screens, campaigns, products, metrics, order # …"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === 'Enter') items[sel]?.run();
        }}
        aria-label="Search"
      />
      <div className="palette-list" ref={listRef} role="listbox">
        {items.length === 0 && <div className="empty">No matches</div>}
        {items.map((it, i) => (
          <button key={`${it.kind}-${it.label}`} className="palette-item" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={it.run}>
            <span>{it.label}</span><span className="kind">{it.kind}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function CustomRange({ onClose }: { onClose: () => void }) {
  const { engine, setPreset, range } = useApp();
  const toIso = (d: number) => new Date(engine.cal.day0Utc + d * 86400000).toISOString().slice(0, 10);
  const fromIso = (s: string) => Math.round((Date.parse(`${s}T00:00:00Z`) - engine.cal.day0Utc) / 86400000);
  const [from, setFrom] = useState(toIso(range.start));
  const [to, setTo] = useState(toIso(range.end));
  const min = toIso(0), max = toIso(engine.cal.today);
  const valid = fromIso(from) <= fromIso(to);
  return (
    <Modal onClose={onClose} label="Custom range">
      <div style={{ padding: 18 }}>
        <h2>Custom range</h2>
        <p className="small muted">Data is available from {dayLabel(engine.cal, 0, true)} to today. Comparisons use the preceding window of equal length.</p>
        <div className="row mt-s">
          <label className="small">From <input type="date" value={from} min={min} max={max} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="small">To <input type="date" value={to} min={min} max={max} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {!valid && <p className="small neg">Start must be on or before end.</p>}
        <div className="row mt">
          <button className="btn primary" disabled={!valid} onClick={() => { setPreset('custom', { start: fromIso(from), end: fromIso(to) }); onClose(); }}>Apply</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
