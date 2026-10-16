import { useEffect, useMemo, useState } from 'react';
import { ago, inr, pct, xm } from '../metrics/format';
import type { CampaignRow, Verdict } from '../metrics/marketing';
import { dayLabel, describeRange } from '../metrics/range';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Drawer, Empty, Note, PageHead, SourceChip, VERDICT_TONE, exportCsv, useSort } from '../ui/kit';

const PLATFORM_LABEL: Record<string, string> = { meta: 'Meta', google: 'Google', snapchat: 'Snapchat' };

/** Verdict tiles: rule text mirrors the registry definition of `verdict`. */
const VERDICTS: { id: Verdict; label: string; rule: string; top: string }[] = [
  { id: 'SCALE', label: 'Scale', rule: 'above break-even, frequency ≤ 4, ROAS not decaying', top: 'top-good' },
  { id: 'HOLD', label: 'Hold', rule: 'efficient but saturating or decaying, or just below with no lever', top: 'top-warn' },
  { id: 'FIX', label: 'Fix', rule: 'below break-even, one named cause', top: 'top-crit' },
  { id: 'STOP', label: 'Stop', rule: 'below break-even, no single lever', top: 'top-ink' },
  { id: 'BRAND', label: 'Brand / review', rule: 'judged on reach or brand capture, not ROAS', top: 'top-info' },
];

const freq = (v: number | null) => (v === null ? '—' : v.toFixed(1));

export default function Campaigns() {
  const { engine, range, param, navigate } = useApp();
  const rows = engine.marketing.campaigns(range);
  const counts = engine.marketing.verdictCounts(range);
  const stamp = engine.marketing.stampCoverage(range);
  const creatives = engine.marketing.creatives(range);
  const stock = engine.ops.spendVsStock(range);
  const recs = engine.recommendations(range);
  const [filter, setFilter] = useState<Verdict | null>(null);
  const [openId, setOpenId] = useState<string | null>(param);

  // Deep link from search: #/campaigns/<id> opens that campaign's drawer
  useEffect(() => {
    if (param && rows.some((r) => r.campaign.id === param)) setOpenId(param);
  }, [param, rows]);

  // Data-health strip: read the feeds, never assume them
  const feeds = engine.health.feeds();
  const adFeeds = feeds.filter((f) => f.def.id === 'meta' || f.def.id === 'google_ads');
  const lastSync = Math.min(...adFeeds.map((f) => f.run.lastSyncAt ?? 0));
  const latestDay = Math.min(...adFeeds.map((f) => f.run.latestDataDay ?? -Infinity));
  const adFeedsOk = adFeeds.length > 0 && adFeeds.every((f) => f.status === 'ok');
  const dayText = !Number.isFinite(latestDay) ? 'No data' : latestDay === engine.cal.today ? 'Today' : latestDay === engine.cal.today - 1 ? 'Yesterday' : dayLabel(engine.cal, latestDay);
  const withPreview = creatives.filter((c) => Number.isFinite(c.creative.hue)).length;
  const atStake = rows.filter((r) => r.verdict === 'FIX' || r.verdict === 'STOP').reduce((a, r) => a + r.spend, 0);
  const stampOk = stamp !== null && stamp >= engine.w.governance.cacCoverageThreshold;

  const shown = useMemo(() => (filter ? rows.filter((r) => r.verdict === filter) : rows), [rows, filter]);
  const { sorted, header } = useSort<CampaignRow>(shown, {
    name: (r) => r.campaign.name, platform: (r) => r.campaign.platform, verdict: (r) => r.verdict, spend: (r) => r.spend,
    claimed: (r) => r.roasClaimed, lc: (r) => r.roasLastClick, mid: (r) => r.roasMid, attr: (r) => r.attribution,
    ctr: (r) => r.ctr, freq: (r) => r.frequency, dest: (r) => r.campaign.destination,
  });

  const open = rows.find((r) => r.campaign.id === openId) ?? null;
  const openRec = open ? recs.find((x) => x.id.endsWith(`:${open.campaign.id}`)) : undefined;

  // Spend vs stock: same < 10-day rule the STOCK recommendation uses
  const outliving = stock.filter((s) => s.applicable && s.cover !== null && s.cover < 10);
  const noProductSpend = stock.filter((s) => !s.applicable).reduce((a, s) => a + s.spend, 0);

  const csv = () => exportCsv(`campaigns-${range.start}-${range.end}.csv`, [
    ['Campaign', 'Platform', 'Verdict', 'Spend', 'ROAS claimed', 'ROAS last-click', 'ROAS mid', 'Attribution', 'CTR', 'Frequency', 'Destination', 'Working'],
    ...sorted.map((r) => [
      r.campaign.name, PLATFORM_LABEL[r.campaign.platform] ?? r.campaign.platform, r.verdict, Math.round(r.spend),
      r.roasClaimed?.toFixed(2), r.roasLastClick?.toFixed(2), r.roasMid?.toFixed(2), r.attribution?.toFixed(3),
      r.ctr?.toFixed(4), r.frequency?.toFixed(2), r.campaign.destination, r.reasons.join(' | '),
    ]),
  ]);

  return (
    <>
      <PageHead
        title="Campaigns"
        sub={`${describeRange(engine.cal, range)} · every campaign that spent · claimed and last-click ROAS side by side, with attribution coverage between them`}
      />

      {/* Data-health strip first, so nobody reads a verdict off incomplete data */}
      <div className="grid g5">
        <Card className="stat">
          <div className="stat-top">
            <span className="stat-label">Delivery synced</span>
            <span style={{ marginLeft: 'auto' }}><Badge tone={adFeedsOk ? 'good' : 'warn'}>{adFeedsOk ? 'Ingested' : 'Check feeds'}</Badge></span>
          </div>
          <div className="stat-value">{dayText}</div>
          <div className="stat-foot">Meta + Google · synced {lastSync ? ago(engine.w.generatedAt - lastSync) : 'never'} · yesterday or today = up to date</div>
        </Card>
        <Card className="stat">
          <div className="stat-top"><span className="stat-label">Ad-set settings pulled</span></div>
          <div className="stat-value">{rows.length} / {engine.w.campaigns.length}</div>
          <div className="stat-foot">campaigns that spent / configured · budget, goal, attribution pulled</div>
        </Card>
        <Card className="stat">
          <div className="stat-top"><span className="stat-label">Creative preview</span></div>
          <div className="stat-value">{withPreview} / {creatives.length}</div>
          <div className="stat-foot">ads that spent with a stored preview</div>
        </Card>
        <Card className="stat">
          <div className="stat-top">
            <span className="stat-label">Orders with channel stamp</span>
            <span style={{ marginLeft: 'auto' }}><SourceChip label="definition" metric="stamp_coverage" /></span>
          </div>
          <div className="stat-value">{pct(stamp, 0)}</div>
          <div className="stat-foot">
            <Badge tone={stampOk ? 'good' : 'warn'}>{stampOk ? 'Attributed' : 'Partial'}</Badge> caps the last-click lens
          </div>
        </Card>
        <Card className="stat">
          <div className="stat-top"><span className="stat-label">Rupees at stake</span></div>
          <div className="stat-value">{inr(atStake)}</div>
          <div className="stat-foot">spend on FIX + STOP · ranking magnitude, not P&amp;L</div>
        </Card>
      </div>

      {/* Verdict tiles double as the table filter */}
      <div className="grid g5 mt">
        {VERDICTS.map((v) => (
          <Card
            key={v.id}
            className={`stat clickable ${v.top}`}
            onClick={() => setFilter((f) => (f === v.id ? null : v.id))}
            title={filter === v.id ? 'Showing only these · click to clear' : `Show only ${v.id} campaigns`}
          >
            <div className="stat-top">
              <Badge tone={VERDICT_TONE[v.id]}>{v.label}</Badge>
              {filter === v.id && <span className="tiny muted" style={{ marginLeft: 'auto' }}>filtered ✓</span>}
            </div>
            <div className="stat-value">{counts[v.id]}</div>
            <div className="stat-foot">{v.rule}</div>
          </Card>
        ))}
      </div>

      <div className="grid split-8-4 mt">
        <Card>
          <CardHead
            title={filter ? `${filter} campaigns` : 'All campaigns'}
            sub="Click a row for the working · claimed vs last-click are separate lenses, never added"
            tools={
              <>
                {filter && <button className="btn ghost" onClick={() => setFilter(null)}>Clear filter</button>}
                <SourceChip label="verdict rules" metric="verdict" />
                <button className="btn" onClick={csv}>Export CSV</button>
              </>
            }
          />
          {sorted.length === 0 ? (
            <Empty>No campaigns with this verdict in the window.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>{header('Campaign', 'name')}</th>
                    <th>{header('Ch.', 'platform')}</th>
                    <th>{header('Verdict', 'verdict')}</th>
                    <th className="num">{header('Spend', 'spend')}</th>
                    <th className="num">{header('ROAS · claimed', 'claimed')}</th>
                    <th className="num">{header('ROAS · last-click', 'lc')}</th>
                    <th className="num">{header('Mid lens', 'mid')}</th>
                    <th className="num">{header('Attribution', 'attr')}</th>
                    <th className="num">{header('CTR', 'ctr')}</th>
                    <th className="num">{header('Freq', 'freq')}</th>
                    <th>{header('Drives to', 'dest')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.campaign.id} className={`clickable ${openId === r.campaign.id ? 'selected' : ''}`} onClick={() => setOpenId(r.campaign.id)}>
                      <td>{r.campaign.name}</td>
                      <td>{PLATFORM_LABEL[r.campaign.platform] ?? r.campaign.platform}</td>
                      <td><Badge tone={VERDICT_TONE[r.verdict]}>{r.verdict}</Badge>{r.cause && <div className="tiny muted">{r.cause}</div>}</td>
                      <td className="num">{inr(r.spend)}</td>
                      <td className="num">{xm(r.roasClaimed)}</td>
                      <td className="num">{xm(r.roasLastClick)}</td>
                      <td className="num strong">{r.verdict === 'BRAND' ? '—' : xm(r.roasMid)}</td>
                      <td className="num">{pct(r.attribution, 0)}</td>
                      <td className="num">{pct(r.ctr, 2)}</td>
                      <td className={`num ${(r.frequency ?? 0) > 4 ? 'warn-text' : ''}`}>{freq(r.frequency)}</td>
                      <td className="small">{r.campaign.destination ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="tiny muted mt-s">Break-even MER (website, measured): {xm(rows[0]?.breakEven ?? null)} · mid lens = √(claimed × last-click) · attribution = last-click orders ÷ platform-claimed purchases</div>
        </Card>

        <Card>
          <CardHead title="Spend vs stock — by landing page" sub="Cover is warehouse on-hand ÷ 45-day run rate · worst first" tools={<SourceChip label="cover" metric="cover_days" />} />
          {stock.length === 0 ? (
            <Empty>No ads point at a landing page in this window.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr><th>Page</th><th className="num">Spend</th><th className="num">Cover</th><th className="num">Buyable</th></tr>
                </thead>
                <tbody>
                  {stock.map((s) => (
                    <tr key={s.path} title={s.path}>
                      <td>{s.label}<div className="tiny muted">{s.path}</div></td>
                      <td className="num">{inr(s.spend)}</td>
                      <td className={`num ${s.cover !== null && s.cover < 10 ? 'neg strong' : ''}`}>
                        {s.cover === null ? '—' : !Number.isFinite(s.cover) ? 'no sales' : `${Math.round(s.cover)} d`}
                      </td>
                      <td className="num">{s.buyable === null ? 'n/a' : s.buyable ? 'Yes' : <span className="neg">No</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="small muted mt-s">
            {outliving.length === 0 ? 'No product page where spend will outlive the stock.' : `${outliving.length} page${outliving.length === 1 ? '' : 's'} where spend will outlive the stock (under 10 days of cover).`}
            {noProductSpend > 0 && <> · {inr(noProductSpend)} of spend points at bundle or collection pages, where cover does not apply.</>}
          </div>
        </Card>
      </div>

      <BuiltFrom sources={['meta', 'google_ads', 'snapchat', 'shopify', 'ga4', 'wms']} />

      {open && (
        <Drawer
          title={open.campaign.name}
          onClose={() => setOpenId(null)}
          actions={<button className="btn primary" onClick={() => navigate('recommendations', openRec?.id ?? null)}>Record decision →</button>}
        >
          <div className="row">
            <Badge tone={VERDICT_TONE[open.verdict]}>{open.verdict}</Badge>
            {open.cause && <Badge tone="neutral">cause: {open.cause}</Badge>}
            <span className="small muted">{PLATFORM_LABEL[open.campaign.platform] ?? open.campaign.platform} · {open.campaign.objective.replace(/_/g, ' ')}</span>
          </div>

          <h3 className="mt" style={{ fontSize: 13 }}>The working</h3>
          <Note>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {open.reasons.map((x, i) => <li key={i} style={{ margin: '2px 0' }}>{x}</li>)}
            </ol>
          </Note>

          <table className="def-table mt">
            <tbody>
              <tr><td>Spend</td><td className="num">{inr(open.spend)}</td></tr>
              <tr><td>ROAS · claimed</td><td className="num">{xm(open.roasClaimed)} <span className="muted small">({inr(open.claimedRevenue)} on {Math.round(open.claimedPurchases)} purchases)</span></td></tr>
              <tr><td>ROAS · last-click</td><td className="num">{xm(open.roasLastClick)} <span className="muted small">({inr(open.lcRevenue)} on {open.lcOrders} orders)</span></td></tr>
              <tr><td>Mid lens</td><td className="num">{xm(open.roasMid)} <span className="muted small">vs break-even {xm(open.breakEven)}</span></td></tr>
              <tr><td>Attribution</td><td>{pct(open.attribution, 0)} of claimed purchases seen last-click</td></tr>
              <tr><td>Trend</td><td>{open.trend === null ? 'needs ≥ 14 days of window' : `${pct(open.trend, 0, true)} last-click ROAS week on week`}</td></tr>
              <tr><td>Impressions</td><td className="num">{open.impressions.toLocaleString('en-IN')} · reach {open.reach.toLocaleString('en-IN')}</td></tr>
              <tr><td>Frequency</td><td>{freq(open.frequency)}{(open.frequency ?? 0) > 4 ? ' · above 4, saturating' : ''}</td></tr>
              <tr><td>CTR · CPM · CPC</td><td>{pct(open.ctr, 2)} · {inr(open.cpm)} · {inr(open.cpc)}</td></tr>
              <tr><td>Click-to-order</td><td>{pct(open.cvr, 2)}</td></tr>
              <tr><td>Destination</td><td>{open.campaign.destination ?? '—'}</td></tr>
              <tr><td>Intent tag</td><td>{open.campaign.intentTag ? open.campaign.intentTag.replace('_', '-') : 'not declared'}</td></tr>
              <tr><td>Running since</td><td>{dayLabel(engine.cal, open.campaign.startDay, true)}</td></tr>
            </tbody>
          </table>
          <div className="small muted mt">
            {openRec ? 'A recommendation is open for this campaign; recording a decision is a sign-off for a person to act in the ad platform.' : 'No recommendation is open for this campaign in this window.'}
          </div>
        </Drawer>
      )}
    </>
  );
}
