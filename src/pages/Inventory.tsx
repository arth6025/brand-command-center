import { Fragment, useEffect, useState } from 'react';
import { compact, inr, num, pct } from '../metrics/format';
import { BUCKETS, type CoverBucket, type SkuStock } from '../metrics/ops';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Empty, Note, PageHead, Seg, SourceChip, VERDICT_TONE } from '../ui/kit';

type Window = '45' | '60' | '90';

const BUCKET_TOP: Record<CoverBucket, string> = {
  stockout: 'top-crit', critical: 'top-warn', watch: 'top-ink', healthy: 'top-good', overstock: 'top-ink', nofeed: 'top-muted',
};

/** Cover is stored as 9999 when the run rate is zero; show it as "no sales" rather than a number. */
function coverLabel(c: number | null) {
  if (c === null) return '—';
  if (c >= 9999) return 'no sales';
  return `${Math.round(c)}d`;
}

const months = (days: number | null) => (days === null ? null : days / 30.4);

/**
 * Inventory and stock: a point-in-time snapshot from the warehouse system.
 * Run rates are the only range-independent numbers here: cover always uses
 * the 45-day DRR (the governed definition); the 60/90 toggle is for context.
 */
export default function Inventory() {
  const { engine, param, navigate } = useApp();
  const inv = engine.ops.inventory();
  const rec = engine.ops.stockReconciliation();
  const [bucket, setBucket] = useState<CoverBucket | null>(null);
  const [win, setWin] = useState<Window>('45');
  const [open, setOpen] = useState<string | null>(param);

  // Search lands here with a product id: open that SKU and make sure the filter doesn't hide it
  const focused = inv.find((s) => s.product.id === param);
  useEffect(() => {
    if (!focused) return;
    setOpen(focused.product.id);
    setBucket(null);
    window.setTimeout(() => document.getElementById(`sku-${focused.product.id}`)?.scrollIntoView({ block: 'center' }), 0);
  }, [focused]);

  const counts = Object.fromEntries(BUCKETS.map((b) => [b.id, inv.filter((s) => s.bucket === b.id).length])) as Record<CoverBucket, number>;
  const rows = bucket ? inv.filter((s) => s.bucket === bucket) : inv;
  const drr = (s: SkuStock) => (win === '45' ? s.drr45 : win === '60' ? s.drr60 : s.drr90);
  const toClear = inv.filter((s) => s.onHand !== null && s.cover !== null && s.cover > 60 && s.adSpend30 < 20000);
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));

  return (
    <>
      <PageHead title="Inventory and stock" sub="On hand from the warehouse system · SKUs with no feed shown as unknown, not zero" />

      {/* Cover buckets double as the table filter */}
      <div className="grid g6">
        {BUCKETS.map((b) => {
          const active = bucket === b.id;
          return (
            <Card
              key={b.id}
              className={`stat clickable ${BUCKET_TOP[b.id]}`}
              onClick={() => setBucket(active ? null : b.id)}
              title={active ? 'Click to clear the filter' : 'Click to filter the table'}
            >
              <div className="stat-top"><span className="stat-label strong">{b.label}</span></div>
              <div className="stat-value">{counts[b.id]}</div>
              <div className="stat-foot" style={active ? { color: 'var(--ink)', fontWeight: 600 } : undefined}>
                {active ? 'filtering · click to clear' : `SKU${counts[b.id] === 1 ? '' : 's'}`}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid split-8-4 mt">
        <Card>
          <CardHead
            title="Per SKU"
            sub={`${bucket ? `${BUCKETS.find((b) => b.id === bucket)!.label} · ` : ''}cover = on hand ÷ 45-day run rate · click a row for the reason behind the call`}
            tools={
              <>
                {bucket && <button className="btn ghost" onClick={() => setBucket(null)}>Show all</button>}
                <Seg<Window> small label="Run-rate window" value={win} onChange={setWin} options={[{ id: '45', label: 'DRR 45' }, { id: '60', label: '60' }, { id: '90', label: '90' }]} />
                <SourceChip label="definition" metric="cover_days" />
              </>
            }
          />
          {rows.length === 0 ? <Empty>No SKUs in this bucket.</Empty> : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>SKU</th><th className="num">On hand</th><th className="num">DRR {win}D</th><th className="num">Cover</th>
                    <th className="num">Batch expiry</th><th className="num">Ad spend 30D</th><th>Call</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const id = s.product.id;
                    const exp = months(s.earliestExpiryDays);
                    const isOpen = open === id;
                    return (
                      <Fragment key={id}>
                        <tr id={`sku-${id}`} className={`clickable ${isOpen || param === id ? 'selected' : ''}`} onClick={() => toggle(id)} aria-expanded={isOpen}>
                          <td>{s.product.name} <span className="muted">· {s.product.size}</span></td>
                          <td className={`num ${s.onHand === null ? 'muted' : ''}`}>{s.onHand === null ? 'unknown' : num(s.onHand)}</td>
                          <td className="num">{num(drr(s), 1)}</td>
                          <td className={`num ${s.cover !== null && s.cover < 25 ? 'neg' : ''}`}>{coverLabel(s.cover)}</td>
                          <td className={`num ${exp !== null && exp < 6 ? 'neg' : ''}`}>{exp === null ? '—' : `${Math.max(0, Math.round(exp))} months`}</td>
                          <td className="num">{s.adSpend30 > 0 ? inr(s.adSpend30) : <span className="muted">₹0</span>}</td>
                          <td><Badge tone={VERDICT_TONE[s.call]} title={s.reason}>{s.call}</Badge></td>
                        </tr>
                        {isOpen && (
                          <tr className="selected">
                            <td colSpan={7}>
                              <div className="row small">
                                <span className="strong">Why {s.call}:</span>
                                <span className="soft">{s.reason}</span>
                              </div>
                              <div className="row tiny muted mt-s">
                                <span>{s.product.sku}</span>
                                <span>· DRR 45 / 60 / 90: {num(s.drr45, 1)} / {num(s.drr60, 1)} / {num(s.drr90, 1)} units/day</span>
                                {s.earliestExpiryDays !== null && <span>· earliest batch expires in {Math.round(s.earliestExpiryDays)} days</span>}
                                <span>· shelf life {s.product.shelfLifeMonths} months</span>
                                <button className="btn ghost" style={{ padding: '0 4px', fontSize: 11 }} onClick={(e) => { e.stopPropagation(); navigate('campaigns'); }}>Campaigns →</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="stack">
          <Card>
            <CardHead title="Advertise to clear" sub="Over 60 days of cover with under ₹20,000 of ad spend in 30 days" />
            {toClear.length === 0 ? <Empty>Nothing overstocked without spend.</Empty> : (
              <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
                {toClear.map((s) => (
                  <li key={s.product.id} style={{ margin: '4px 0' }}>
                    <span className="strong">{s.product.name}</span>
                    <span className="soft"> · {compact(s.onHand)} units · {s.cover !== null && s.cover >= 9999 ? 'no sales in 45 days' : `${coverLabel(s.cover)} cover`} · {inr(s.adSpend30)} spend</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHead title="Stock source reconciliation" sub="Warehouse vs storefront vs marketplace stock" />
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Source</th><th className="num">SKUs</th><th className="num">Match</th></tr></thead>
                <tbody>
                  {rec.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.label}
                        {r.mismatches.length > 0 && <div className="tiny muted">Mismatch: {r.mismatches.join(', ')}</div>}
                      </td>
                      <td className="num">{r.skus}</td>
                      <td className={`num ${r.match !== null && r.match < 0.9 ? 'warn-text' : ''}`}>{r.match === null ? '—' : pct(r.match, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-s">
              <Note>Shopify should mirror the warehouse within ±2%. FBA and dark stores are separate pools: a match there means the SKU is listed and has sellable units.</Note>
            </div>
          </Card>
        </div>
      </div>

      <BuiltFrom sources={['wms', 'shopify', 'amazon_sp', 'blinkit', 'meta']} />
    </>
  );
}
