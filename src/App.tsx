import { lazy, Suspense, useEffect, useState } from 'react';
import { ago } from './metrics/format';
import { PRESETS, type PresetId } from './metrics/range';
import { NAV } from './nav';
import { type RouteId, useApp } from './state/app';
import { Seg } from './ui/kit';
import { AskDrawer, CommandPalette, CustomRange, MetricDrawer } from './ui/overlays';

const PAGES: Record<RouteId, React.LazyExoticComponent<() => JSX.Element>> = {
  overview: lazy(() => import('./pages/Overview')),
  campaigns: lazy(() => import('./pages/Campaigns')),
  recommendations: lazy(() => import('./pages/Recommendations')),
  creatives: lazy(() => import('./pages/Creatives')),
  funnel: lazy(() => import('./pages/ConversionFunnel')),
  'channel-funnel': lazy(() => import('./pages/ChannelFunnel')),
  trading: lazy(() => import('./pages/TradingRoom')),
  reconciliation: lazy(() => import('./pages/Reconciliation')),
  retention: lazy(() => import('./pages/Retention')),
  inventory: lazy(() => import('./pages/Inventory')),
  fulfilment: lazy(() => import('./pages/Fulfilment')),
  amazon: lazy(() => import('./pages/Amazon')),
  'quick-commerce': lazy(() => import('./pages/QuickCommerce')),
  health: lazy(() => import('./pages/DataHealth')),
  connectors: lazy(() => import('./pages/Connectors')),
};

export default function App() {
  const app = useApp();
  const { engine, route, navigate, range, setPreset, setPaletteOpen, setAskOpen, theme, setTheme, toast } = app;
  const [menuOpen, setMenuOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const health = engine.health.summary();
  const recCount = engine.recommendations(range).filter((r) => !app.decisions.some((d) => d.recId === r.id)).length;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setPaletteOpen]);

  const Page = PAGES[route] ?? PAGES.overview;
  const syncDot = health.staleIds.length ? 'warn' : '';

  return (
    <div className="app">
      <nav className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Main">
        <div className="brand">
          <div className="brand-mark">{engine.w.brand.name[0]}</div>
          <div>
            <div className="brand-name">{engine.w.brand.name}</div>
            <div className="brand-sub">Operating dashboard</div>
          </div>
        </div>
        {NAV.map((g) => (
          <div className="nav-group" key={g.group}>
            <div className="nav-label">{g.group}</div>
            {g.items.map((i) => (
              <a
                key={i.id} href={`#/${i.id}`} className="nav-item" aria-current={route === i.id ? 'page' : undefined}
                onClick={(e) => { e.preventDefault(); navigate(i.id); setMenuOpen(false); }}
              >
                {i.label}
                {i.isNew && <span className="nav-new">NEW</span>}
                {i.id === 'recommendations' && recCount > 0 && <span className="count">{recCount}</span>}
                {i.id === 'health' && health.attention > 0 && <span className="count">{health.attention}</span>}
              </a>
            ))}
          </div>
        ))}
        <div className="nav-group" style={{ padding: '0 8px' }}>
          <span className="demo-pill" title="All figures come from the simulated warehouse until real connectors are configured">Demo data</span>
        </div>
      </nav>
      {menuOpen && <div className="scrim" style={{ zIndex: 54 }} onClick={() => setMenuOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open navigation">☰</button>
          <button className="search-btn" onClick={() => setPaletteOpen(true)}>
            <span>Search orders, products, campaigns…</span><kbd>⌘K</kbd>
          </button>
          <button className="sync" onClick={() => navigate('health')} title="Computed from connector runs">
            <span className={`dot ${syncDot}`} />Synced · {ago(engine.w.generatedAt - health.lastSync)}
            {health.staleIds.length > 0 && <span className="warn-text">· {health.staleIds.length} stale</span>}
          </button>
          <div className="spacer" />
          <Seg<PresetId>
            label="Date range" value={range.preset}
            options={PRESETS.map((p) => ({ id: p.id, label: p.label }))}
            onChange={(p) => (p === 'custom' ? setCustomOpen(true) : setPreset(p))}
          />
          <button
            className="icon-btn" aria-label="Toggle theme" title={`Theme: ${theme}`}
            onClick={() => setTheme(theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system')}
          >{theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}</button>
          <button className="btn primary" onClick={() => setAskOpen(true)}>✦ Ask</button>
        </header>

        <main className="content">
          <Suspense fallback={<div className="empty">Loading…</div>}>
            <Page />
          </Suspense>
        </main>
      </div>

      <MetricDrawer />
      <AskDrawer />
      <CommandPalette />
      {customOpen && <CustomRange onClose={() => setCustomOpen(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
