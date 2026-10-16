import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CONNECTOR_BY_ID } from '../connectors/registry';
import { delta as deltaOf, pct } from '../metrics/format';
import { useApp } from '../state/app';

export function Card({ children, className = '', onClick, title }: { children: ReactNode; className?: string; onClick?: () => void; title?: string }) {
  return (
    <section className={`card ${className}`} onClick={onClick} title={title}>
      {children}
    </section>
  );
}

export function CardHead({ title, sub, tools }: { title: ReactNode; sub?: ReactNode; tools?: ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <h2>{title}</h2>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {tools && <div className="tools">{tools}</div>}
    </div>
  );
}

export type Tone = 'good' | 'warn' | 'crit' | 'info' | 'neutral' | 'ink' | 'outline';

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

/** Source label on a card; opens the metric definition. */
export function SourceChip({ label, metric }: { label: string; metric?: string }) {
  const { openMetric } = useApp();
  return (
    <button
      type="button"
      className="source-chip"
      title={metric ? 'Open metric definition' : undefined}
      onClick={(e) => { e.stopPropagation(); if (metric) openMetric(metric); }}
    >
      {label}
    </button>
  );
}

/** Signed change with colour = direction × whether up is good. */
export function Delta({ cur, prev, upIsGood = true, suffix = 'vs prev' }: { cur: number | null | undefined; prev: number | null | undefined; upIsGood?: boolean; suffix?: string }) {
  const d = deltaOf(cur, prev);
  if (d === null) return <span className="stat-foot">— {suffix}</span>;
  const up = d > 0;
  const cls = Math.abs(d) < 0.005 ? '' : up ? (upIsGood ? 'up-good' : 'up-bad') : upIsGood ? 'down-bad' : 'down-good';
  return (
    <span className="stat-foot">
      <span className={`delta ${cls}`}>{up ? '▲' : '▼'} {pct(Math.abs(d), 1)}</span> {suffix}
    </span>
  );
}

export function Stat({ label, value, foot, source, metric, big, onClick, valueClass = '' }: {
  label: ReactNode; value: ReactNode; foot?: ReactNode; source?: string; metric?: string; big?: boolean; onClick?: () => void; valueClass?: string;
}) {
  const { openMetric } = useApp();
  const click = onClick ?? (metric ? () => openMetric(metric) : undefined);
  return (
    <Card className={`stat ${click ? 'clickable' : ''}`} onClick={click}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {source && <SourceChip label={source} metric={metric} />}
      </div>
      <div className={`stat-value ${big ? 'big' : ''} ${valueClass}`}>{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </Card>
  );
}

export function Seg<T extends string>({ options, value, onChange, small, label }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; small?: boolean; label: string }) {
  return (
    <div className={`seg ${small ? 'small' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Drawer({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <h2 style={{ fontSize: 15 }}>{title}</h2>
          <div className="spacer" />
          {actions}
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Modal({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </>
  );
}

export function useEscape(fn: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') fn(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fn]);
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function BuiltFrom({ sources }: { sources: string[] }) {
  const { navigate } = useApp();
  return (
    <div className="built-from">
      Built from:{' '}
      {sources.map((s, i) => {
        const def = CONNECTOR_BY_ID[s];
        return (
          <span key={s}>
            {i > 0 && ' · '}
            {def ? <a href="#/connectors" onClick={(e) => { e.preventDefault(); navigate('connectors', s); }}>{def.name}</a> : s}
          </span>
        );
      })}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="note">{children}</div>;
}

export function Meter({ value, max = 1, width = 140 }: { value: number; max?: number; width?: number }) {
  const w = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className="bar-track" style={{ width }} role="img" aria-label={pct(w)}>
      <div className="bar-fill" style={{ width: `${w * 100}%` }} />
    </div>
  );
}

/** Sortable table state: `getters` maps a column id to its sort value. */
export function useSort<T>(rows: T[], getters: Record<string, (r: T) => number | string | null>, initial: { id: string; dir: 'asc' | 'desc' } | null = null) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    if (!sort || !getters[sort.id]) return rows;
    const get = getters[sort.id];
    return [...rows].sort((a, b) => {
      const va = get(a) ?? -Infinity, vb = get(b) ?? -Infinity;
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.dir === 'asc' ? c : -c;
    });
    // getters are recreated each render; the sort id is the stable dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const header = (label: ReactNode, id: string) => {
    const active = sort?.id === id;
    return (
      <button
        className="sort"
        aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
        onClick={() => setSort((s) => ({ id, dir: s?.id === id && s.dir === 'desc' ? 'asc' : 'desc' }))}
      >
        {label}{active ? (sort!.dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    );
  };
  return { sorted, header };
}

export const VERDICT_TONE: Record<string, Tone> = {
  SCALE: 'good', HOLD: 'warn', FIX: 'crit', STOP: 'ink', BRAND: 'info',
  KEEP: 'good', WATCH: 'warn', RESTOCK: 'crit', PROMOTE: 'good', 'CLEAR / BUNDLE': 'warn', KILL: 'ink', 'NO FEED': 'neutral', OK: 'good',
  'SELLS OFF-PDP': 'info', 'WEAK PDP': 'crit',
};

export function exportCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((c) => {
    const s = c === null || c === undefined ? '' : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
