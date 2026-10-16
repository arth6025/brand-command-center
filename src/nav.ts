import type { RouteId } from './state/app';

export interface NavItem {
  id: RouteId;
  label: string;
  isNew?: boolean;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'D2C', items: [
    { id: 'overview', label: 'Overview' },
    { id: 'campaigns', label: 'Performance marketing' },
    { id: 'recommendations', label: 'Recommendations' },
    { id: 'creatives', label: 'Creative library' },
    { id: 'funnel', label: 'Conversion funnel' },
    { id: 'channel-funnel', label: 'Channel funnel' },
    { id: 'trading', label: 'Trading room' },
  ] },
  { group: 'Finance', items: [{ id: 'reconciliation', label: 'Revenue reconciliation', isNew: true }] },
  { group: 'Retention', items: [{ id: 'retention', label: 'Retention' }] },
  { group: 'Inventory', items: [{ id: 'inventory', label: 'Inventory' }] },
  { group: 'Fulfilment', items: [{ id: 'fulfilment', label: 'Fulfilment' }] },
  { group: 'Amazon', items: [{ id: 'amazon', label: 'Command centre' }] },
  { group: 'Channels', items: [{ id: 'quick-commerce', label: 'Quick commerce & marketplaces', isNew: true }] },
  { group: 'Admin', items: [{ id: 'health', label: 'Data health' }, { id: 'connectors', label: 'Connectors' }] },
];

export const ROUTE_LABEL: Record<RouteId, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.id, i.label]))) as Record<RouteId, string>;
