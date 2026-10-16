import { useState, type ReactNode } from 'react';
import type { AmazonClaim } from '../domain/types';
import { compact, inr, num, pct } from '../metrics/format';
import { dayLabel, describeRange } from '../metrics/range';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Empty, exportCsv, PageHead, SourceChip } from '../ui/kit';

const CLAIM_KIND: Record<AmazonClaim['kind'], string> = {
  lost: 'Lost in FBA', damaged: 'Damaged in FBA', short_received: 'Short received', removal: 'Removal not returned', refund_mismatch: 'Refund without return',
};

/** Amazon reimburses FBA claims for 6 months from the event. */
const CLAIM_WINDOW = 180;
const PREVIEW = 6;

/** One step of the stock → profit line, with what leaks out of it. */
function FlowTile({ title, value, valueClass = '', lines, leak }: { title: string; value: ReactNode; valueClass?: string; lines: ReactNode[]; leak: ReactNode }) {
  return (
    <Card className="stat">
      <div className="stat-top"><span className="stat-label strong" style={{ letterSpacing: '0.06em' }}>{title}</span></div>
      <div className={`stat-value ${valueClass}`}>{value}</div>
      {lines.map((l, i) => <div key={i} className="stat-foot">{l}</div>)}
      <div className="leak">▼ {leak}</div>
    </Card>
  );
}

/**
 * Amazon command centre: one line from FBA stock to contribution, with the leak
 * at each step, then profit per ASIN, the reimbursement claims queue and the
 * next settlement payout.
 */
export default function Amazon() {
  const { engine, range } = useApp();
  const a = engine.channels.amazon(range);
  const t = engine.cal.today;
  const [showAll, setShowAll] = useState(false);
  const claims = [...a.claims.list].sort((x, y) => y.value - x.value);
  const visible = showAll ? claims : claims.slice(0, PREVIEW);
  const next = a.payout.next;
  const name = (pid: string) => engine.core.productById[pid]?.name ?? pid;

  const exportClaims = () => exportCsv('amazon-claims.csv', [
    ['Claim', 'Kind', 'Product', 'ASIN', 'Units', 'Value', 'Event date', 'Days left'],
    ...claims.map((c) => [c.id, CLAIM_KIND[c.kind], name(c.productId), engine.core.productById[c.productId]?.asin ?? '', c.units, Math.round(c.value), dayLabel(engine.cal, c.eventDay, true), c.eventDay + CLAIM_WINDOW - t]),
  ]);

  return (
    <>
      <PageHead title="Amazon command centre" sub={`${describeRange(engine.cal, range)} · Seller Central + Amazon Ads · orders, finances, settlements, inventory ledger, ads`} />

      <div className="flow">
        <FlowTile
          title="INVENTORY" value={compact(a.inventory.sellable)}
          lines={[`sellable units · ${a.inventory.locations} location${a.inventory.locations === 1 ? '' : 's'}`, `Days of cover ${num(a.inventory.cover, 0)} · regional in-stock ${pct(a.inventory.regionalInStock, 0)}`]}
          leak={`${inr(a.inventory.lostSales)} est. sales lost to stock-outs`}
        />
        <div className="flow-arrow" aria-hidden="true">→</div>
        <FlowTile
          title="REVENUE" value={inr(a.revenue.gmv)}
          lines={[`gross sales · ${compact(a.revenue.orders)} orders`, `AOV ${inr(a.revenue.aov)} · Buy Box ${pct(a.revenue.buyBox, 0)}`]}
          leak={`${inr(a.revenue.refunds)} refunded on returns`}
        />
        <div className="flow-arrow" aria-hidden="true">→</div>
        <FlowTile
          title="ADS" value={inr(a.ads.spend)}
          lines={[`spend · ACoS ${pct(a.ads.acos)} · TACoS ${pct(a.ads.tacos)}`]}
          leak={`break-even ACoS ${pct(a.ads.breakEvenAcos)}`}
        />
        <div className="flow-arrow" aria-hidden="true">→</div>
        <FlowTile
          title="PROFIT" value={inr(a.profit.contribution)} valueClass={a.profit.contribution < 0 ? 'neg' : ''}
          lines={['contribution after fees and ads', `margin ${pct(a.profit.margin)} · ${a.profit.lossMaking} loss-making ASIN${a.profit.lossMaking === 1 ? '' : 's'}`]}
          leak={`fees posted ${pct(a.profit.feesPosted, 0)} · rest estimated`}
        />
      </div>

      <div className="grid split-7-5 mt">
        <Card>
          <CardHead title="Profit per ASIN" sub="Net sales after returns · fees = referral + FBA · ads allocated by share of net sales" tools={<SourceChip label="definition" metric="cm2_channel" />} />
          {a.asins.length === 0 ? <Empty>No Amazon sales in this range.</Empty> : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr><th>ASIN</th><th className="num">Net sales</th><th className="num">Fees</th><th className="num">Ads</th><th className="num">Landed cost</th><th className="num">Contribution</th><th className="num">Margin</th></tr>
                </thead>
                <tbody>
                  {a.asins.map((r) => (
                    <tr key={r.product.id}>
                      <td>{r.product.name} <span className="tiny muted" style={{ fontFamily: 'var(--mono)' }}>· {r.product.asin ?? 'no ASIN'}</span></td>
                      <td className="num">{inr(r.net)}</td>
                      <td className="num">{inr(r.fees)}</td>
                      <td className="num">{inr(r.ads)}</td>
                      <td className="num">{inr(r.landed)}</td>
                      <td className={`num ${r.contribution < 0 ? 'neg' : ''}`}>{inr(r.contribution)}</td>
                      <td className={`num ${(r.margin ?? 0) < 0 ? 'neg' : ''}`}>{pct(r.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="stack">
          <Card>
            <CardHead
              title="Claims and audit"
              sub="Lost, damaged, short-received, removal and refund mismatches · claimable for 6 months from the event"
              tools={<button className="btn" onClick={exportClaims} disabled={claims.length === 0}>Export claims CSV</button>}
            />
            <div className="grid g2">
              <Card className="stat top-good">
                <span className="stat-label">Claimable · 6 mo</span>
                <div className="stat-value">{inr(a.claims.claimable)}</div>
                <div className="stat-foot">{a.claims.claimableCount} claims</div>
              </Card>
              <Card className="stat top-warn">
                <span className="stat-label">Expiring in 14 days</span>
                <div className="stat-value">{inr(a.claims.expiring)}</div>
                <div className="stat-foot">{a.claims.expiringCount} claims · file first</div>
              </Card>
            </div>
            {claims.length > 0 && (
              <div className="table-wrap mt">
                <table className="t">
                  <thead><tr><th>Kind</th><th>Product</th><th className="num">Units</th><th className="num">Value</th><th className="num">Event</th></tr></thead>
                  <tbody>
                    {visible.map((c) => {
                      const left = c.eventDay + CLAIM_WINDOW - t;
                      return (
                        <tr key={c.id}>
                          <td className="small">{CLAIM_KIND[c.kind]}{left <= 14 && <> <Badge tone="warn">{left}d left</Badge></>}</td>
                          <td className="small">{name(c.productId)}</td>
                          <td className="num">{c.units}</td>
                          <td className="num">{inr(c.value)}</td>
                          <td className="num small">{dayLabel(engine.cal, c.eventDay)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {claims.length > PREVIEW && (
              <button className="btn ghost mt-s" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? 'Show top claims only' : `Show all ${claims.length} claims`}
              </button>
            )}
          </Card>

          <Card>
            <CardHead title="Payout forecast" sub="Settlement cycles from the Finances API; forecast cycles are estimated from open orders" />
            {!next ? <Empty>No scheduled or forecast settlement.</Empty> : (
              <div className="grid g2">
                <div>
                  <div className="small soft">Next payout · {dayLabel(engine.cal, next.payoutDay)}</div>
                  <div className="stat-value">{inr(next.amount)}</div>
                  <Badge tone={next.status === 'scheduled' ? 'info' : 'neutral'}>{next.status}</Badge>
                </div>
                <div>
                  <div className="small soft">Next 30 days</div>
                  <div className="stat-value">{inr(a.payout.next30)}</div>
                  <div className="stat-foot">covers {dayLabel(engine.cal, next.startDay)} – {dayLabel(engine.cal, next.endDay)} cycle onward</div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <BuiltFrom sources={['amazon_sp', 'amazon_ads', 'sku_costs']} />
    </>
  );
}
