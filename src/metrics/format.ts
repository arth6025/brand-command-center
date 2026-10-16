/** Indian-convention number formatting: lakh (L) and crore (Cr). */

export function inr(v: number | null | undefined, opts: { exact?: boolean; sign?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const neg = v < 0;
  const a = Math.abs(v);
  let s: string;
  if (opts.exact || a < 1e5) s = Math.round(a).toLocaleString('en-IN');
  else if (a < 1e7) s = `${trim(a / 1e5, a < 1e6 ? 2 : 1)}L`;
  else s = `${trim(a / 1e7, 2)}Cr`;
  const sign = neg ? '−' : opts.sign ? '+' : '';
  return `${sign}₹${s}`;
}

/** Compact INR for axes and dense tables. */
export function inrShort(v: number) {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7, 1)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5, 1)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3, 0)}K`;
  return `${sign}₹${Math.round(a)}`;
}

function trim(x: number, digits: number) {
  return x.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e7) return `${trim(v / 1e7, 2)}Cr`;
  if (a >= 1e5) return `${trim(v / 1e5, 1)}L`;
  if (a >= 1e4) return `${trim(v / 1e3, 1)}K`;
  return Math.round(v).toLocaleString('en-IN');
}

export function pct(v: number | null | undefined, digits = 1, sign = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = (v * 100).toFixed(digits);
  const pre = sign && v > 0 ? '+' : v < 0 ? '−' : '';
  return `${pre}${s.replace('-', '')}%`;
}

export function xm(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}×`;
}

export function pts(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = (v * 100).toFixed(digits);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s.replace('-', '')} pts`;
}

/** Relative change; null when the base is zero or missing. */
export function delta(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

export function safeDiv(a: number, b: number): number | null {
  return b === 0 || !Number.isFinite(b) ? null : a / b;
}

export function ago(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
