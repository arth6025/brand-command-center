import { useMemo, useState } from 'react';
import { LineChart } from '../charts/LineChart';
import { MerGauge, Waterfall3D, type WfStep } from '../charts/Waterfall3D';
import type { Scope } from '../metrics/core';
import { compact, inr, inrShort, pct, xm } from '../metrics/format';
import { type DateRange, dayLabel, describeRange, rangeDays } from '../metrics/range';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Delta, PageHead, Seg, SourceChip, Stat, type Tone } from '../ui/kit';
import { CountUp } from '../ui/motion';

type Grain = 'day' | 'week';

const REC_TONE: Record<string, Tone> = { SPEND: 'crit', SETUP: 'warn', CREATIVE: 'info', MEASUREMENT: 'neutral', STOCK: 'crit' };

export default function Overview() {
  const { engine, range, prev, scope, setScope, openMetric, navigate, decisions } = useApp();
  const [grain, setGrain] = useState<Grain>('day');
  const l = engine.core.ladder(range, scope);
  const lp = engine.core.ladder(prev, scope);
  const k = engine.core.storeKpis(range);
  const kp = engine.core.storeKpis(prev);
  const lenses = engine.marketing.channelLenses(range);
  const stamp = engine.marketing.stampCoverage(range);
  const above = (l.merGap ?? 0) >= 0;
  const partial = range.end === engine.cal.today;
  const recs = engine.recommendations(range).filter((r) => !decisions.some((d) => d.recId === r.id));
  const fixSpend = engine.marketing.campaigns(range).filter((c) => c.verdict === 'FIX' || c.verdict === 'STOP').reduce((a, c) => a + c.spend, 0);

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

  // Per-day KPI series for the tile sparklines (at most 30 points)
  const sparks = useMemo(() => {
    const days: DateRange[] = [];
    const span = range.end - range.start + 1;
    const step = Math.max(1, Math.ceil(span / 30));
    for (let d = range.start; d <= range.end; d += step) days.push({ preset: 'custom', start: d, end: Math.min(range.end, d + step - 1) });
    const ks = days.map((r) => engine.core.storeKpis(r));
    const ls = days.map((r) => engine.core.ladder(r, scope));
    return {
      net: ls.map((x) => x.netRevenue), spend: ls.map((x) => x.adSpend), orders: ks.map((x) => x.orders),
      conv: ks.map((x) => x.conversion ?? NaN), nc: ks.map((x) => x.newCustomers), cac: ks.map((x) => x.cac ?? NaN),
    };
  }, [engine, range, scope]);

  const steps: WfStep[] = [
    { key: 'net', label: 'Revenue', value: l.netRevenue, kind: 'total' },
    { key: 'cogs', label: 'COGS', value: l.cogs, kind: 'deduct' },
    { key: 'log', label: 'Logistics', value: l.freight + l.rto + l.paymentFees + (l.packaging ?? 0), kind: 'deduct' },
    ...(scope === 'all' ? [{ key: 'mkt', label: 'Mkt fees', value: l.marketplaceFees, kind: 'deduct' as const }] : []),
    { key: 'cm1', label: 'CM1', value: l.cm1, kind: 'total' },
    { key: 'ads', label: 'Ads', value: l.adSpend, kind: 'deduct' },
    { key: 'cm2', label: 'CM2', value: l.cm2, kind: 'total' },
  ];

  return (
    <>
      <PageHead
        title="Overview"
        sub={`${describeRange(engine.cal, range)} vs previous ${rangeDays(range)} days${partial ? ' · today is partial' : ''}`}
        actions={<Seg<Scope> label="Scope" value={scope} onChange={setScope} options={[{ id: 'all', label: 'All channels' }, { id: 'website', label: 'Website only' }]} />}
      />

      {/* Answer first: the verdict, the gauge behind it, and what to do next */}
      <div className="brief">
        <Card className="hero-card accent-top">
          <span className="eyebrow">Today's brief · {scope === 'all' ? 'all channels' : 'website'}</span>
          <p className="headline">
            {above ? <>Marketing is <em>paying for itself</em></> : <>Marketing is <em>below break-even</em></>}: blended MER {xm(l.blendedMer)} against a break-even of {xm(l.breakEvenMer)}.
            {fixSpend > 0 && <> {inrShort(fixSpend)} of spend sits in campaigns to fix or stop.</>}
          </p>
          <div className="grid g2" style={{ alignItems: 'center', gap: 18 }}>
            <MerGauge mer={l.blendedMer} breakEven={l.breakEvenMer} />
            <div className="mer-row" style={{ marginTop: 0 }}>
              <div className="stat clickable" onClick={() => openMetric('blended_mer')}>
                <div className="label">Blended MER</div>
                <div className={`hero ${above ? '' : 'neg'}`}><CountUp value={xm(l.blendedMer)} /></div>
                <Delta cur={l.blendedMer} prev={lp.blendedMer} />
              </div>
              <div className="stat clickable" onClick={() => openMetric('breakeven_mer')}>
                <div className="label">Break-even</div>
                <div className="hero" style={{ fontSize: 26 }}><CountUp value={xm(l.breakEvenMer)} /></div>
                <span className="stat-foot">1 ÷ CM1% ({pct(l.cm1Pct)})</span>
              </div>
              <div>
                <div className="label">Revenue needed at {inrShort(l.adSpend)} spend</div>
                <div className="row"><span className="strong" style={{ fontSize: 16 }}>{inr(l.revenueNeeded)}</span>{above ? <Badge tone="good">Above</Badge> : <Badge tone="crit">Below</Badge>}</div>
              </div>
            </div>
          </div>
          <div className="actions-list">
            {recs.slice(0, 3).map((r) => (
              <button key={r.id} className="action-item" onClick={() => navigate('recommendations', r.id)}>
                <Badge tone={REC_TONE[r.type]}>{r.type}</Badge>
                <span style={{ minWidth: 0 }}>
                  <div className="ai-title">{r.title}</div>
                  <div className="ai-sub">Suggested: {r.suggested}</div>
                </span>
                <span className="row" style={{ flexWrap: 'nowrap' }}><span className="ai-amt">{inrShort(r.atStake)}</span><span className="arrow">→</span></span>
              </button>
            ))}
            {recs.length > 3 && <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('recommendations')}>{recs.length - 3} more recommendations →</button>}
          </div>
        </Card>

        <Card>
          <CardHead
            title="Where every rupee goes"
            sub="Net revenue down to CM2, to scale · move the cursor to turn it"
            tools={<SourceChip label="definition" metric="cm2" />}
          />
          <Waterfall3D steps={steps} base={l.netRevenue} />
          <div className="grid g3 mt" style={{ marginTop: 44 }}>
            <div><div className="small soft">GM</div><div className="strong">{inr(l.gm)} <span className="muted small">{pct(l.gm / (l.netRevenue || 1))}</span></div></div>
            <div><div className="small soft">CM1</div><div className="strong">{inr(l.cm1)} <span className="muted small">{pct(l.cm1Pct)}</span></div></div>
            <div><div className="small soft">CM2</div><div className={`strong ${l.cm2 < 0 ? 'neg' : ''}`}>{inr(l.cm2)} <span className="muted small">{pct(l.cm2 / (l.netRevenue || 1))}</span></div></div>
          </div>
        </Card>
      </div>

      <div className="grid g6 mt">
        <Stat label="Net revenue" source={scope === 'all' ? 'all ch.' : 'Shopify'} metric="net_revenue" value={inr(l.netRevenue)} spark={sparks.net} foot={<Delta cur={l.netRevenue} prev={lp.netRevenue} />} />
        <Stat label="Orders" source="Shopify" metric="orders" value={compact(k.orders)} spark={sparks.orders} foot={<Delta cur={k.orders} prev={kp.orders} />} />
        <Stat label="Conversion" source="Shopify" metric="conversion" value={pct(k.conversion, 2)} spark={sparks.conv} foot={<Delta cur={k.conversion} prev={kp.conversion} />} />
        <Stat label="Ad spend" source={scope === 'all' ? 'all ads' : 'web ads'} metric="ad_spend" value={inr(l.adSpend)} spark={sparks.spend} foot={<Delta cur={l.adSpend} prev={lp.adSpend} upIsGood={false} />} />
        <Stat label="New customers" source="Shopify" metric="new_customers" value={compact(k.newCustomers)} spark={sparks.nc} foot={<Delta cur={k.newCustomers} prev={kp.newCustomers} />} />
        <Stat
          label="CAC" source="blended" metric="cac" value={inr(k.cac)} spark={sparks.cac}
          foot={stamp !== null && stamp < engine.w.governance.cacCoverageThreshold ? `per-channel CAC blank until coverage ≥ ${pct(engine.w.governance.cacCoverageThreshold, 0)}` : <Delta cur={k.cac} prev={kp.cac} upIsGood={false} />}
        />
      </div>

      <div className="grid split-7-5 mt">
        <Card>
          <CardHead
            title="Revenue trend"
            sub={`Net revenue per ${grain} · ${scope === 'all' ? 'all channels' : 'website'} · vs previous period`}
            tools={<Seg<Grain> small label="Grain" value={grain} onChange={setGrain} options={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }]} />}
          />
          <LineChart
            ariaLabel="Net revenue trend, current vs previous period"
            labels={trend.labels}
            format={inrShort}
            height={250}
            series={[
              { id: 'prev', label: 'Previous period', color: 'var(--series-prev)', values: trend.prev, muted: true },
              { id: 'cur', label: 'This period', color: 'var(--series-1)', values: trend.cur, area: true },
            ]}
          />
        </Card>

        <Card>
          <CardHead
            title="Contribution ladder"
            sub={`Computed, not estimated · ${pct(l.cogsCoverage, 0)} of units costed · gaps shown, never filled`}
            tools={<SourceChip label="definition" metric="cm1" />}
          />
          <div className="table-wrap">
            <table className="t ladder">
              <tbody>
                {l.lines.map((line) => {
                  const prevLine = lp.lines.find((x) => x.key === line.key);
                  return (
                    <tr key={line.key} className={line.kind === 'total' ? 'total' : line.kind === 'gap' ? 'gap' : ''} title={line.note}>
                      <td>{line.label}</td>
                      <td className={`num ${line.key === 'cm2' && (line.value ?? 0) < 0 ? 'neg' : ''}`}>{line.value === null ? 'not set' : inr(line.value)}</td>
                      <td className="num muted">{line.kind === 'total' && line.key !== 'net' && line.value !== null && l.netRevenue ? pct(line.value / l.netRevenue) : ''}</td>
                      <td className="num small hide-sm">{line.kind !== 'gap' && prevLine?.value ? <Delta cur={line.value} prev={prevLine.value} upIsGood={line.kind === 'total'} suffix="" /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>Hover a line for how it is computed. Packaging is not set, so true break-even is slightly higher.</p>
        </Card>
      </div>

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
