import { useMemo, useState } from 'react';
import type { Creative, CreativeFormat, CreativeQaFlag } from '../domain/types';
import { inr, pct, xm } from '../metrics/format';
import type { Marketing } from '../metrics/marketing';
import { dayLabel, describeRange } from '../metrics/range';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Drawer, Empty, PageHead, Seg, VERDICT_TONE, type Tone } from '../ui/kit';

type Floor = 'all' | '10k' | '50k';
type CreativeRow = ReturnType<Marketing['creatives']>[number];

const FLOOR: Record<Floor, number> = { all: 0, '10k': 10000, '50k': 50000 };
const FORMATS: CreativeFormat[] = ['video', 'carousel', 'static'];
const FORMAT_LABEL: Record<CreativeFormat, string> = { video: 'Video', carousel: 'Carousel', static: 'Static' };
const ANGLE_LABEL: Record<Creative['angle'], string> = {
  problem_solution: 'Problem → solution', ingredient: 'Ingredient / science', price_offer: 'Price / offer',
  testimonial: 'Testimonial / UGC', routine: 'Routine', before_after: 'Before / after',
};
const QA_TONE: Record<CreativeQaFlag['kind'], Tone> = { creative: 'crit', artwork: 'warn', measurement: 'neutral' };
/** Mirrors the call rules in metrics/marketing.ts creatives(). */
const CALL_RULE: Record<CreativeRow['call'], string> = {
  KEEP: 'Mid ROAS at or above break-even and CTR healthy (or a brand/awareness ad, judged on reach).',
  WATCH: 'Mid ROAS below break-even, or CTR under 70% of the median creative.',
  FIX: 'Has an open QA flag: fix the asset before reading its numbers.',
  STOP: 'Mid ROAS under 60% of break-even.',
};

const thumbBg = (h: number) => `linear-gradient(135deg, hsl(${h} 45% 38%), hsl(${(h + 40) % 360} 50% 55%))`;
const freq = (v: number | null) => (v === null ? '—' : v.toFixed(1));

export default function Creatives() {
  const { engine, range, navigate } = useApp();
  const rows = engine.marketing.creatives(range);
  const [floor, setFloor] = useState<Floor>('all');
  const [format, setFormat] = useState<CreativeFormat | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const productName = (id?: string) => (id ? engine.w.products.find((p) => p.id === id)?.name : undefined);

  const aboveFloor = rows.filter((r) => r.spend >= FLOOR[floor]);
  const shown = aboveFloor.filter((r) => format === 'all' || r.creative.format === format);

  // QA queue: every flag on a creative that spent, ranked by the spend behind it
  const qa = rows.filter((r) => r.creative.qa.length).flatMap((r) => r.creative.qa.map((f) => ({ row: r, flag: f })));

  // Angle × format: spend-weighted mean of per-creative mid ROAS (only creatives with both lenses)
  const angles = useMemo(() => {
    const acc: Record<string, { spend: number; wSpend: number; wRoas: number; byFmt: Record<string, { wSpend: number; wRoas: number }> }> = {};
    for (const r of rows) {
      const a = (acc[r.creative.angle] ||= { spend: 0, wSpend: 0, wRoas: 0, byFmt: {} });
      a.spend += r.spend;
      if (r.roas === null) continue;
      a.wSpend += r.spend;
      a.wRoas += r.roas * r.spend;
      const f = (a.byFmt[r.creative.format] ||= { wSpend: 0, wRoas: 0 });
      f.wSpend += r.spend;
      f.wRoas += r.roas * r.spend;
    }
    return Object.entries(acc).map(([angle, a]) => {
      const fmts = Object.entries(a.byFmt).map(([f, v]) => ({ f: f as CreativeFormat, roas: v.wSpend ? v.wRoas / v.wSpend : null }));
      const best = fmts.filter((x) => x.roas !== null).sort((x, y) => y.roas! - x.roas!)[0];
      return { angle: angle as Creative['angle'], spend: a.spend, roas: a.wSpend ? a.wRoas / a.wSpend : null, best: fmts.length > 1 ? best : undefined };
    }).sort((x, y) => y.spend - x.spend);
  }, [rows]);

  const open = rows.find((r) => r.creative.id === openId) ?? null;

  return (
    <>
      <PageHead
        title="Creative library"
        sub={`${describeRange(engine.cal, range)} · ${aboveFloor.length} creatives above the spend floor · every ad that spent, browsable by picture`}
        actions={<Seg<Floor> label="Spend floor" value={floor} onChange={setFloor} options={[{ id: 'all', label: 'All' }, { id: '10k', label: '≥ ₹10K' }, { id: '50k', label: '≥ ₹50K' }]} />}
      />

      <div className="grid split-8-4">
        <div className="stack">
          <div className="row">
            <button type="button" className="chip" aria-pressed={format === 'all'} onClick={() => setFormat('all')}>All <span className="muted">{aboveFloor.length}</span></button>
            {FORMATS.map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={format === f} onClick={() => setFormat(f)}>
                {FORMAT_LABEL[f]} <span className="muted">{aboveFloor.filter((r) => r.creative.format === f).length}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? <Card><Empty>No creatives above this spend floor in the window.</Empty></Card> : (
            <div className="creative-grid">
              {shown.map((r) => {
                const cr = r.creative;
                return (
                  <Card key={cr.id} className="creative" onClick={() => setOpenId(cr.id)} title={`${cr.name}: open details`}>
                    <div className="thumb" style={{ background: thumbBg(cr.hue) }} aria-hidden="true">
                      <span>“{cr.hook}”</span>
                      <span className="fmt">{cr.format}</span>
                      {cr.format === 'video' && <span className="play" style={{ fontSize: 9 }}>▶</span>}
                    </div>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <Badge tone="neutral">{FORMAT_LABEL[cr.format]}</Badge>
                      <Badge tone={VERDICT_TONE[r.call]}>{r.call}</Badge>
                    </div>
                    <div className="small strong">{cr.name} · {productName(cr.productId ?? r.campaign.productId) ?? r.campaign.name}</div>
                    <div className="tiny muted num">{inr(r.spend)} · {xm(r.roas)} mid · freq {freq(r.frequency)} · CTR {pct(r.ctr, 2)}</div>
                    <div className="row" style={{ gap: 4 }}>
                      <span className="chip">{ANGLE_LABEL[cr.angle]}</span>
                      <span className="chip">{cr.language}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="stack">
          <Card>
            <CardHead title="Creative QA — what to act on" sub={`${qa.length} flag${qa.length === 1 ? '' : 's'} on creatives that spent · ranked by spend behind them`} />
            {qa.length === 0 ? <Empty>No QA flags on creatives that spent in this window.</Empty> : qa.map(({ row, flag }, i) => (
              <div
                key={`${row.creative.id}-${i}`}
                className="small clickable"
                style={{ padding: '8px 0', borderTop: i ? '1px solid var(--hair)' : undefined, cursor: 'pointer' }}
                onClick={() => setOpenId(row.creative.id)}
              >
                <div className="row" style={{ gap: 6 }}>
                  <Badge tone={QA_TONE[flag.kind]}>{flag.kind}</Badge>
                  <span className="strong">{inr(row.spend)}</span><span className="muted">behind it</span>
                </div>
                <div className="soft" style={{ marginTop: 2 }}>{row.creative.name}: {flag.note}</div>
              </div>
            ))}
          </Card>

          <Card>
            <CardHead title="By angle × format" sub="All creatives in window · ROAS is the spend-weighted mean of each creative's mid lens √(platform × last-click)" />
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Angle</th><th className="num">Spend</th><th className="num">Mid ROAS · spend-wtd</th><th>Best format</th></tr></thead>
                <tbody>
                  {angles.map((a) => (
                    <tr key={a.angle}>
                      <td>{ANGLE_LABEL[a.angle]}</td>
                      <td className="num">{inr(a.spend)}</td>
                      <td className="num">{xm(a.roas)}</td>
                      <td className="small">{a.best ? <>{FORMAT_LABEL[a.best.f]} <span className="muted">{xm(a.best.roas)}</span></> : <span className="muted">one format only</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <BuiltFrom sources={['meta', 'google_ads', 'snapchat']} />

      {open && (
        <Drawer title={open.creative.name} onClose={() => setOpenId(null)}>
          <div className="thumb" style={{ background: thumbBg(open.creative.hue), fontSize: 15 }} aria-hidden="true">
            <span>“{open.creative.hook}”</span>
            <span className="fmt">{open.creative.format}</span>
            {open.creative.format === 'video' && <span className="play" style={{ fontSize: 9 }}>▶</span>}
          </div>
          <div className="row mt">
            <Badge tone={VERDICT_TONE[open.call]}>{open.call}</Badge>
            <span className="small soft">{CALL_RULE[open.call]}</span>
          </div>
          <table className="def-table mt">
            <tbody>
              <tr><td>Campaign</td><td><a href="#/campaigns" onClick={(e) => { e.preventDefault(); navigate('campaigns', open.campaign.id); }}>{open.campaign.name} →</a></td></tr>
              <tr><td>Product</td><td>{productName(open.creative.productId ?? open.campaign.productId) ?? '—'}</td></tr>
              <tr><td>Format</td><td>{FORMAT_LABEL[open.creative.format]}</td></tr>
              <tr><td>Angle</td><td>{ANGLE_LABEL[open.creative.angle]}</td></tr>
              <tr><td>Hook</td><td>“{open.creative.hook}”</td></tr>
              <tr><td>Language</td><td>{open.creative.language}</td></tr>
              <tr><td>Launched</td><td>{dayLabel(engine.cal, open.creative.launchDay, true)}</td></tr>
              <tr><td>Spend</td><td className="num">{inr(open.spend)}</td></tr>
              <tr><td>ROAS · mid</td><td>{xm(open.roas)} <span className="muted small">(last-click {xm(open.roasLastClick)})</span></td></tr>
              <tr><td>CTR</td><td>{pct(open.ctr, 2)}</td></tr>
              <tr><td>Frequency</td><td>{freq(open.frequency)}</td></tr>
            </tbody>
          </table>
          <h3 className="mt" style={{ fontSize: 13 }}>QA flags</h3>
          {open.creative.qa.length === 0 ? <div className="small muted">None: the vision model found nothing to fix.</div> : (
            <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 0, listStyle: 'none' }}>
              {open.creative.qa.map((f, i) => (
                <li key={i} style={{ margin: '6px 0' }}><Badge tone={QA_TONE[f.kind]}>{f.kind}</Badge> <span className="soft">{f.note}</span></li>
              ))}
            </ul>
          )}
        </Drawer>
      )}
    </>
  );
}
