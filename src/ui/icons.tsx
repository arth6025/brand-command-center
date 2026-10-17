import type { RouteId } from '../state/app';

/** Stroke icons (24-unit grid, currentColor) for the navigation rail. */
const PATHS: Record<RouteId, string> = {
  overview: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  campaigns: 'M3 11l15-6v14L3 13zM7 12.5V18a2 2 0 0 0 4 0v-3.6',
  recommendations: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  creatives: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 1 0 0-.01',
  funnel: 'M3 4h18l-7 8v7l-4 2v-9z',
  'channel-funnel': 'M4 6h16M7 12h10M10 18h4',
  trading: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6',
  reconciliation: 'M4 7h13l-3-3M20 17H7l3 3M4 7v4M20 17v-4',
  retention: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  inventory: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10',
  fulfilment: 'M3 6h11v10H3zM14 9h4l3 3v4h-7M7.5 19a1.5 1.5 0 1 0 0-.01M17.5 19a1.5 1.5 0 1 0 0-.01',
  amazon: 'M4 8l8-4 8 4-8 4zM4 8v8l8 4M20 8v8l-8 4M3 18c5 3 13 3 18 0',
  'quick-commerce': 'M13 2L4 14h7l-1 8 9-12h-7z',
  health: 'M3 12h4l2-6 4 12 2-6h6',
  connectors: 'M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5',
};

export function NavIcon({ id }: { id: RouteId }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[id]} />
    </svg>
  );
}
