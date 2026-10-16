import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createDataSource } from '../data/source';
import { Engine } from '../metrics/engine';
import type { Scope } from '../metrics/core';
import { type DateRange, type PresetId, presetRange, previousRange } from '../metrics/range';
import { load, save } from './storage';

export type RouteId =
  | 'overview' | 'campaigns' | 'recommendations' | 'creatives' | 'funnel' | 'channel-funnel' | 'trading'
  | 'reconciliation' | 'retention' | 'inventory' | 'fulfilment' | 'amazon' | 'quick-commerce' | 'health' | 'connectors';

export interface Decision {
  recId: string;
  action: 'recorded' | 'parked' | 'ignored';
  note: string;
  owner: string;
  at: number;
}

interface AppState {
  engine: Engine;
  range: DateRange;
  prev: DateRange;
  setPreset: (p: PresetId, custom?: { start: number; end: number }) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
  route: RouteId;
  param: string | null;
  navigate: (route: RouteId, param?: string | null) => void;
  metricId: string | null;
  openMetric: (id: string | null) => void;
  askOpen: boolean;
  setAskOpen: (v: boolean) => void;
  askSeed: string;
  ask: (q: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  theme: 'system' | 'light' | 'dark';
  setTheme: (t: 'system' | 'light' | 'dark') => void;
  decisions: Decision[];
  decide: (d: Decision) => void;
  undoDecision: (recId: string) => void;
  toast: string | null;
  notify: (msg: string) => void;
}

const Ctx = createContext<AppState | null>(null);

function parseHash(): { route: RouteId; param: string | null; preset: PresetId | null; scope: Scope | null; start?: number; end?: number } {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const [route, param] = path.split('/');
  const q = new URLSearchParams(qs ?? '');
  return {
    route: (route || 'overview') as RouteId,
    param: param ? decodeURIComponent(param) : null,
    preset: (q.get('range') as PresetId) || null,
    scope: (q.get('scope') as Scope) || null,
    start: q.get('from') ? Number(q.get('from')) : undefined,
    end: q.get('to') ? Number(q.get('to')) : undefined,
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const engine = useMemo(() => new Engine(createDataSource().load()), []);
  const initial = parseHash();
  const [route, setRoute] = useState<RouteId>(initial.route);
  const [param, setParam] = useState<string | null>(initial.param);
  const [range, setRange] = useState<DateRange>(() => presetRange(engine.cal, initial.preset ?? '30d', initial.start !== undefined ? { start: initial.start, end: initial.end ?? engine.cal.today } : undefined));
  const [scope, setScope] = useState<Scope>(initial.scope ?? 'all');
  const [metricId, openMetric] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askSeed, setAskSeed] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, setThemeState] = useState<'system' | 'light' | 'dark'>(() => load('theme', 'system'));
  const [decisions, setDecisions] = useState<Decision[]>(() => load('decisions', []));
  const [toast, setToast] = useState<string | null>(null);

  // URL ← state
  useEffect(() => {
    const q = new URLSearchParams();
    q.set('range', range.preset);
    if (range.preset === 'custom') { q.set('from', String(range.start)); q.set('to', String(range.end)); }
    if (scope !== 'all') q.set('scope', scope);
    const next = `#/${route}${param ? `/${encodeURIComponent(param)}` : ''}?${q.toString()}`;
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }, [route, param, range, scope]);

  // state ← URL (back/forward, pasted links)
  useEffect(() => {
    const onHash = () => {
      const h = parseHash();
      setRoute(h.route);
      setParam(h.param);
      if (h.preset) setRange(presetRange(engine.cal, h.preset, h.start !== undefined ? { start: h.start, end: h.end ?? engine.cal.today } : undefined));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [engine]);

  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
    save('theme', theme);
  }, [theme]);

  const navigate = useCallback((r: RouteId, p: string | null = null) => {
    setRoute(r);
    setParam(p);
    window.history.pushState(null, '', `#/${r}${p ? `/${encodeURIComponent(p)}` : ''}`);
    window.scrollTo({ top: 0 });
  }, []);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const decide = useCallback((d: Decision) => {
    setDecisions((prev) => {
      const next = [...prev.filter((x) => x.recId !== d.recId), d];
      save('decisions', next);
      return next;
    });
  }, []);
  const undoDecision = useCallback((recId: string) => {
    setDecisions((prev) => {
      const next = prev.filter((x) => x.recId !== recId);
      save('decisions', next);
      return next;
    });
  }, []);

  const value: AppState = {
    engine, range, prev: previousRange(range),
    setPreset: (p, custom) => setRange(presetRange(engine.cal, p, custom)),
    scope, setScope, route, param, navigate, metricId, openMetric,
    askOpen, setAskOpen, askSeed, ask: (q: string) => { setAskSeed(q); setAskOpen(true); },
    paletteOpen, setPaletteOpen, theme, setTheme: setThemeState, decisions, decide, undoDecision, toast, notify,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
