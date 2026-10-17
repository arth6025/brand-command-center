/**
 * Motion primitives: cursor spotlight, 3D tilt, count-up numbers, sparklines.
 * All of them respect prefers-reduced-motion and coarse pointers (touch).
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;

/** One document-level tracker sets --mx/--my on whichever .card is under the cursor. */
export function useSpotlight() {
  useEffect(() => {
    if (!finePointer()) return;
    let frame = 0;
    let last: HTMLElement | null = null;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const card = (e.target as HTMLElement | null)?.closest?.('.card') as HTMLElement | null;
        if (last && last !== card) { last.style.removeProperty('--mx'); last.style.removeProperty('--my'); }
        last = card;
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => { document.removeEventListener('pointermove', onMove); cancelAnimationFrame(frame); };
  }, []);
}

/** Tilts an element toward the cursor in 3D; returns a ref to attach. */
export function useTilt<T extends HTMLElement>(max = 6): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced() || !finePointer()) return;
    el.classList.add('tilt');
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transition = 'transform 0.12s ease-out';
        el.style.transform = `perspective(900px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) translateZ(4px)`;
      });
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      el.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = '';
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); cancelAnimationFrame(frame); };
  }, [max]);
  return ref;
}

/**
 * Animates the first number inside a formatted string ("₹2.11Cr", "1,234", "3.29×")
 * from its previous value, keeping the prefix, suffix, decimals and Indian grouping.
 */
export function CountUp({ value, duration = 900 }: { value: string; duration?: number }) {
  const [text, setText] = useState(value);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const m = value.match(/^(.*?)(-?[\d,]*\.?\d+)(.*)$/s);
    if (!m || reduced()) { setText(value); return; }
    const [, pre, numStr, post] = m;
    const target = Number(numStr.replace(/,/g, ''));
    const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0;
    const grouped = numStr.includes(',');
    const from = prev.current ?? target * 0.6;
    prev.current = target;
    if (!Number.isFinite(target) || from === target) { setText(value); return; }
    const start = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 4);
      const v = from + (target - from) * eased;
      const s = grouped ? v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals);
      setText(k >= 1 ? value : `${pre}${s}${post}`);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <>{text}</>;
}

/** Tiny area sparkline; the last point is emphasised. */
export function Sparkline({ values, color = 'var(--series-1)' }: { values: number[]; color?: string }) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const w = 120, h = 30;
  const min = Math.min(...pts), max = Math.max(...pts);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  let hash = 0;
  for (const ch of `${color}${pts.join(',')}`) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const id = `sp${(hash >>> 0).toString(36)}`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="2.6" fill={color} />
    </svg>
  );
}
