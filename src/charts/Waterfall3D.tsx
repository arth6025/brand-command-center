/**
 * Contribution waterfall drawn as extruded 3D slabs. Heights are to scale
 * (share of net revenue); the 3D is only depth and a cursor-driven turn, so
 * the vertical reading of every bar stays exact.
 */
import { useRef } from 'react';
import { inrShort } from '../metrics/format';

export interface WfStep {
  key: string;
  label: string;
  value: number;
  kind: 'total' | 'deduct';
}

export function Waterfall3D({ steps, base }: { steps: WfStep[]; base: number }) {
  const stage = useRef<HTMLDivElement>(null);
  let running = 0;
  const bars = steps.map((s) => {
    if (s.kind === 'total') {
      running = s.value;
      return { ...s, bottom: Math.min(0, s.value), top: Math.max(0, s.value) };
    }
    const top = running;
    running -= s.value;
    return { ...s, bottom: running, top };
  });
  const scale = (v: number) => (Math.max(0, v) / (base || 1)) * 100;

  const onMove = (e: React.PointerEvent) => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    el.style.setProperty('--ry', `${(-18 + px * 22).toFixed(1)}deg`);
  };

  return (
    <div
      ref={stage} className="wf-stage" onPointerMove={onMove} onPointerLeave={() => stage.current?.style.removeProperty('--ry')}
      role="img" aria-label={steps.map((s) => `${s.label} ${inrShort(s.value)}`).join(', ')}
    >
      <div className="wf-scene">
        {bars.map((b, i) => {
          const color = b.kind === 'total' ? (b.value < 0 ? 'var(--crit)' : i === 0 ? 'var(--accent)' : 'var(--accent-2)') : 'var(--crit)';
          const height = Math.max(0.8, scale(b.top) - scale(b.bottom));
          return (
            <div className="wf-col" key={b.key} title={`${b.label}: ${inrShort(b.value)}`}>
              <div className="wf-bar" style={{ bottom: `${scale(b.bottom)}%`, height: `${height}%`, ['--wf-c' as string]: color, animationDelay: `${i * 0.09}s` }}>
                <div className="face side" />
                <div className="face top" />
                <div className="face front" />
              </div>
              <div className="wf-val" style={{ bottom: `calc(${scale(b.top)}% + 8px)` }}>{b.kind === 'deduct' ? '−' : ''}{inrShort(Math.abs(b.value))}</div>
              <div className="wf-label">{b.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Semicircle gauge: fill to the actual MER, tick at break-even. */
export function MerGauge({ mer, breakEven }: { mer: number | null; breakEven: number | null }) {
  const max = Math.max((breakEven ?? 1) * 2, (mer ?? 0) * 1.15, 1);
  const frac = (v: number | null) => Math.max(0, Math.min(1, (v ?? 0) / max));
  const r = 80, cx = 100, cy = 96;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const angle = Math.PI * (1 - frac(breakEven));
  const tx = cx + Math.cos(angle) * r, ty = cy - Math.sin(angle) * r;
  const above = (mer ?? 0) >= (breakEven ?? Infinity);
  return (
    <svg className="gauge" viewBox="0 0 200 118" role="img" aria-label={`Blended MER ${mer?.toFixed(2)}× against break-even ${breakEven?.toFixed(2)}×`}>
      <defs>
        <linearGradient id="gaugeGrad" x1="0" x2="1">
          <stop offset="0" stopColor={above ? 'var(--accent)' : 'var(--crit)'} />
          <stop offset="1" stopColor={above ? 'var(--accent-2)' : 'var(--warn)'} />
        </linearGradient>
      </defs>
      <path className="track" d={arc} fill="none" strokeWidth="12" strokeLinecap="round" />
      <path className="fill" d={arc} fill="none" strokeWidth="12" strokeLinecap="round" pathLength={100} strokeDasharray={`${frac(mer) * 100} 100`} />
      <line className="tick" x1={tx} y1={ty} x2={cx + Math.cos(angle) * (r - 20)} y2={cy - Math.sin(angle) * (r - 20)} />
      <text x={cx + Math.cos(angle) * (r - 30)} y={cy - Math.sin(angle) * (r - 30) + 3} textAnchor="middle">BE</text>
      <text x={cx - r} y={cy + 16} textAnchor="middle">0×</text>
      <text x={cx + r} y={cy + 16} textAnchor="middle">{max.toFixed(1)}×</text>
    </svg>
  );
}
