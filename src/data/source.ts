/**
 * Data source seam. The UI and metric engine depend only on `Warehouse`.
 *
 * - `simulated` (default): deterministic generator, for demos and development.
 * - `snapshot`: a JSON export of the real warehouse tables served at
 *   VITE_WAREHOUSE_URL (produced by the ingestion jobs in production).
 *
 * Real connectors never run in the browser: they land tables server-side and
 * this seam reads the result.
 */
import type { Warehouse } from '../domain/types';
import { generateWarehouse } from './generate';

export interface DataSource {
  kind: 'simulated' | 'snapshot';
  load(): Warehouse;
}

export function createDataSource(): DataSource {
  return {
    kind: 'simulated',
    load: () => generateWarehouse(),
  };
}

/** Async loader for a real warehouse snapshot; validates the shape before use. */
export async function loadSnapshot(url: string): Promise<Warehouse> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Warehouse snapshot ${res.status}`);
  const w = (await res.json()) as Warehouse;
  const required: (keyof Warehouse)[] = ['orders', 'adDaily', 'campaigns', 'products', 'skuCosts', 'connectorRuns', 'governance'];
  for (const k of required) if (!(k in w)) throw new Error(`Warehouse snapshot missing table: ${k}`);
  return w;
}
