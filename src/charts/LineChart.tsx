/**
 * Single-axis line chart with crosshair + tooltip. Thin 2px lines, hairline
 * solid grid, legend for ≥2 series, end-dot on the current series.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export interface Series {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** De-emphasised comparison series (thinner, behind). */
  muted?: boolean;
  area?: boolean;
}

function niceTicks(max: number, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export function LineChart({ series, labels, height = 220, format, minY0 = true, ariaLabel }: {
  series: Series[];
  labels: string[];
  height?: number;
  format: (v: number) => string;
  minY0?: boolean;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = labels.length;
  const pad = { l: 52, r: 14, t: 10, b: 24 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const maxV = Math.max(...all, 0);
  const minV = minY0 ? 0 : Math.min(...all);
  const ticks = useMemo(() => niceTicks(maxV - minV), [maxV, minV]);
  const top = minV + ticks[ticks.length - 1];
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - minV) / (top - minV || 1)) * ih;

  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round((px / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const primary = series.find((s) => !s.muted) ?? series[0];
  const lastIdx = primary ? primary.values.map((v, i) => (v !== null && Number.isFinite(v) ? i : -1)).filter((i) => i >= 0).pop() : undefined;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={y(minV + t)} y2={y(minV + t)} />
            <text className="axis-text" x={pad.l - 8} y={y(minV + t) + 3.5} textAnchor="end">{format(minV + t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % labelEvery === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= labelEvery * 0.6) ? (
          <text key={i} className="axis-text" x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{l}</text>
        ) : null)}
        {series.filter((s) => s.area).map((s) => {
          const d = path(s.values);
          if (!d) return null;
          const firstI = s.values.findIndex((v) => v !== null);
          const lastI = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v !== null);
          return (
            <g key={`a-${s.id}-${labels.length}-${labels[0]}`} className="area-in">
              <defs>
                <linearGradient id={`grad-${s.id}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor={s.color} stopOpacity="0.32" />
                  <stop offset="1" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`${d}L${x(lastI)},${y(minV)}L${x(firstI)},${y(minV)}Z`} fill={`url(#grad-${s.id})`} />
            </g>
          );
        })}
        {[...series].sort((a, b) => Number(!!b.muted) - Number(!!a.muted)).map((s) => (
          <path key={`${s.id}-${labels.length}-${labels[0]}`} className="draw" pathLength={1} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.muted ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" style={s.muted ? undefined : { filter: `drop-shadow(0 0 6px ${s.color})` }} />
        ))}
        {primary && lastIdx !== undefined && hover === null && (
          <circle cx={x(lastIdx)} cy={y(primary.values[lastIdx]!)} r={4} fill={primary.color} stroke="var(--surface)" strokeWidth={2} />
        )}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--hair-strong)" />
            {series.map((s) => {
              const v = s.values[hover];
              return v !== null && Number.isFinite(v) ? <circle key={s.id} cx={x(hover)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null;
            })}
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: Math.min(x(hover) + 12, width - 170), top: 8 }}>
          <div className="strong" style={{ marginBottom: 4 }}>{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.id} className="row" style={{ gap: 6, justifyContent: 'space-between' }}>
              <span className="legend"><span className="key"><span className="swatch-line" style={{ background: s.color }} />{s.label}</span></span>
              <span className="num strong">{s.values[hover] === null || !Number.isFinite(s.values[hover]!) ? '—' : format(s.values[hover]!)}</span>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="legend" style={{ marginTop: 6 }}>
          {series.map((s) => (
            <span key={s.id} className="key"><span className="swatch-line" style={{ background: s.color, height: s.muted ? 1.5 : 2 }} />{s.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sequential cell colour (one hue, light → dark) with a legible label colour. */
export function heatStyle(v: number | null, max: number): { background: string; color: string } {
  if (v === null || !Number.isFinite(v)) return { background: 'transparent', color: 'var(--ink-3)' };
  const k = Math.max(0, Math.min(6, Math.round((v / (max || 1)) * 6)));
  return { background: `var(--seq-${k})`, color: k >= 4 ? 'var(--heat-ink-strong)' : 'var(--ink)' };
}
