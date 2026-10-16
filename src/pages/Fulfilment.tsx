import { compact, inr, num, pct } from '../metrics/format';
import { dayLabel, describeRange } from '../metrics/range';
import { useApp } from '../state/app';
import { Badge, BuiltFrom, Card, CardHead, Empty, PageHead, SourceChip, Stat, useSort, type Tone } from '../ui/kit';

const STATUS: Record<string, { tone: Tone; label: string }> = {
  delivered: { tone: 'good', label: 'Delivered' },
  in_transit: { tone: 'info', label: 'In transit' },
  rto: { tone: 'crit', label: 'RTO' },
  returned: { tone: 'warn', label: 'Returned' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

const kg = (g: number) => `${num(g / 1000, 2)} kg`;
const hours = (v: number | null) => (v === null ? '—' : `${num(v, 1)}h`);
const days = (v: number | null) => (v === null ? '—' : `${num(v, 1)}d`);

/** Order deep link from search: the order, its shipment and what the courier billed. */
function OrderCard({ orderId }: { orderId: number }) {
  const { engine, navigate } = useApp();
  const o = engine.w.orders.find((x) => x.id === orderId);
  if (!o) return null;
  const s = engine.core.shipByOrder.get(o.id);
  const courier = s ? engine.w.couriers.find((c) => c.id === s.courierId) : undefined;
  const slab = s ? Math.ceil(s.catalogueWeightG / 500) * 500 : 0;
  const over = s ? s.billedWeightG > slab : false;
  const st = STATUS[s?.status ?? o.status];
  return (
    <Card className="top-info">
      <CardHead
        title={<>Order #{o.id} <Badge tone={st.tone}>{st.label}</Badge></>}
        sub={`${dayLabel(engine.cal, o.day, true)} · ${o.city} ${o.pincode} · ${o.payment === 'cod' ? 'COD' : 'Prepaid'} · ${inr(o.gross, { exact: true })} gross · ${o.lines.length} line${o.lines.length === 1 ? '' : 's'}`}
        tools={<button className="btn ghost" onClick={() => navigate('fulfilment')}>Close ✕</button>}
      />
      {!s ? <div className="small muted">No shipment for this order (cancelled before dispatch or not yet synced from the courier aggregator).</div> : (
        <div className="grid g6">
          <div><div className="small soft">Courier</div><div className="strong">{courier ? `${courier.name} · ${courier.service}` : s.courierId}</div></div>
          <div><div className="small soft">Billed vs catalogue</div><div className={`strong ${over ? 'neg' : ''}`}>{kg(s.billedWeightG)} / {kg(s.catalogueWeightG)}</div>{over && <div className="tiny neg">above the {kg(slab)} slab</div>}</div>
          <div><div className="small soft">Freight</div><div className="strong">{inr(s.freight + s.codFee, { exact: true })}</div>{s.codFee > 0 && <div className="tiny muted">incl. COD fee {inr(s.codFee, { exact: true })}</div>}</div>
          <div><div className="small soft">Pickup · delivery</div><div className="strong">{hours(s.pickupHours)} · {days(s.deliveryDays)}</div></div>
          <div><div className="small soft">RTO freight</div><div className="strong">{s.rtoFreight > 0 ? inr(s.rtoFreight, { exact: true }) : '—'}</div></div>
          <div>
            <div className="small soft">COD remitted</div>
            <div className="strong">
              {o.payment !== 'cod' ? '— prepaid' : s.codRemitted ? <Badge tone="good">✓ Remitted {inr(s.codAmount, { exact: true })}</Badge> : <Badge tone="warn">Pending {inr(s.codAmount, { exact: true })}</Badge>}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Fulfilment and courier audit: speed, cost and reliability per courier, COD vs
 * prepaid economics and the pincodes that RTO. Weight overcharges compare the
 * billed weight with the catalogue weight slab: money to claim back.
 */
export default function Fulfilment() {
  const { engine, range, param } = useApp();
  const f = engine.ops.fulfilment(range);
  const orderId = param && /^\d+$/.test(param) ? Number(param) : null;

  const sc = useSort(f.couriers, {
    name: (c) => c.name, ships: (c) => c.ships, pickup: (c) => c.pickup, delivery: (c) => c.delivery, p90: (c) => c.p90,
    rto: (c) => c.rtoRate, cost: (c) => c.costPerOrder, cod: (c) => c.codShare, over: (c) => c.overcharge,
  });
  // RTO is judged against the blended rate so "high" means relative to this business, not a fixed bar
  const rtoTone = (r: number | null) => (r === null || f.rtoRate === null ? '' : r > f.rtoRate * 1.15 ? 'neg' : r < f.rtoRate * 0.85 ? 'pos' : '');

  return (
    <>
      <PageHead title="Shipping audit" sub={`${describeRange(engine.cal, range)} · per-courier speed, cost and reliability · courier billing + warehouse SKU weights`} />

      {orderId !== null && <div style={{ marginBottom: 14 }}><OrderCard orderId={orderId} /></div>}

      <div className="grid g5">
        <Stat label="Shipments" source="Shiprocket" value={compact(f.ships)} foot={`${compact(f.delivered)} delivered`} />
        <Stat label="RTO rate" source="Shiprocket" metric="rto_rate" value={pct(f.rtoRate)} foot={`COD ${pct(f.codRto)} · prepaid ${pct(f.prepaidRto)}`} />
        <Stat label="Freight" source="Shiprocket" value={inr(f.freight)} foot={`${pct(f.freightPct)} of order value`} />
        <Stat label="Weight overcharge" source="audit" metric="weight_overcharge" value={inr(f.overcharge)} valueClass={f.overcharge > 0 ? 'neg' : ''} foot={`${num(f.overKg, 0)} kg over · to recover`} />
        <Stat label="Picked up within 24h" source="Shiprocket" value={pct(f.pickedIn24)} foot={`p90 ${days(f.p90)} · ${compact(f.pending)} pending`} />
      </div>

      <Card className="mt">
        <CardHead title="Courier scorecard" sub="Rank and reallocate on speed, RTO and cost · click a header to sort · RTO coloured against the blended rate" tools={<SourceChip label="definition" metric="rto_rate" />} />
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{sc.header('Courier · service', 'name')}</th>
                <th className="num">{sc.header('Ships', 'ships')}</th>
                <th className="num">{sc.header('Pickup', 'pickup')}</th>
                <th className="num">{sc.header('Delivery', 'delivery')}</th>
                <th className="num">{sc.header('P90', 'p90')}</th>
                <th className="num">{sc.header('RTO %', 'rto')}</th>
                <th className="num">{sc.header('Cost / order', 'cost')}</th>
                <th className="num">{sc.header('COD share', 'cod')}</th>
                <th className="num">{sc.header('Wt overcharge', 'over')}</th>
              </tr>
            </thead>
            <tbody>
              {sc.sorted.map((c) => (
                <tr key={c.id}>
                  <td>{c.name} <span className="muted">· {c.service}</span></td>
                  <td className="num">{compact(c.ships)}</td>
                  <td className="num">{hours(c.pickup)}</td>
                  <td className="num">{days(c.delivery)}</td>
                  <td className="num">{days(c.p90)}</td>
                  <td className={`num ${rtoTone(c.rtoRate)}`}>{pct(c.rtoRate)}</td>
                  <td className="num">{inr(c.costPerOrder)}</td>
                  <td className="num">{pct(c.codShare, 0)}</td>
                  <td className={`num ${c.overcharge > 0 ? 'neg' : ''}`}>{inr(c.overcharge)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid g2 mt">
        <Card>
          <CardHead title="COD vs prepaid" sub="RTO on resolved shipments · COD collected = delivered and remitted by the courier" />
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th /><th className="num">COD</th><th className="num">Prepaid</th></tr></thead>
              <tbody>
                <tr><td>Orders</td><td className="num">{compact(f.cod.orders)}</td><td className="num">{compact(f.prepaid.orders)}</td></tr>
                <tr><td>AOV</td><td className="num">{inr(f.cod.aov)}</td><td className="num">{inr(f.prepaid.aov)}</td></tr>
                <tr>
                  <td>RTO rate</td>
                  <td className={`num ${(f.cod.rtoRate ?? 0) > (f.prepaid.rtoRate ?? 0) ? 'neg' : ''}`}>{pct(f.cod.rtoRate)}</td>
                  <td className="num">{pct(f.prepaid.rtoRate)}</td>
                </tr>
                <tr><td>Collected / pending</td><td className="num">{inr(f.cod.collected)} / {inr(f.cod.pending)}</td><td className="num muted">—</td></tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHead title="RTO risk by pincode" sub={`Ranked by worst case, minimum ${f.minPincode} resolved`} />
          {f.pincodes.length === 0 ? <Empty>No pincode has {f.minPincode} resolved shipments in this range yet.</Empty> : (
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Pincode</th><th>City</th><th className="num">Shipped</th><th className="num">RTO %</th><th className="num">COD share</th></tr></thead>
                <tbody>
                  {f.pincodes.map((p) => (
                    <tr key={p.code}>
                      <td className="num" style={{ textAlign: 'left' }}>{p.code}</td>
                      <td>{p.city}</td>
                      <td className="num">{compact(p.shipped)}</td>
                      <td className={`num ${rtoTone(p.rtoRate)}`}>{pct(p.rtoRate)}</td>
                      <td className="num">{pct(p.codShare, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <BuiltFrom sources={['shiprocket', 'wms', 'shopify']} />
    </>
  );
}
