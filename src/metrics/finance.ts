/**
 * Revenue reconciliation: does every rupee booked in Shopify and the
 * marketplaces turn into cash? Prepaid via the gateway, COD via courier
 * remittance, marketplaces via settlements.
 */
import { type Core } from './core';
import { safeDiv } from './format';
import { type DateRange, rangeKey } from './range';

export class Finance {
  constructor(private core: Core) {}

  reconciliation(r: DateRange) {
    return this.core.cached(`recon:${rangeKey(r)}`, () => {
      const w = this.core.w;
      const t = w.today;

      // Prepaid: Shopify prepaid orders vs Razorpay captures and settlements
      let prepaidOrders = 0, prepaidValue = 0, missingCapture = 0, missingCaptureValue = 0;
      for (const o of this.core.orders(r)) {
        if (o.payment !== 'prepaid' || o.status === 'cancelled') continue;
        prepaidOrders++;
        prepaidValue += o.gross;
        if (!this.core.payByOrder.has(o.id)) { missingCapture++; missingCaptureValue += o.gross; }
      }
      let captured = 0, fees = 0, settled = 0, inTransit = 0, refunds = 0, orphanCount = 0, orphanValue = 0;
      const orphans: { paymentId: string; day: number; amount: number }[] = [];
      for (const p of w.payments) {
        if (p.day < r.start || p.day > r.end) continue;
        captured += p.amount;
        fees += p.fee;
        refunds += p.refunded;
        if (p.settlementDay !== null) settled += p.amount - p.fee - p.refunded;
        else inTransit += p.amount - p.fee - p.refunded;
        if (p.orderId === null) { orphanCount++; orphanValue += p.amount; orphans.push({ paymentId: p.paymentId, day: p.day, amount: p.amount }); }
      }

      // COD: delivered value vs remitted, ageing by courier
      const couriers = Object.fromEntries(w.couriers.map((c) => [c.id, { name: `${c.name} · ${c.service}`, delivered: 0, remitted: 0, pending: 0, overdue: 0 }]));
      let codDelivered = 0, codRemitted = 0, codPending = 0, codOverdue = 0, codInTransit = 0;
      for (const o of this.core.orders(r)) {
        if (o.payment !== 'cod') continue;
        const s = this.core.shipByOrder.get(o.id);
        if (!s) continue;
        if (s.status === 'in_transit') { codInTransit += s.codAmount; continue; }
        if (s.status !== 'delivered' && s.status !== 'returned') continue;
        const c = couriers[s.courierId];
        codDelivered += s.codAmount; c.delivered += s.codAmount;
        if (s.codRemitted) { codRemitted += s.codAmount; c.remitted += s.codAmount; }
        else {
          codPending += s.codAmount; c.pending += s.codAmount;
          const deliveredOn = s.day + (s.deliveryDays ?? 0);
          if (t - deliveredOn > 10) { codOverdue += s.codAmount; c.overdue += s.codAmount; }
        }
      }

      // Marketplaces: Amazon settlements overlapping the range
      const settlements = w.amazonSettlements.filter((s) => s.endDay >= r.start && s.startDay <= r.end);
      const amazonPaid = settlements.filter((s) => s.status === 'paid').reduce((a, s) => a + s.amount, 0);
      const amazonScheduled = settlements.filter((s) => s.status !== 'paid').reduce((a, s) => a + s.amount, 0);

      // QC: sell-in invoices vs typical 45-day payment terms
      let qcInvoiced = 0, qcDue = 0;
      for (const po of w.purchaseOrders) {
        if (po.day < r.start || po.day > r.end) continue;
        const value = po.filledUnits * this.core.productById[po.productId].mrp * 0.58;
        qcInvoiced += value;
        if (po.day + 45 > t) qcDue += value;
      }

      const booked = prepaidValue + codDelivered + codInTransit + amazonPaid + amazonScheduled + qcInvoiced;
      const cashIn = settled + codRemitted + amazonPaid + (qcInvoiced - qcDue);
      return {
        prepaid: { orders: prepaidOrders, value: prepaidValue, captured, fees, settled, inTransit, refunds, missingCapture, missingCaptureValue, orphanCount, orphanValue, orphans: orphans.slice(0, 8) },
        cod: { delivered: codDelivered, remitted: codRemitted, pending: codPending, overdue: codOverdue, inTransit: codInTransit, couriers: Object.values(couriers).filter((c) => c.delivered > 0) },
        amazon: { paid: amazonPaid, scheduled: amazonScheduled, settlements },
        qc: { invoiced: qcInvoiced, due: qcDue },
        summary: { booked, cashIn, receivable: booked - cashIn, conversion: safeDiv(cashIn, booked) },
      };
    });
  }
}
