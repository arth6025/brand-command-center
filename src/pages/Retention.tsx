import { heatStyle, LineChart } from '../charts/LineChart';
import { compact, inr, inrShort, pct } from '../metrics/format';
import { describeRange } from '../metrics/range';
import { useApp } from '../state/app';
import { BuiltFrom, Card, CardHead, Empty, Note, PageHead, Stat } from '../ui/kit';

/**
 * Retention: how fast first-time buyers come back, and what a customer is
 * worth over time on revenue and on contribution. For a regimen brand repeat
 * timing drives replenishment ads and stock.
 */
export default function Retention() {
  const { engine, range } = useApp();
  const rr = engine.retention.repeatRates();
  const cohorts = engine.retention.cohorts();
  const cm1Pct = engine.core.ladder(range, 'website').cm1Pct;
  const ltv = engine.retention.ltv(cm1Pct);
  const maxCell = Math.max(0, ...cohorts.flatMap((c) => c.cells.filter((v): v is number => v !== null)));
  const last = ltv[ltv.length - 1];

  return (
    <>
      <PageHead title="Returning customers and cohorts" sub="New vs returning · repeat speed by cohort · LTV curves · cohorts use the full order history, not the selected range" />

      <div className="grid g4">
        <Stat label="14-day repeat rate" source="Shopify" metric="repeat_rate" value={pct(rr.d14.rate)} foot={`of ${compact(rr.d14.eligible)} new customers`} />
        <Stat label="30-day repeat rate" source="Shopify" metric="repeat_rate" value={pct(rr.d30.rate)} foot={`of ${compact(rr.d30.eligible)} new customers`} />
        <Stat label="90-day repeat rate" source="Shopify" metric="repeat_rate" value={pct(rr.d90.rate)} foot={`of ${compact(rr.d90.eligible)} new customers`} />
        <Stat label="Regimen attach" source="Shopify" value={pct(rr.regimenAttach)} foot="orders in the last 90 days with 2+ regimen steps or the kit" />
      </div>

      <div className="grid split-7-5 mt">
        <Card>
          <CardHead
            title="Cohort repeat — cumulative share of each month's new customers who ordered again by month k"
            sub="Blank = month not reached yet · the current month is excluded until it closes"
          />
          {cohorts.length ? (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Cohort</th><th className="num">Customers</th>
                    {[1, 2, 3, 4, 5, 6].map((k) => <th key={k} className="num" style={{ textAlign: 'center' }}>M{k}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((c) => (
                    <tr key={c.label}>
                      <td>{c.label}</td>
                      <td className="num">{compact(c.customers)}</td>
                      {c.cells.map((v, i) => (
                        v === null
                          ? <td key={i} aria-label="not reached" />
                          : <td key={i} className="heat" style={heatStyle(v, maxCell)}>{pct(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No complete cohort months yet.</Empty>}
          <div className="row mt-s small muted" aria-label="Heat scale: lighter is lower, darker is higher">
            <span>Lower</span>
            {[0, 1, 2, 3, 4, 5, 6].map((k) => <span key={k} style={{ width: 18, height: 10, borderRadius: 2, background: `var(--seq-${k})`, border: '1px solid var(--hair)' }} />)}
            <span>Higher (lighter = lower share; darkest = {pct(maxCell)})</span>
          </div>
        </Card>

        <Card>
          <CardHead
            title="LTV curve — revenue vs CM1"
            sub={last ? `Average per new customer, by months since first order · M${last.month} based on ${compact(last.n)} customers` : 'Average per new customer, by months since first order'}
          />
          {ltv.length ? (
            <LineChart
              ariaLabel="Lifetime value per new customer by month since first order, revenue and CM1"
              labels={ltv.map((p) => `M${p.month}`)}
              format={inrShort}
              series={[
                { id: 'rev', label: 'Revenue LTV', color: 'var(--series-1)', values: ltv.map((p) => p.revenue) },
                { id: 'cm1', label: 'CM1 LTV', color: 'var(--series-2)', values: ltv.map((p) => p.cm1) },
              ]}
            />
          ) : <Empty>Too few customers to draw an LTV curve.</Empty>}
          {last && (
            <p className="small soft mt-s">
              By M{last.month}: {inr(last.revenue)} revenue · {last.cm1 === null ? 'CM1 not available' : `${inr(last.cm1)} CM1`} per new customer
            </p>
          )}
          <div className="mt-s">
            <Note>
              CM1 LTV applies the current website CM1% ({cm1Pct === null ? 'not available' : pct(cm1Pct)}, {describeRange(engine.cal, range)}) to every month. A true CM1 curve needs dated costs per order.
            </Note>
          </div>
        </Card>
      </div>

      <BuiltFrom sources={['shopify', 'sku_costs']} />
    </>
  );
}
