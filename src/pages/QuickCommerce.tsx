import type { ReactNode } from 'react';
import { heatStyle } from '../charts/LineChart';
import type { SalesChannel } from '../domain/types';
import { CHANNEL_META } from '../metrics/channels';
import { inr, num, pct, safeDiv } from '../metrics/format';
import type { FeedHealth } from '../metrics/health';
import { dayLabel, describeRange } from '../metrics/range';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Note, PageHead, SourceChip } from '../ui/kit';

/** Below this, a city's availability or PO fill is flagged. */
const AVAIL_FLOOR = 0.75;

/** What the revenue number on each row actually measures. */
const BASIS: Record<string, string> = {
  d2c: 'sell-through (delivered + in-transit orders, ex-GST)',
  marketplace: 'sell-through net of returns',
  sell_in: 'sell-in: PO value invoiced to the platform, not sell-through to shoppers',
};

/**
 * Channels: CM2 for every sales channel, which products sell where, and
 * dark-store availability. Most platforms here are portal reports, so each row
 * carries its own data freshness instead of one page-level timestamp.
 */
export default function QuickCommerce() {
  const { engine, range } = useApp();
  const rows = engine.channels.cm2(range);
  const matrix = engine.channels.matrix(range);
  const stores = engine.channels.darkStores();
  const feeds = engine.health.feeds();
  const today = engine.cal.today;

  const asOf = (ch: SalesChannel): ReactNode => {
    const id = CHANNEL_META[ch].connector;
    if (id === 'shopify') return 'live';
    const f: FeedHealth | undefined = feeds.find((x) => x.def.id === id);
    if (!f) return '—';
    if (f.status === 'stale') return <Badge tone="crit">{f.lagDays ?? '?'} days · stale</Badge>;
    if (f.status === 'not_connected' || f.status === 'awaiting_approval' || f.status === 'error') return <Badge tone="neutral">{f.label.toLowerCase()}</Badge>;
    const d = f.run.latestDataDay;
    if (d === null) return '—';
    return d >= today ? 'today' : d === today - 1 ? 'yesterday' : dayLabel(engine.cal, d);
  };

  const sum = (get: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + get(r), 0);
  const total = {
    net: sum((r) => r.netRevenue), cogs: sum((r) => r.cogs), fees: sum((r) => r.fees),
    logistics: sum((r) => r.logistics ?? 0), ads: sum((r) => r.ads), cm2: sum((r) => r.cm2),
  };
  const maxShare = Math.max(0, ...matrix.rows.flatMap((r) => r.shares));
  const models = [...new Set(rows.map((r) => CHANNEL_META[r.channel].model))];

  return (
    <>
      <PageHead
        title="Channels — CM2 by channel"
        sub={`${describeRange(engine.cal, range)} · data freshness per platform shown on each row`}
        actions={<Badge tone="outline">New</Badge>}
      />

      <Card>
        <CardHead title="Contribution after marketing, per channel" sub="Net revenue − COGS − commission & fees − logistics − channel ads" tools={<SourceChip label="definition" metric="cm2_channel" />} />
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Channel</th><th>Model</th><th className="num">Net revenue</th><th className="num">GM</th><th className="num">Commission & fees</th>
                <th className="num">Logistics</th><th className="num">Ads</th><th className="num">CM2</th><th className="num">CM2 %</th><th>Data as of</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.channel}>
                  <td className="strong">{CHANNEL_META[r.channel].label}</td>
                  <td className="small muted">{CHANNEL_META[r.channel].modelLabel}</td>
                  <td className="num">{inr(r.netRevenue)}</td>
                  <td className="num">{pct(r.gmPct, 0)}</td>
                  <td className="num">{inr(r.fees)}</td>
                  <td className="num">{r.logistics === null ? <span className="muted" title="Platform delivers from its own dark stores">—</span> : inr(r.logistics)}</td>
                  <td className="num">{inr(r.ads)}</td>
                  <td className={`num ${r.cm2 < 0 ? 'neg' : ''}`}>{inr(r.cm2)}</td>
                  <td className={`num ${(r.cm2Pct ?? 0) < 0 ? 'neg' : ''}`}>{pct(r.cm2Pct)}</td>
                  <td className="small">{asOf(r.channel)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Total</td><td />
                <td className="num">{inr(total.net)}</td>
                <td className="num">{pct(safeDiv(total.net - total.cogs, total.net), 0)}</td>
                <td className="num">{inr(total.fees)}</td>
                <td className="num">{inr(total.logistics)}</td>
                <td className="num">{inr(total.ads)}</td>
                <td className={`num ${total.cm2 < 0 ? 'neg' : ''}`}>{inr(total.cm2)}</td>
                <td className={`num ${total.cm2 < 0 ? 'neg' : ''}`}>{pct(safeDiv(total.cm2, total.net))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-s">
          <Note>
            Revenue basis differs by channel, so rows are comparable on margin, not on timing.{' '}
            {models.map((m, i) => (
              <span key={m}>
                {i > 0 && ' · '}
                <span className="strong">{rows.filter((r) => CHANNEL_META[r.channel].model === m).map((r) => CHANNEL_META[r.channel].label).join(', ')}</span>: {BASIS[m]}
              </span>
            ))}
            . Website logistics include RTO; quick commerce logistics are borne by the platform.
          </Note>
        </div>
      </Card>

      <div className="grid split-7-5 mt">
        <Card>
          <CardHead title="Product × channel matrix" sub="Net revenue share of each product by channel · darker = larger" />
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr><th>Product</th>{matrix.cols.map((c) => <th key={c} className="num" style={{ textAlign: 'center' }}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {matrix.rows.map((r) => (
                  <tr key={r.product.id}>
                    <td className="small">{r.product.name}</td>
                    {r.shares.map((s, i) => (
                      <td key={matrix.cols[i]} className="heat" style={heatStyle(s, maxShare)} title={`${r.product.name} · ${matrix.cols[i]}: ${pct(s)} of ${inr(r.total)}`}>
                        {s > 0 ? pct(s, 0) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row tiny muted mt-s" aria-label="Heat scale legend">
            <span>Scale:</span>
            {[0, 0.25, 0.5, 0.75, 1].map((k) => (
              <span key={k} className="num" style={{ ...heatStyle(k * maxShare, maxShare), padding: '1px 6px', borderRadius: 3, border: '1px solid var(--hair)' }}>
                {pct(k * maxShare, 0)}
              </span>
            ))}
            <span>· each row sums to 100%</span>
          </div>
        </Card>

        <Card>
          <CardHead title="Dark-store availability and POs" sub="Share of dark stores in stock · PO fill rate over the last 30 days" />
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr><th>City</th><th className="num">In stock</th><th className="num">Serum in stock</th><th className="num">PO fill rate</th><th className="num">Days of cover</th></tr>
              </thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s.city}>
                    <td>{s.city}</td>
                    <td className={`num ${s.inStock < AVAIL_FLOOR ? 'neg' : ''}`}>{pct(s.inStock, 0)}</td>
                    <td className={`num ${s.heroInStock !== null && s.heroInStock < AVAIL_FLOOR ? 'neg' : ''}`}>
                      {pct(s.heroInStock, 0)}
                      {s.heroInStock !== null && s.heroInStock < AVAIL_FLOOR && <> <Badge tone="crit">Alert</Badge></>}
                    </td>
                    <td className={`num ${s.fillRate !== null && s.fillRate < AVAIL_FLOOR ? 'neg' : ''}`}>{pct(s.fillRate, 0)}</td>
                    <td className="num">{num(s.cover, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Alerts when a hero SKU drops below {pct(AVAIL_FLOOR, 0)} availability in a top city.</p>
        </Card>
      </div>

      <BuiltFrom sources={['blinkit', 'zepto', 'instamart', 'amazon_sp', 'flipkart', 'nykaa']} />
    </>
  );
}
