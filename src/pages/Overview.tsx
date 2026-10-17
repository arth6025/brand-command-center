import { useMemo, useState } from 'react';
import { LineChart, type Series } from '../charts/LineChart';
import { MerGauge, Waterfall3D, type WfStep } from '../charts/Waterfall3D';
import type { BridgeStep, Scope } from '../metrics/core';
import { compact, inr, inrShort, pct, xm } from '../metrics/format';
import { type DateRange, dayLabel, describeRange, rangeDays } from '../metrics/range';
import { type RouteId, useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Delta, PageHead, Seg, SourceChip, Stat, type Tone } from '../ui/kit';
import { CountUp } from '../ui/motion';

type Grain = 'day' | 'week';
type DetailTab = 'trend' | 'ladder' | 'lenses';

/** Channel groups the Overview focuses on; colours are fixed per group. */
const GROUPS: { id: Scope; label: string; color: string; hint: string }[] = [
  { id: 'all', label: 'All channels', color: 'var(--accent)', hint: 'whole business' },
  { id: 'website', label: 'D2C website', color: 'var(--c-1)', hint: 'Shopify storefront' },
  { id: 'marketplace', label: 'Marketplaces', color: 'var(--c-2)', hint: 'Amazon · Flipkart · Nykaa · Myntra' },
  { id: 'qc', label: 'Quick commerce', color: 'var(--c-3)', hint: 'Blinkit · Zepto · Instamart' },
];

interface ActionItem { id: string; tone: Tone; tag: string; title: string; sub: string; amount: number; route: RouteId; param?: string }

/** Where each lever drills down, per channel group. */
const DRILL: Record<BridgeStep['key'], Partial<Record<Scope, RouteId>> & { default: RouteId }> = {
  demand: { default: 'quick-commerce', website: 'funnel', marketplace: 'amazon' },
  gm: { default: 'trading' },
  logistics: { default: 'fulfilment' },
  mkt: { default: 'quick-commerce', marketplace: 'amazon' },
  ads: { default: 'campaigns', marketplace: 'amazon', qc: 'quick-commerce' },
};

export default function Overview() {
  const { engine, range, prev, scope, setScope, openMetric, navigate, decisions } = useApp();
  const [grain, setGrain] = useState<Grain>('day');
  const [view, setView] = useState<'levers' | 'flow'>('levers');
  const [detail, setDetail] = useState<DetailTab>('trend');
  const group = GROUPS.find((g) => g.id === scope) ?? GROUPS[0];
  const l = engine.core.ladder(range, scope);
  const lp = engine.core.ladder(prev, scope);
  const above = (l.merGap ?? 0) >= 0;
  const partial = range.end === engine.cal.today;
  const rawBridge = engine.core.cm2Bridge(range, prev, scope);
  // Hide levers that don't apply to this channel group (zero before and now)
  const bridge = { ...rawBridge, steps: rawBridge.steps.filter((s) => s.value !== 0 || s.now !== 0 || s.before !== 0) };

  const tabs = GROUPS.map((g) => {
    const lg = engine.core.ladder(range, g.id);
    const lgp = engine.core.ladder(prev, g.id);
    return { ...g, net: lg.netRevenue, prevNet: lgp.netRevenue, cm2Pct: lg.netRevenue ? lg.cm2 / lg.netRevenue : null };
  });
  const totalNet = tabs[0].net;

  const actions = useMemo<ActionItem[]>(() => buildActions(engine, range, scope, decisions.map((d) => d.recId)), [engine, range, scope, decisions]);
  const tiles = useMemo(() => buildTiles(engine, range, prev, scope), [engine, range, prev, scope]);

  const trend = useMemo(() => {
    // Portal reports land a day late: today's empty value is missing data, not zero sales
    const clip = (pts: { day: number; value: number }[]) => pts.map((p) => (p.day === engine.cal.today && p.value === 0 ? NaN : p.value));
    const bucket = (xs: number[]) => {
      if (grain === 'day' || xs.length < 14) return xs;
      const out: number[] = [];
      for (let i = 0; i < xs.length; i += 7) out.push(xs.slice(i, i + 7).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0));
      return out;
    };
    const days = engine.core.dailyRevenue(range, scope);
    const labels = grain === 'day' || days.length < 14 ? days.map((p) => dayLabel(engine.cal, p.day)) : days.filter((_, i) => i % 7 === 0).map((p) => `wk of ${dayLabel(engine.cal, p.day)}`);
    let series: Series[];
    if (scope === 'all') {
      // One line per channel group, in its fixed colour
      series = GROUPS.slice(1).map((g) => ({ id: g.id, label: g.label, color: g.color, values: bucket(clip(engine.core.dailyRevenue(range, g.id))) }));
    } else {
      series = [
        { id: 'prev', label: 'Previous period', color: 'var(--series-prev)', values: bucket(engine.core.dailyRevenue(prev, scope).map((p) => p.value)), muted: true },
        { id: 'cur', label: 'This period', color: group.color, values: bucket(clip(days)), area: true },
      ];
    }
    return { labels, series };
  }, [engine, range, prev, scope, grain, group.color]);

  const flowSteps: WfStep[] = [
    { key: 'net', label: 'Revenue', value: l.netRevenue, kind: 'total' },
    { key: 'cogs', label: 'COGS', value: l.cogs, kind: 'deduct' },
    ...(scope === 'all' || scope === 'website' ? [{ key: 'log', label: 'Logistics', value: l.freight + l.rto + l.paymentFees + (l.packaging ?? 0), kind: 'deduct' as const }] : []),
    ...(scope !== 'website' ? [{ key: 'mkt', label: 'Mkt fees', value: l.marketplaceFees, kind: 'deduct' as const }] : []),
    { key: 'cm1', label: 'CM1', value: l.cm1, kind: 'total' },
    { key: 'ads', label: 'Ads', value: l.adSpend, kind: 'deduct' },
    { key: 'cm2', label: 'CM2', value: l.cm2, kind: 'total' },
  ];
  const maxStep = Math.max(1, ...bridge.steps.map((s) => Math.abs(s.value)));
  const delta = bridge.to - bridge.from;

  return (
    <>
      <PageHead title="Overview" sub={`${describeRange(engine.cal, range)} vs previous ${rangeDays(range)} days${partial ? ' · today is partial' : ''}`} />

      {/* Channel tabs double as the channel mix */}
      <div className="ch-tabs" role="tablist" aria-label="Channel">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === scope} className="ch-tab" style={{ ['--ch' as string]: t.color }} onClick={() => setScope(t.id)}>
            <span className="ch-name"><span className="ch-dot" />{t.label}</span>
            <span className="ch-val"><CountUp value={inr(t.net)} /></span>
            <span className="ch-meta">
              {t.id === 'all' ? <span>{t.hint}</span> : <span>{pct(totalNet ? t.net / totalNet : 0, 0)} of revenue</span>}
              <span>CM2 {pct(t.cm2Pct, 0)}</span>
              <Delta cur={t.net} prev={t.prevNet} suffix="" />
            </span>
            {t.id !== 'all' && <span className="ch-share"><i style={{ width: `${(totalNet ? t.net / totalNet : 0) * 100}%` }} /></span>}
          </button>
        ))}
      </div>

      <div className="brief">
        {/* Answer first: the verdict and what to do next */}
        <Card className="hero-card accent-top">
          <span className="eyebrow">Brief · {group.label.toLowerCase()}</span>
          <p className="headline">
            {above ? <>Marketing is <em>paying for itself</em></> : <>Marketing is <em>below break-even</em></>}: MER {xm(l.blendedMer)} against a break-even of {xm(l.breakEvenMer)}.
            {' '}CM2 {delta >= 0 ? 'rose' : 'fell'} {inrShort(Math.abs(delta))} to {inrShort(l.cm2)}.
          </p>
          <div className="grid g2" style={{ alignItems: 'center', gap: 18 }}>
            <MerGauge mer={l.blendedMer} breakEven={l.breakEvenMer} />
            <div className="mer-row" style={{ marginTop: 0 }}>
              <div className="stat clickable" onClick={() => openMetric('blended_mer')}>
                <div className="label">MER</div>
                <div className={`hero ${above ? '' : 'neg'}`}><CountUp value={xm(l.blendedMer)} /></div>
                <Delta cur={l.blendedMer} prev={lp.blendedMer} />
              </div>
              <div className="stat clickable" onClick={() => openMetric('breakeven_mer')}>
                <div className="label">Break-even</div>
                <div className="hero" style={{ fontSize: 26 }}><CountUp value={xm(l.breakEvenMer)} /></div>
                <span className="stat-foot">1 ÷ CM1% ({pct(l.cm1Pct)})</span>
              </div>
            </div>
          </div>
          <div className="actions-list">
            {actions.length === 0 && <div className="small muted">Nothing needs a decision in this channel right now.</div>}
            {actions.slice(0, 3).map((a) => (
              <button key={a.id} className="action-item" onClick={() => navigate(a.route, a.param ?? null)}>
                <Badge tone={a.tone}>{a.tag}</Badge>
                <span style={{ minWidth: 0 }}>
                  <div className="ai-title">{a.title}</div>
                  <div className="ai-sub">{a.sub}</div>
                </span>
                <span className="row" style={{ flexWrap: 'nowrap' }}>{a.amount > 0 && <span className="ai-amt">{inrShort(a.amount)}</span>}<span className="arrow">→</span></span>
              </button>
            ))}
          </div>
        </Card>

        {/* Levers: what moved CM2, or the rupee flow in 3D */}
        <Card>
          <CardHead
            title={view === 'levers' ? 'What moved CM2' : 'Where every rupee goes'}
            sub={view === 'levers' ? `vs previous ${rangeDays(range)} days · each lever links to its screen` : 'Revenue down to CM2, to scale · move the cursor to turn it'}
            tools={<Seg<'levers' | 'flow'> small label="View" value={view} onChange={setView} options={[{ id: 'levers', label: 'Levers' }, { id: 'flow', label: 'Rupee flow' }]} />}
          />
          {view === 'levers' ? (
            <div className="bridge">
              <div className="bridge-row total" style={{ borderTop: 0, marginTop: 0 }}>
                <span><div className="b-label">CM2 before</div><div className="b-sub">previous period</div></span>
                <span className="b-track" />
                <span className="b-val">{inrShort(bridge.from)}</span>
              </div>
              {bridge.steps.map((s, i) => (
                <button key={s.key} className="bridge-row" onClick={() => navigate(DRILL[s.key][scope] ?? DRILL[s.key].default)} title="Open the screen behind this lever">
                  <span>
                    <div className="b-label">{s.label}</div>
                    <div className="b-sub">{s.unit === 'pct' ? `${pct(s.before)} → ${pct(s.now)} of revenue` : `${inrShort(s.before)} → ${inrShort(s.now)}`}</div>
                  </span>
                  <span className="b-track">
                    <span className={`b-bar ${s.value >= 0 ? 'up' : 'down'}`} style={{ width: `${(Math.abs(s.value) / maxStep) * 50}%`, animationDelay: `${i * 0.08}s` }} />
                  </span>
                  <span className={`b-val ${s.value >= 0 ? 'pos' : 'neg'}`}>{s.value >= 0 ? '+' : '−'}{inrShort(Math.abs(s.value))}</span>
                </button>
              ))}
              <div className="bridge-row total">
                <span><div className="b-label">CM2 now</div><div className="b-sub">{pct(l.netRevenue ? l.cm2 / l.netRevenue : 0)} of revenue</div></span>
                <span className="b-track" />
                <span className={`b-val ${bridge.to < 0 ? 'neg' : ''}`}>{inrShort(bridge.to)}</span>
              </div>
              <p className="tiny muted" style={{ margin: '6px 8px 0' }}>Demand = revenue change at the old CM1 rate; the rate levers apply today's revenue to the change in each cost rate. The bars add up exactly to the CM2 change.</p>
            </div>
          ) : (
            <>
              <Waterfall3D steps={flowSteps} base={l.netRevenue} />
              <div style={{ height: 40 }} />
            </>
          )}
        </Card>
      </div>

      <div className="grid g4 mt">
        {tiles.map((t) => <Stat key={t.label} {...t} />)}
      </div>

      <Card className="mt">
        <div className="tabs" role="tablist" aria-label="Detail">
          {([['trend', 'Revenue trend'], ['ladder', 'Contribution ladder'], ...(scope === 'all' || scope === 'website' ? [['lenses', 'Channel ROAS']] : [])] as [DetailTab, string][]).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={detail === id} onClick={() => setDetail(id)}>{label}</button>
          ))}
        </div>
        {detail === 'trend' && (
          <>
            <CardHead
              title={scope === 'all' ? 'Net revenue by channel' : `${group.label} net revenue`}
              sub={scope === 'all' ? `Per ${grain} · one line per channel group` : `Per ${grain} · vs previous period`}
              tools={<Seg<Grain> small label="Grain" value={grain} onChange={setGrain} options={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }]} />}
            />
            <LineChart ariaLabel="Net revenue trend" labels={trend.labels} format={inrShort} height={260} series={trend.series} />
          </>
        )}
        {(detail === 'ladder' || (detail === 'lenses' && scope !== 'all' && scope !== 'website')) && (
          <>
            <CardHead title="Contribution ladder" sub={`Computed, not estimated · ${pct(l.cogsCoverage, 0)} of units costed · gaps shown, never filled`} tools={<SourceChip label="definition" metric="cm1" />} />
            <div className="table-wrap">
              <table className="t ladder">
                <tbody>
                  {l.lines.map((line) => {
                    const prevLine = lp.lines.find((x) => x.key === line.key);
                    return (
                      <tr key={line.key} className={line.kind === 'total' ? 'total' : line.kind === 'gap' ? 'gap' : ''}>
                        <td>{line.label}</td>
                        <td className={`num ${line.key === 'cm2' && (line.value ?? 0) < 0 ? 'neg' : ''}`}>{line.value === null ? 'not set' : inr(line.value)}</td>
                        <td className="num muted">{line.kind === 'total' && line.key !== 'net' && line.value !== null && l.netRevenue ? pct(line.value / l.netRevenue) : ''}</td>
                        <td className="num small hide-sm">{line.kind !== 'gap' && prevLine?.value ? <Delta cur={line.value} prev={prevLine.value} upIsGood={line.kind === 'total'} suffix="" /> : null}</td>
                        <td className="small muted hide-sm">{line.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {detail === 'lenses' && (scope === 'all' || scope === 'website') && <Lenses />}
      </Card>

      <BuiltFrom sources={['shopify', 'meta', 'google_ads', 'ga4', 'razorpay', 'shiprocket', 'sku_costs', 'amazon_sp', 'blinkit', 'zepto', 'instamart']} />
    </>
  );
}

function Lenses() {
  const { engine, range, navigate } = useApp();
  const lenses = engine.marketing.channelLenses(range);
  return (
    <>
      <CardHead
        title="Channel ROAS — two lenses, never added together"
        sub="Platform = Meta/Google's own claim (over-claims). Last-click = UTM-stamped Shopify orders (conservative). Truth sits between."
        tools={<button className="btn" onClick={() => navigate('campaigns')}>Campaign verdicts →</button>}
      />
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr><th>Channel</th><th className="num">Spend</th><th className="num">Rev · platform</th><th className="num">ROAS · platform</th><th className="num">Rev · last-click</th><th className="num">ROAS · last-click</th><th className="num">Orders (P / LC)</th></tr>
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
    </>
  );
}

type EngineT = ReturnType<typeof useApp>['engine'];

/** The few decisions that matter for the selected channel group. */
function buildActions(engine: EngineT, range: DateRange, scope: Scope, decided: string[]): ActionItem[] {
  const out: ActionItem[] = [];
  const recTone: Record<string, Tone> = { SPEND: 'crit', SETUP: 'warn', CREATIVE: 'info', MEASUREMENT: 'neutral', STOCK: 'crit' };
  if (scope === 'all' || scope === 'website') {
    for (const r of engine.recommendations(range)) {
      if (decided.includes(r.id)) continue;
      out.push({ id: r.id, tone: recTone[r.type], tag: r.type, title: r.title, sub: `Suggested: ${r.suggested}`, amount: r.atStake, route: 'recommendations', param: r.id });
    }
  }
  if (scope === 'all' || scope === 'marketplace') {
    const az = engine.channels.amazon(range);
    if (az.claims.expiring > 0) out.push({ id: 'az-claims', tone: 'warn', tag: 'CLAIMS', title: `${az.claims.expiringCount} Amazon claims expire in 14 days`, sub: 'File reimbursement claims before the 6-month window closes', amount: az.claims.expiring, route: 'amazon' });
    if (az.inventory.lostSales > 0) out.push({ id: 'az-oos', tone: 'crit', tag: 'STOCK', title: 'Serum stock-out cost Amazon sales', sub: 'Replenish FBA before the next sale event', amount: az.inventory.lostSales, route: 'amazon' });
  }
  if (scope === 'all' || scope === 'qc') {
    const worst = engine.channels.darkStores()[0];
    if (worst && (worst.heroInStock ?? 1) < 0.75) out.push({ id: 'qc-avail', tone: 'crit', tag: 'AVAILABILITY', title: `Serum in stock at ${pct(worst.heroInStock, 0)} of ${worst.city} dark stores`, sub: `PO fill rate ${pct(worst.fillRate, 0)}: chase the open POs`, amount: 0, route: 'quick-commerce' });
    const stale = engine.health.feeds().filter((f) => f.status === 'stale');
    for (const f of stale) out.push({ id: `stale-${f.def.id}`, tone: 'warn', tag: 'DATA', title: `${f.def.name} is ${f.lagDays} days stale`, sub: 'Its CM2 row is missing the latest days', amount: 0, route: 'health' });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** Four KPI tiles per channel group, each with its own identity colour. */
function buildTiles(engine: EngineT, range: DateRange, prev: DateRange, scope: Scope) {
  const span = range.end - range.start + 1;
  const step = Math.max(1, Math.ceil(span / 30));
  const buckets: DateRange[] = [];
  for (let d = range.start; d <= range.end; d += step) buckets.push({ preset: 'custom', start: d, end: Math.min(range.end, d + step - 1) });
  const lad = (s: Scope) => buckets.map((b) => engine.core.ladder(b, s));
  const l = engine.core.ladder(range, scope);
  const lp = engine.core.ladder(prev, scope);
  const netTile = { label: 'Net revenue', source: scope === 'qc' ? 'sell-in' : 'computed', metric: 'net_revenue', value: inr(l.netRevenue), color: 'var(--c-1)', spark: lad(scope).map((x) => x.netRevenue), foot: <Delta cur={l.netRevenue} prev={lp.netRevenue} /> };

  if (scope === 'website') {
    const k = engine.core.storeKpis(range), kp = engine.core.storeKpis(prev);
    const ks = buckets.map((b) => engine.core.storeKpis(b));
    return [
      netTile,
      { label: 'Orders', source: 'Shopify', metric: 'orders', value: compact(k.orders), color: 'var(--c-3)', spark: ks.map((x) => x.orders), foot: <Delta cur={k.orders} prev={kp.orders} /> },
      { label: 'Conversion', source: 'Shopify', metric: 'conversion', value: pct(k.conversion, 2), color: 'var(--c-6)', spark: ks.map((x) => x.conversion ?? NaN), foot: <Delta cur={k.conversion} prev={kp.conversion} /> },
      { label: 'CAC', source: 'blended', metric: 'cac', value: inr(k.cac), color: 'var(--c-4)', spark: ks.map((x) => x.cac ?? NaN), foot: <Delta cur={k.cac} prev={kp.cac} upIsGood={false} /> },
    ];
  }
  if (scope === 'marketplace' || scope === 'qc') {
    const g = engine.core.groupKpis(range, scope), gp = engine.core.groupKpis(prev, scope);
    const gs = buckets.map((b) => engine.core.groupKpis(b, scope));
    const units = { label: scope === 'qc' ? 'Units sold through' : 'Units', source: scope === 'qc' ? 'portals' : 'SP-API', value: compact(g.units), color: 'var(--c-3)', spark: gs.map((x) => x.units), foot: <Delta cur={g.units} prev={gp.units} /> };
    if (scope === 'marketplace') {
      return [
        netTile, units,
        { label: 'Fees % of revenue', source: 'settlements', metric: 'cm2_channel', value: pct(g.commissionRate), color: 'var(--c-2)', spark: gs.map((x) => x.commissionRate ?? NaN), foot: <Delta cur={g.commissionRate} prev={gp.commissionRate} upIsGood={false} /> },
        { label: 'Ad spend', source: `ACoS ${pct(g.acos, 0)}`, metric: 'ad_spend', value: inr(g.ads), color: 'var(--c-5)', spark: gs.map((x) => x.ads), foot: <Delta cur={g.ads} prev={gp.ads} upIsGood={false} /> },
      ];
    }
    const ds = engine.channels.darkStores();
    const avail = ds.reduce((a, d) => a + d.inStock, 0) / (ds.length || 1);
    const fill = ds.reduce((a, d) => a + (d.fillRate ?? 0), 0) / (ds.length || 1);
    return [
      netTile, units,
      { label: 'Ad ROAS', source: 'portals', metric: 'ad_spend', value: xm(g.adRoas), color: 'var(--c-2)', spark: gs.map((x) => x.adRoas ?? NaN), foot: <span>{inr(g.ads)} spend</span> },
      { label: 'Dark-store availability', source: 'snapshot', value: pct(avail, 0), color: 'var(--c-4)', foot: <span>PO fill rate {pct(fill, 0)} · last 30 days</span> },
    ];
  }
  // All channels
  const k = engine.core.storeKpis(range), kp = engine.core.storeKpis(prev);
  return [
    netTile,
    { label: 'CM2', source: 'computed', metric: 'cm2', value: inr(l.cm2), color: 'var(--c-3)', spark: lad('all').map((x) => x.cm2), foot: <Delta cur={l.cm2} prev={lp.cm2} /> },
    { label: 'Ad spend', source: 'all ads', metric: 'ad_spend', value: inr(l.adSpend), color: 'var(--c-2)', spark: lad('all').map((x) => x.adSpend), foot: <Delta cur={l.adSpend} prev={lp.adSpend} upIsGood={false} /> },
    { label: 'New customers', source: 'Shopify', metric: 'new_customers', value: compact(k.newCustomers), color: 'var(--c-5)', spark: buckets.map((b) => engine.core.storeKpis(b).newCustomers), foot: <Delta cur={k.newCustomers} prev={kp.newCustomers} /> },
  ];
}
