import { compact, inr, pct } from '../metrics/format';
import { describeRange } from '../metrics/range';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Meter, Note, PageHead, SourceChip, useSort, VERDICT_TONE } from '../ui/kit';

/**
 * Conversion funnel: sessions in, rupees out. Each stage carries its benchmark
 * and the rupees recoverable if the gap closed. Product pages get their own
 * funnel, so a weak PDP shows up separately from a weak cart.
 */
export default function ConversionFunnel() {
  const { engine, range } = useApp();
  const f = engine.funnel.store(range);
  const products = engine.funnel.products(range);
  const sessions = f.steps[0]?.count ?? 0;
  const home = f.routers.find((r) => r.entry === 'homepage');

  const { sorted, header } = useSort(products, {
    views: (r) => r.views, atc: (r) => r.atc, atcRate: (r) => r.atcRate, atcToCheckout: (r) => r.atcToCheckout, units: (r) => r.units, net: (r) => r.net,
  }, { id: 'net', dir: 'desc' });

  return (
    <>
      <PageHead
        title="Conversion funnel"
        sub={`${describeRange(engine.cal, range)} · first-party Shopify sessions · checkout-events app · orders webhook`}
      />

      <div className="grid split-7-5">
        <Card>
          <CardHead
            title="Session funnel"
            sub="Volume = share of all sessions · carry-through = share of the step above, against benchmark (75th percentile of trailing-90-day daily rates)"
            tools={<SourceChip label="definition" metric="atc_rate" />}
          />
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr><th>Step</th><th>Source</th><th className="num">Count</th><th>Volume</th><th>Carry-through</th></tr>
              </thead>
              <tbody>
                {f.steps.map((s) => {
                  const below = s.rate !== null && s.bench !== null && s.rate < s.bench;
                  return (
                    <tr key={s.key}>
                      <td className="strong">{s.label}</td>
                      <td className="muted">{s.source}</td>
                      <td className="num">{compact(s.count)}</td>
                      <td><div className="meter"><Meter value={s.count} max={sessions} /><span className="small muted num">{pct(sessions ? s.count / sessions : null)}</span></div></td>
                      <td className="small">
                        {s.key === 'sessions' ? <span className="muted">entry</span> : (
                          <>
                            <span className={`num ${below ? 'neg' : ''}`}>{pct(s.rate)}</span>
                            {s.bench !== null
                              ? <span className="muted"> · benchmark {pct(s.bench)}{below ? ' · below' : ''}</span>
                              : <span className="muted"> of checkout</span>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {f.partial && <div className="mt"><Note>The range includes today, which is partial: late-day sessions convert later, so today's carry-through reads low until the day closes.</Note></div>}
        </Card>

        <div className="stack">
          <Card>
            <CardHead title="Where the money is leaking" sub="Each tile shows its arithmetic" />
            <div className="grid g2">
              <Card className={f.pdpLeak > 0 ? 'top-crit' : 'top-good'}>
                <div className="stat-label strong">PDP · session → cart</div>
                <div className="stat-value">{inr(f.pdpLeak)}</div>
                <div className="stat-foot">
                  {f.pdpLeak > 0
                    ? `sessions × gap to benchmark × close rate × AOV (${inr(f.aov)})`
                    : 'add-to-cart rate is at or above benchmark: nothing to recover'}
                </div>
              </Card>
              <Card className={f.routingLeak > 0 ? 'top-warn' : 'top-good'}>
                <div className="stat-label strong">Routing · homepage</div>
                <div className="stat-value">{inr(f.routingLeak)}</div>
                <div className="stat-foot">
                  best revenue/session ({inr(f.bestRevPerSession)}) on too few sessions · homepage earns {inr(home?.revPerSession)} on {compact(home?.sessions)} · half the gap counted
                </div>
              </Card>
            </div>
          </Card>

          <Card>
            <CardHead title="Page routers" sub="GA4 sessions by entry page · revenue/session at store AOV" />
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr><th>Entry</th><th className="num">Sessions</th><th className="num">ATC %</th><th className="num">Rev / session</th></tr>
                </thead>
                <tbody>
                  {f.routers.map((r) => (
                    <tr key={r.entry}>
                      <td>{r.label}{r.revPerSession !== null && r.revPerSession === f.bestRevPerSession && <> <Badge tone="good">Best</Badge></>}</td>
                      <td className="num">{compact(r.sessions)}</td>
                      <td className="num">{pct(r.atcRate)}</td>
                      <td className="num">{inr(r.revPerSession)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt">
        <CardHead
          title="Product funnel — its own PDP vs whole store"
          sub="PDP views, add to cart and checkout from the product's own page · units and net revenue from every order, wherever the product was added"
        />
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">{header('PDP views', 'views')}</th>
                <th className="num">{header('ATC', 'atc')}</th>
                <th className="num">{header('ATC %', 'atcRate')}</th>
                <th className="num">{header('ATC → checkout', 'atcToCheckout')}</th>
                <th className="num">{header('Units (store)', 'units')}</th>
                <th className="num">{header('Net revenue', 'net')}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.product?.id ?? i}>
                  <td>{r.product?.name ?? 'Unknown product'}</td>
                  <td className="num">{compact(r.views)}</td>
                  <td className="num">{compact(r.atc)}</td>
                  <td className={`num ${r.status === 'WEAK PDP' ? 'neg' : ''}`}>{pct(r.atcRate)}</td>
                  <td className="num">{pct(r.atcToCheckout)}</td>
                  <td className="num">{compact(r.units)}</td>
                  <td className="num">{inr(r.net)}</td>
                  <td><Badge tone={VERDICT_TONE[r.status]}>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted mt-s">
          WEAK PDP = ATC rate below 0.6× the median of products with 500+ views · SELLS OFF-PDP = units well above what its own page adds to cart (bundles, collections, upsells)
        </p>
      </Card>

      <BuiltFrom sources={['shopify', 'checkout_events', 'ga4']} />
    </>
  );
}
