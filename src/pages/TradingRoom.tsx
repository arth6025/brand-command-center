import { useMemo, useRef, useState } from 'react';
import { inr, num, pct, safeDiv, xm } from '../metrics/format';
import { type Driver, type PlanRow, solve, type SolvedRow } from '../metrics/plan';
import { dateOf, daysInMonth, monthLabel, startOfMonth } from '../metrics/range';
import { useApp } from '../state/app';
import { load, save } from '../state/storage';
import { Badge, BuiltFrom, Card, CardHead, exportCsv, Modal, Note, PageHead, Seg, type Tone } from '../ui/kit';

type Status = 'draft' | 'locked';
interface PlanMeta { status: Status; version: number }
type Param = 'asp' | 'conv' | 'roas';

const DRIVERS = new Set<Driver>(['qty', 'sales', 'spend']);
const okNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Stored plans come from localStorage: anything malformed falls back to the 90-day defaults. */
function loadRows(key: string, defaults: PlanRow[]): PlanRow[] {
  const raw = load<unknown>(`plan.${key}`, null);
  if (!Array.isArray(raw) || !raw.length) return defaults;
  const valid = raw.every((r) => !!r && typeof r === 'object' && typeof r.line === 'string'
    && okNum(r.asp) && okNum(r.conv) && okNum(r.roas) && okNum(r.value) && DRIVERS.has(r.driver));
  return valid ? (raw as PlanRow[]).map((r) => ({ ...r, touched: r.touched && typeof r.touched === 'object' ? r.touched : {} })) : defaults;
}

function loadMeta(key: string): PlanMeta {
  const m = load<Partial<PlanMeta> | null>(`plan.${key}.status`, null);
  return {
    status: m?.status === 'locked' ? 'locked' : 'draft',
    version: typeof m?.version === 'number' && m.version >= 1 ? Math.floor(m.version) : 1,
  };
}

/**
 * Number input that accepts free typing and commits on blur / Enter. Rejects
 * NaN and negatives (and zero where the value divides) and keeps the old value.
 */
function NumCell({ value, scale = 1, digits = 0, positive = false, label, onCommit }: {
  value: number; scale?: number; digits?: number; positive?: boolean; label: string; onCommit: (v: number) => void;
}) {
  const { notify } = useApp();
  const [text, setText] = useState<string | null>(null);
  const cancel = useRef(false);
  const p = 10 ** digits;
  const commit = () => {
    if (text === null) return;
    setText(null);
    if (cancel.current) { cancel.current = false; return; }
    const n = Number(text.replace(/[,\s₹%×]/g, ''));
    if (text.trim() === '' || !Number.isFinite(n) || n < 0 || (positive && n === 0)) {
      notify(`${label}: enter a number ${positive ? 'above 0' : '≥ 0'} · kept ${num(value * scale, digits)}`);
      return;
    }
    if (Math.abs(n - value * scale) > 1e-9) onCommit(n / scale);
  };
  return (
    <input
      type="text" inputMode="decimal" aria-label={label}
      value={text ?? num(value * scale, digits)}
      onFocus={(e) => { setText(String(Math.round(value * scale * p) / p)); const el = e.currentTarget; requestAnimationFrame(() => el.select()); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur(); }
      }}
    />
  );
}

function paceBadge(pace: number | null, alert: number): { tone: Tone; text: string } {
  if (pace === null) return { tone: 'neutral', text: 'No target' };
  if (pace >= 1) return { tone: 'good', text: 'On pace' };
  if (alert > 0) return { tone: 'crit', text: `${pace.toFixed(1)}× · ${alert} days` };
  if (pace < 0.95) return { tone: 'warn', text: 'Watch' };
  return { tone: 'neutral', text: 'Near pace' };
}

/**
 * Trading Room: the monthly plan per product line. One of quantity / sales /
 * spend is the driver (yellow, locked); the other two solve from ASP, conversion
 * and target ROAS. Lock a version, then track plan vs actual by week.
 */
export default function TradingRoom() {
  const { engine, notify } = useApp();
  const cal = engine.cal;
  const defaults = engine.plan.defaults();

  const months = useMemo(() => {
    const som = startOfMonth(cal, cal.today);
    const next = som + daysInMonth(cal, cal.today);
    const keyOf = (d: number) => { const dt = dateOf(cal, d); return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`; };
    return [{ id: keyOf(som), label: monthLabel(cal, som), current: true }, { id: keyOf(next), label: monthLabel(cal, next), current: false }];
  }, [cal]);

  const [monthKey, setMonthKey] = useState(months[0].id);
  const [rows, setRows] = useState<PlanRow[]>(() => loadRows(months[0].id, defaults));
  const [meta, setMeta] = useState<PlanMeta>(() => loadMeta(months[0].id));
  const [dirty, setDirty] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const month = months.find((m) => m.id === monthKey) ?? months[0];
  const locked = meta.status === 'locked';
  const solved = useMemo(() => rows.map(solve), [rows]);
  const board = useMemo(() => (month.current ? engine.plan.board(solved) : []), [engine, month.current, solved]);

  const totals = solved.reduce((a, r) => ({ qty: a.qty + r.qty, sales: a.sales + r.sales, views: a.views + r.views, spend: a.spend + r.spend }), { qty: 0, sales: 0, views: 0, spend: 0 });
  const boardTotal = board.reduce((a, b) => ({
    target: a.target + b.target, mtd: a.mtd + b.mtd, eom: a.eom + b.eom,
    weeks: a.weeks.map((w, i) => (b.weeks[i] === null ? null : (w ?? 0) + (b.weeks[i] ?? 0))),
  }), { target: 0, mtd: 0, eom: 0, weeks: [0, 0, 0, 0, 0] as (number | null)[] });

  const switchMonth = (key: string) => {
    if (key === monthKey) return;
    if (dirty && !window.confirm(`Discard unsaved changes to the ${month.label} plan?`)) return;
    setMonthKey(key);
    setRows(loadRows(key, defaults));
    setMeta(loadMeta(key));
    setDirty(false);
  };

  const edit = (i: number, fn: (r: PlanRow) => PlanRow) => {
    if (locked) return;
    setRows((xs) => xs.map((r, j) => (j === i ? fn(r) : r)));
    setDirty(true);
  };
  const setDriver = (i: number, driver: Driver, value: number) => edit(i, (r) => ({ ...r, driver, value }));
  const setParam = (i: number, k: Param, v: number) => edit(i, (r) => ({ ...r, [k]: v, touched: { ...r.touched, [k]: true } }));

  const saveDraft = () => { save(`plan.${monthKey}`, rows); save(`plan.${monthKey}.status`, meta); setDirty(false); notify(`Saved ${month.label} draft v${meta.version}`); };
  const lock = () => {
    const m: PlanMeta = { status: 'locked', version: meta.version };
    save(`plan.${monthKey}`, rows); save(`plan.${monthKey}.status`, m);
    setMeta(m); setDirty(false); notify(`Locked ${month.label} plan v${m.version}`);
  };
  const unlock = () => {
    const m: PlanMeta = { status: 'draft', version: meta.version + 1 };
    save(`plan.${monthKey}.status`, m);
    setMeta(m); notify(`Editing draft v${m.version} · v${meta.version} stays as locked`);
  };
  const reset = () => { if (locked) return; setRows(defaults); setDirty(true); notify('Reset to trailing-90-day defaults (not saved yet)'); };

  const exportPlan = () => exportCsv(`plan-${monthKey}-v${meta.version}-${meta.status}.csv`, [
    ['Product line', 'Driver', 'Target qty', 'ASP ₹', 'Conv %', 'Target ROAS', 'Target sales ₹', 'Product views', 'Target spend ₹'],
    ...solved.map((r) => [r.line, r.driver, Math.round(r.qty), Math.round(r.asp), (r.conv * 100).toFixed(2), r.roas.toFixed(2), Math.round(r.sales), Math.round(r.views), Math.round(r.spend)]),
    ['Total', '', Math.round(totals.qty), '', '', '', Math.round(totals.sales), Math.round(totals.views), Math.round(totals.spend)],
  ]);

  const driverCell = (r: SolvedRow, i: number, d: Driver, label: string) => {
    const isDriver = r.driver === d;
    const v = d === 'qty' ? r.qty : d === 'sales' ? r.sales : r.spend;
    return (
      <td className={`num ${isDriver ? 'input' : 'solved'}`}>
        <div className="row" style={{ gap: 2, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
          {locked ? <span>{d === 'qty' ? num(v) : inr(v)}</span> : <NumCell label={`${r.line} ${label}`} value={v} onCommit={(n) => setDriver(i, d, n)} />}
          {isDriver && <span className="lock" title="Driver: the value you set" aria-label="driver">🔒</span>}
        </div>
      </td>
    );
  };
  const paramCell = (r: SolvedRow, i: number, k: Param, label: string, scale: number, digits: number) => (
    <td className={`num ${r.touched[k] ? 'input' : ''}`}>
      {locked
        ? (k === 'conv' ? pct(r.conv, 2) : k === 'roas' ? xm(r.roas) : inr(r.asp))
        : <NumCell label={`${r.line} ${label}`} value={r[k]} scale={scale} digits={digits} positive onCommit={(n) => setParam(i, k, n)} />}
    </td>
  );

  return (
    <>
      <PageHead
        title="Trading Room"
        sub={<>
          Month: {month.label} · {locked ? <Badge tone="ink">Locked v{meta.version}</Badge> : <Badge tone="warn">Draft v{meta.version}</Badge>}
          {dirty && <span className="warn-text"> · unsaved changes</span>}
          {' '}· sales = ASP × qty · product views = qty ÷ conversion · spend = sales ÷ target ROAS
        </>}
        actions={<Seg<string> label="Plan month" value={monthKey} onChange={switchMonth} options={months.map((m) => ({ id: m.id, label: m.label }))} />}
      />

      <Card>
        <CardHead
          title={`Plan — ${month.label}`}
          sub={locked ? `Locked v${meta.version}: read-only. Unlock to edit a new draft (v${meta.version + 1}).` : 'Edit target qty, sales or spend to make it the line\'s driver; the other two solve. Enter to commit, Esc to cancel.'}
          tools={<>
            <button className="btn" disabled={locked} onClick={reset}>Reset to defaults</button>
            <button className="btn" disabled={locked} onClick={() => setPasteOpen(true)}>Paste</button>
            <button className="btn" onClick={exportPlan}>Export CSV</button>
            <button className="btn" disabled={locked} onClick={saveDraft}>Save draft</button>
            {locked
              ? <button className="btn" onClick={unlock}>Unlock</button>
              : <button className="btn primary" onClick={lock}>Lock v{meta.version}</button>}
          </>}
        />
        <div className="table-wrap">
          <table className="t plan">
            <thead>
              <tr>
                <th>Product line</th><th className="num">Target qty</th><th className="num">ASP ₹</th><th className="num">Conv %</th><th className="num">Target ROAS</th>
                <th className="num">Target sales ₹</th><th className="num">Product views</th><th className="num">Target spend ₹</th>
              </tr>
            </thead>
            <tbody>
              {solved.map((r, i) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  {driverCell(r, i, 'qty', 'target qty')}
                  {paramCell(r, i, 'asp', 'ASP', 1, 0)}
                  {paramCell(r, i, 'conv', 'conversion %', 100, 2)}
                  {paramCell(r, i, 'roas', 'target ROAS', 1, 2)}
                  {driverCell(r, i, 'sales', 'target sales')}
                  <td className="num solved">{num(r.views)}</td>
                  {driverCell(r, i, 'spend', 'target spend')}
                </tr>
              ))}
              <tr className="total">
                <td>Total</td>
                <td className="num">{num(totals.qty)}</td>
                <td className="num muted">{inr(safeDiv(totals.sales, totals.qty))}</td>
                <td className="num muted">{pct(safeDiv(totals.qty, totals.views), 2)}</td>
                <td className="num muted">{xm(safeDiv(totals.sales, totals.spend))}</td>
                <td className="num">{inr(totals.sales)}</td>
                <td className="num">{num(totals.views)}</td>
                <td className="num">{inr(totals.spend)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="row mt-s small muted">
          <span className="chip" style={{ background: 'var(--input-cell)' }}>yellow</span> = input you set ·
          <span className="chip" style={{ background: 'var(--solved-cell)' }}>blue</span> = solved ·
          <span className="chip">unshaded</span> = default seeded from the trailing 90 days · 🔒 = the line's driver · total ASP, conversion and ROAS are blended
        </div>
      </Card>

      <Card className="mt">
        <CardHead title="Plan board — target / MTD / W1–W5 / EOM" sub="Pace alert when a line runs below 0.8× of plan for 3 days in a row · net revenue from Shopify, W1 = days 1–7" />
        {month.current ? (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Product line</th><th className="num">Target</th><th className="num">MTD</th>
                  {[1, 2, 3, 4, 5].map((w) => <th key={w} className="num">W{w}</th>)}
                  <th className="num">EOM forecast</th><th>Pace</th>
                </tr>
              </thead>
              <tbody>
                {board.map((b) => {
                  const pb = paceBadge(b.pace, b.alert);
                  return (
                    <tr key={b.line}>
                      <td>{b.line}</td>
                      <td className="num">{inr(b.target)}</td>
                      <td className="num">{inr(b.mtd)}</td>
                      {b.weeks.map((w, i) => <td key={i} className="num">{w === null ? '—' : inr(w)}</td>)}
                      <td className={`num ${b.eom < b.target * 0.95 ? 'neg' : ''}`}>{inr(b.eom)}</td>
                      <td><Badge tone={pb.tone} title={b.pace === null ? undefined : `Pace ${b.pace.toFixed(2)}× of plan`}>{pb.text}</Badge></td>
                    </tr>
                  );
                })}
                {board.length > 1 && (
                  <tr className="total">
                    <td>Total</td>
                    <td className="num">{inr(boardTotal.target)}</td>
                    <td className="num">{inr(boardTotal.mtd)}</td>
                    {boardTotal.weeks.map((w, i) => <td key={i} className="num">{w === null ? '—' : inr(w)}</td>)}
                    <td className="num">{inr(boardTotal.eom)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <Note>The plan board for {month.label} starts when the month starts. Until then, set and lock the plan above.</Note>
        )}
      </Card>

      {pasteOpen && (
        <PasteModal
          lines={rows.map((r) => r.line)}
          onClose={() => setPasteOpen(false)}
          onApply={(updates) => {
            setRows((xs) => xs.map((r) => (updates.has(r.line) ? { ...r, driver: 'qty', value: updates.get(r.line)! } : r)));
            setDirty(true);
            setPasteOpen(false);
            notify(`Updated target qty for ${updates.size} line${updates.size === 1 ? '' : 's'} (not saved yet)`);
          }}
        />
      )}

      <BuiltFrom sources={['shopify', 'meta', 'google_ads']} />
    </>
  );
}

/** Paste "line,qty" rows (CSV or tab-separated, e.g. from a spreadsheet). */
function PasteModal({ lines, onClose, onApply }: { lines: string[]; onClose: () => void; onApply: (u: Map<string, number>) => void }) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => {
    const byName = new Map(lines.map((l) => [l.trim().toLowerCase(), l]));
    const updates = new Map<string, number>();
    const problems: string[] = [];
    text.split(/\r?\n/).forEach((raw, i) => {
      const s = raw.trim();
      if (!s) return;
      const cut = s.includes('\t') ? s.indexOf('\t') : s.indexOf(',');
      if (cut < 0) { problems.push(`Row ${i + 1}: expected "line,qty"`); return; }
      const name = s.slice(0, cut).trim().replace(/^"|"$/g, '');
      const qtyText = s.slice(cut + 1).replace(/[",\s]/g, '');
      const qty = Number(qtyText);
      const line = byName.get(name.toLowerCase());
      if (!line) { if (i > 0 || qtyText === '' || Number.isFinite(qty)) problems.push(`Row ${i + 1}: unknown line "${name}"`); return; }
      if (qtyText === '' || !Number.isFinite(qty) || qty < 0) { problems.push(`Row ${i + 1}: "${s.slice(cut + 1).trim()}" is not a quantity ≥ 0`); return; }
      updates.set(line, qty);
    });
    return { updates, problems };
  }, [text, lines]);

  return (
    <Modal onClose={onClose} label="Paste target quantities">
      <div style={{ padding: 18, overflowY: 'auto' }}>
        <h2>Paste target quantities</h2>
        <p className="small muted">One line per row: <code>line,qty</code> (or two columns copied from a sheet). Each matched line's target qty becomes its driver. Lines: {lines.join(', ')}.</p>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={lines.slice(0, 2).map((l) => `${l},1200`).join('\n')} aria-label="Pasted rows" />
        {text.trim() && (
          <p className="small mt-s">
            {parsed.updates.size} line{parsed.updates.size === 1 ? '' : 's'} matched
            {parsed.problems.length > 0 && <span className="neg"> · {parsed.problems.length} skipped</span>}
          </p>
        )}
        {parsed.problems.length > 0 && (
          <ul className="small neg" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {parsed.problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <div className="row mt">
          <button className="btn primary" disabled={!parsed.updates.size} onClick={() => onApply(parsed.updates)}>Apply {parsed.updates.size || ''}</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
