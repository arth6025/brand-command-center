import { useMemo, useState } from 'react';
import { LineChart } from '../charts/LineChart';
import type { Scope } from '../metrics/core';
import { compact, inr, inrShort, pct, xm } from '../metrics/format';
import { dayLabel, describeRange, rangeDays } from '../metrics/range';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Delta, PageHead, Seg, SourceChip, Stat } from '../ui/kit';

type Grain = 'day' | 'week';

export default function Overview() {
  const { engine, range, prev, scope, setScope, openMetric, navigate } = useApp();
  const [grain, setGrain] = useState<Grain>('day');
  const l = engine.core.ladder(range, scope);
  const lp = engine.core.ladder(prev, scope);
  const k = engine.core.storeKpis(range);
  const kp = engine.core.storeKpis(prev);
  const lenses = engine.marketing.channelLenses(range);
  const stamp = engine.marketing.stampCoverage(range);
  const above = (l.merGap ?? 0) >= 0;
  const partial = range.end === engine.cal.today;

  const trend = useMemo(() => {
    const cur = engine.core.dailyRevenue(range, scope);
    const pr = engine.core.dailyRevenue(prev, scope);
    if (grain === 'day' || cur.length < 14) {
      return { labels: cur.map((p) => dayLabel(engine.cal, p.day)), cur: cur.map((p) => p.value), prev: pr.map((p) => (Number.isFinite(p.value) ? p.value : null)) };
    }
    const bucket = (xs: { value: number }[]) => {
      const out: number[] = [];
      for (let i = 0; i < xs.length; i += 7) out.push(xs.slice(i, i + 7).reduce((a, b) => a + (Number.isFinite(b.value) ? b.value : 0), 0));
      return out;
    };
    return { labels: cur.filter((_, i) => i % 7 === 0).map((p) => `wk of ${dayLabel(engine.cal, p.day)}`), cur: bucket(cur), prev: bucket(pr) };
  }, [engine, range, prev, scope, grain]);

  return (
    <>
      <PageHead
        title="Overview"
        sub={`${describeRange(engine.cal, range)} vs previous ${rangeDays(range)} days · click any card for its definition${partial ? ' · today is partial' : ''}`}
        actions={<Seg<Scope> label="Scope" value={scope} onChange={setScope} options={[{ id: 'all', label: 'All channels' }, { id: 'website', label: 'Website only' }]} />}
      />

      {/* Break-even banner: derived from the ladder below, so they always agree */}
      <Card className="accent-top">
        <div className="banner">
          <div className="stat clickable" onClick={() => openMetric('blended_mer')}>
            <div className="label">Blended MER</div>
            <div className={`hero ${above ? '' : 'neg'}`}>{xm(l.blendedMer)}</div>
            <Delta cur={l.blendedMer} prev={lp.blendedMer} />
          </div>
          <div className="stat clickable" onClick={() => openMetric('breakeven_mer')}>
            <div className="label">Break-even MER · measured</div>
            <div className="hero">{xm(l.breakEvenMer)}</div>
            <span className="stat-foot">1 ÷ CM1% ({pct(l.cm1Pct)})</span>
          </div>
          <div>
            <div className="label">Gap</div>
            <div className={`hero ${above ? 'pos' : 'neg'}`}>{l.merGap === null ? '—' : `${l.merGap >= 0 ? '+' : '−'}${Math.abs(l.merGap).toFixed(2)}×`}</div>
            <span className="stat-foot">{above ? 'marketing pays for itself' : 'marketing is not paying for itself'}</span>
          </div>
          <div>
            <div className="label">Revenue needed to break even</div>
            <div className="hero" style={{ fontSize: 26 }}>{inr(l.revenueNeeded)}</div>
            <span className="stat-foot">at current spend of {inr(l.adSpend)} · actual {inr(l.netRevenue)}</span>
          </div>
          <div style={{ alignSelf: 'end' }}>
            {above ? <Badge tone="good">✓ Above break-even</Badge> : <Badge tone="crit">▼ Below break-even</Badge>}
          </div>
        </div>
      </Card>

      <div className="grid split-7-5 mt">
        <Card>
          <CardHead
            title="Contribution ladder — GM → CM1 → CM2"
            sub={`Computed, not estimated · cost coverage ${pct(l.cogsCoverage, 0)} of units · gaps shown, never filled`}
            tools={<SourceChip label="definition" metric="cm1" />}
          />
          <div className="table-wrap">
            <table className="t ladder">
              <tbody>
                {l.lines.map((line) => {
                  const pctOfNet = line.value === null || !l.netRevenue ? null : line.value / l.netRevenue;
                  const prevLine = lp.lines.find((x) => x.key === line.key);
                  return (
                    <tr key={line.key} className={line.kind === 'total' ? 'total' : line.kind === 'gap' ? 'gap' : ''}>
                      <td>{line.label}</td>
                      <td className={`num ${line.key === 'cm2' && (line.value ?? 0) < 0 ? 'neg' : ''}`}>{line.value === null ? 'not set' : inr(line.value)}</td>
                      <td className="num muted">{line.kind === 'total' && line.key !== 'net' && pctOfNet !== null ? pct(pctOfNet) : ''}</td>
                      <td className="num small">{line.kind !== 'gap' && prevLine?.value ? <Delta cur={line.value} prev={prevLine.value} upIsGood={line.kind === 'total'} suffix="" /> : null}</td>
                      <td className="small muted hide-sm">
                        {line.note}
                        {line.realShare !== undefined && line.realShare < 0.999 && <> · {pct(line.realShare, 0)} real charges</>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid g3" style={{ alignContent: 'start' }}>
          <Stat label="Net revenue" source={scope === 'all' ? 'all ch.' : 'Shopify'} metric="net_revenue" value={inr(l.netRevenue)} foot={<Delta cur={l.netRevenue} prev={lp.netRevenue} />} />
          <Stat label="Orders" source="Shopify" metric="orders" value={compact(k.orders)} foot={<Delta cur={k.orders} prev={kp.orders} />} />
          <Stat label="Conversion" source="Shopify" metric="conversion" value={pct(k.conversion, 2)} foot={<Delta cur={k.conversion} prev={kp.conversion} />} />
          <Stat label="Ad spend" source={scope === 'all' ? 'all ads' : 'web ads'} metric="ad_spend" value={inr(l.adSpend)} foot={<Delta cur={l.adSpend} prev={lp.adSpend} upIsGood={false} />} />
          <Stat label="New customers" source="Shopify" metric="new_customers" value={compact(k.newCustomers)} foot={<Delta cur={k.newCustomers} prev={kp.newCustomers} />} />
          <Stat
            label="CAC" source="blended" metric="cac" value={inr(k.cac)}
            foot={stamp !== null && stamp < engine.w.governance.cacCoverageThreshold ? `per-channel CAC blank until coverage ≥ ${pct(engine.w.governance.cacCoverageThreshold, 0)} (now ${pct(stamp, 0)})` : <Delta cur={k.cac} prev={kp.cac} upIsGood={false} />}
          />
        </div>
      </div>

      <Card className="mt">
        <CardHead
          title="Revenue trend"
          sub={`Net revenue per ${grain} · ${scope === 'all' ? 'all channels' : 'website'} · overlay: previous period (previous year needs 13 months of history)`}
          tools={<Seg<Grain> small label="Grain" value={grain} onChange={setGrain} options={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }]} />}
        />
        <LineChart
          ariaLabel="Net revenue trend, current vs previous period"
          labels={trend.labels}
          format={inrShort}
          series={[
            { id: 'prev', label: 'Previous period', color: 'var(--series-prev)', values: trend.prev, muted: true },
            { id: 'cur', label: 'This period', color: 'var(--series-1)', values: trend.cur, area: true },
          ]}
        />
      </Card>

      <Card className="mt">
        <CardHead
          title="Channel ROAS — two lenses, never added together"
          sub="Platform = Meta/Google's own claim (over-claims). Last-click = UTM-stamped Shopify orders (conservative). Truth sits between."
          tools={<button className="btn" onClick={() => navigate('campaigns')}>Campaign verdicts →</button>}
        />
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Channel</th><th className="num">Spend</th><th className="num">Rev · platform</th><th className="num">ROAS · platform</th>
                <th className="num">Rev · last-click</th><th className="num">ROAS · last-click</th><th className="num">Orders (P / LC)</th>
              </tr>
            </thead>
            <tbody>
              {lenses.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="num">{r.spend === null ? '—' : inr(r.spend)}</td>
                  <td className="num">{r.platformRevenue === null ? '—' : inr(r.platformRevenue)}</td>
                  <td className="num">{xm(r.platformRoas)}</td>
                  <td className="num">{inr(r.lcRevenue)}</td>
                  <td className="num">{xm(r.lcRoas)}</td>
                  <td className="num">{r.platformOrders === null ? '—' : compact(r.platformOrders)} / {compact(r.lcOrders)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <BuiltFrom sources={['shopify', 'meta', 'google_ads', 'ga4', 'razorpay', 'shiprocket', 'sku_costs', 'governance', 'amazon_sp', 'blinkit']} />
    </>
  );
}
