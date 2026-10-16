import { inr, pct } from '../metrics/format';
import { dayLabel, describeRange } from '../metrics/range';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, exportCsv, Meter, Note, PageHead, Stat } from '../ui/kit';

/**
 * Revenue reconciliation: booked revenue → cash. The finance gap in the
 * reference screens: every rupee booked should be traceable to a settlement,
 * a remittance or a payout, and anything that isn't is listed to chase.
 */
export default function Reconciliation() {
  const { engine, range } = useApp();
  const rc = engine.finance.reconciliation(range);
  const p = rc.prepaid;
  const cod = rc.cod;

  const steps = [
    { label: 'Prepaid orders (Shopify)', value: p.value, note: `${p.orders.toLocaleString('en-IN')} orders, gross incl. GST` },
    { label: 'Captured (Razorpay)', value: p.captured, note: 'includes captures with no order' },
    { label: '− Gateway fees', value: -p.fees, note: '2% + GST per capture' },
    { label: '− Refunds', value: -p.refunds, note: 'cancelled and returned prepaid orders' },
    { label: 'Settled to bank', value: p.settled, note: 'T+2 business days' },
    { label: 'In transit', value: p.inTransit, note: 'captured, not yet settled' },
  ];

  return (
    <>
      <PageHead
        title="Revenue reconciliation"
        sub={`${describeRange(engine.cal, range)} · does every rupee booked turn into cash? Prepaid via the gateway, COD via courier remittance, marketplaces via settlements`}
        actions={<Badge tone="outline">New for Arata</Badge>}
      />

      <div className="grid g4">
        <Stat label="Revenue booked" source="all ch." metric="cash_conversion" value={inr(rc.summary.booked)} foot="prepaid + COD + Amazon + QC invoices, gross" />
        <Stat label="Cash received" source="bank" metric="cash_conversion" value={inr(rc.summary.cashIn)} foot={`${pct(rc.summary.conversion, 0)} of booked`} />
        <Stat label="Receivable" source="computed" metric="cash_conversion" value={inr(rc.summary.receivable)} foot="booked, not yet cash" />
        <Stat
          label="To chase" source="exceptions" value={<span className="neg">{inr(cod.overdue + p.orphanValue + p.missingCaptureValue)}</span>}
          foot={`COD > 10 days ${inr(cod.overdue)} · ${p.orphanCount} orphan captures · ${p.missingCapture} orders w/o capture`}
        />
      </div>

      <div className="grid g2 mt">
        <Card>
          <CardHead title="Prepaid — Shopify → Razorpay → bank" sub="Every prepaid order should have one capture and one settlement" />
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {steps.map((s) => (
                  <tr key={s.label} className={s.label.startsWith('Settled') ? 'total' : ''}>
                    <td>{s.label}</td>
                    <td className="num">{inr(s.value)}</td>
                    <td className="small muted">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(p.orphanCount > 0 || p.missingCapture > 0) && (
            <div className="mt">
              <Note>
                {p.orphanCount} captures ({inr(p.orphanValue)}) have no Shopify order: usually a dropped order webhook. Refund or create the order.
                {p.missingCapture > 0 && ` ${p.missingCapture} prepaid orders have no capture (${inr(p.missingCaptureValue)}).`}
              </Note>
              {p.orphans.length > 0 && (
                <div className="table-wrap mt-s">
                  <table className="t">
                    <thead><tr><th>Payment</th><th>Captured</th><th className="num">Amount</th></tr></thead>
                    <tbody>
                      {p.orphans.map((o) => (
                        <tr key={o.paymentId}><td className="small" style={{ fontFamily: 'var(--mono)' }}>{o.paymentId}</td><td>{dayLabel(engine.cal, o.day)}</td><td className="num">{inr(o.amount, { exact: true })}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardHead
            title="COD — delivered → remitted"
            sub="Courier remittance against delivered COD value; overdue = delivered > 10 days ago and not remitted"
            tools={<button className="btn" onClick={() => exportCsv('cod-remittance.csv', [['Courier', 'Delivered', 'Remitted', 'Pending', 'Overdue'], ...cod.couriers.map((c) => [c.name, Math.round(c.delivered), Math.round(c.remitted), Math.round(c.pending), Math.round(c.overdue)])])}>Export</button>}
          />
          <div className="grid g3" style={{ marginBottom: 12 }}>
            <div><div className="small soft">Delivered COD</div><div className="stat-value">{inr(cod.delivered)}</div></div>
            <div><div className="small soft">Remitted</div><div className="stat-value">{inr(cod.remitted)}</div></div>
            <div><div className="small soft">Pending · overdue</div><div className="stat-value">{inr(cod.pending)} <span className="small neg">{inr(cod.overdue)}</span></div></div>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Courier</th><th className="num">Delivered</th><th>Remitted</th><th className="num">Pending</th><th className="num">Overdue</th></tr></thead>
              <tbody>
                {cod.couriers.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="num">{inr(c.delivered)}</td>
                    <td><div className="meter"><Meter value={c.remitted} max={c.delivered} width={90} /><span className="small num">{pct(c.remitted / (c.delivered || 1), 0)}</span></div></td>
                    <td className="num">{inr(c.pending)}</td>
                    <td className={`num ${c.overdue > 0 ? 'neg' : ''}`}>{inr(c.overdue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">COD still in transit: {inr(cod.inTransit)} (not yet delivered, not counted as receivable).</p>
        </Card>
      </div>

      <div className="grid g2 mt">
        <Card>
          <CardHead title="Amazon settlements" sub="14-day settlement cycles overlapping the range" />
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Settlement</th><th>Period</th><th>Payout</th><th className="num">Amount</th><th>Status</th></tr></thead>
              <tbody>
                {rc.amazon.settlements.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td className="small">{dayLabel(engine.cal, s.startDay)} – {dayLabel(engine.cal, s.endDay)}</td>
                    <td className="small">{dayLabel(engine.cal, s.payoutDay)}</td>
                    <td className="num">{inr(s.amount)}</td>
                    <td><Badge tone={s.status === 'paid' ? 'good' : s.status === 'scheduled' ? 'info' : 'neutral'}>{s.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHead title="Quick commerce receivables" sub="Sell-in invoices on filled POs · 45-day payment terms assumed until remittance files are connected" />
          <div className="grid g2">
            <div><div className="small soft">Invoiced in range</div><div className="stat-value">{inr(rc.qc.invoiced)}</div></div>
            <div><div className="small soft">Not yet due / unpaid</div><div className="stat-value">{inr(rc.qc.due)}</div></div>
          </div>
          <div className="mt"><Note>Blinkit, Zepto and Instamart remittance files are not connected, so QC cash is estimated from payment terms, not matched. Connect remittance reports to replace the estimate.</Note></div>
        </Card>
      </div>

      <BuiltFrom sources={['shopify', 'razorpay', 'shiprocket', 'amazon_sp', 'blinkit', 'zepto', 'instamart']} />
    </>
  );
}
