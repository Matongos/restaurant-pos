import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { round2, fmt } from '../domain/money';
import { todayISO } from '../domain/rules';
import { TopBar } from '../components/ui';

/** Prototype of the daily summary. Full reports live in the Back Office module. */
export default function Reports() {
  const orders = useStore((s) => s.orders);
  const changeOwed = useStore((s) => s.changeOwed);
  const currencies = useStore((s) => s.currencies);
  const methods = useStore((s) => s.paymentMethods);
  const orderTypes = useStore((s) => s.orderTypes);
  const staff = useStore((s) => s.staff);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  const base = currencies.find((c) => c.code === baseCode)!;
  const [day, setDay] = useState(todayISO());
  const [includeTraining, setIncludeTraining] = useState(false);

  const r = useMemo(() => {
    const list = orders.filter(
      (o) => o.status !== 'cancelled' && todayISO(new Date(o.createdAt)) === day && (includeTraining || !o.training),
    );
    const sales = round2(list.reduce((s, o) => s + o.total, 0));
    const mains = list.filter((o) => !o.parentOrderId);

    const byPay: Record<string, { amount: number; count: number }> = {};
    for (const o of list)
      for (const p of o.payments) {
        const k = `${p.methodId}|${p.currency}`;
        byPay[k] = byPay[k] ?? { amount: 0, count: 0 };
        byPay[k].amount = round2(byPay[k].amount + p.amount);
        byPay[k].count++;
      }

    const byItem: Record<string, { qty: number; amount: number }> = {};
    for (const o of list)
      for (const l of o.lines) {
        byItem[l.name] = byItem[l.name] ?? { qty: 0, amount: 0 };
        byItem[l.name].qty += l.qty;
        byItem[l.name].amount = round2(byItem[l.name].amount + l.qty * l.unitPrice);
      }

    const byType: Record<string, number> = {};
    for (const o of mains) byType[o.orderTypeId] = (byType[o.orderTypeId] ?? 0) + 1;

    const byCashier: Record<string, number> = {};
    for (const o of list) byCashier[o.cashierId] = round2((byCashier[o.cashierId] ?? 0) + o.total);

    const prepMins = list
      .map((o) => {
        const placed = o.history.find((h) => h.status === 'placed')?.at;
        const ready = o.history.find((h) => h.status === 'ready')?.at;
        return placed && ready ? (Date.parse(ready) - Date.parse(placed)) / 60000 : null;
      })
      .filter((x): x is number => x !== null);
    const avgPrep = prepMins.length ? round2(prepMins.reduce((a, b) => a + b, 0) / prepMins.length) : null;

    const owedToday = changeOwed.filter((c) => todayISO(new Date(c.createdAt)) === day && list.some((o) => o.id === c.orderId));
    const owedAmount = round2(owedToday.reduce((s, c) => s + c.amount, 0));

    return { list, mains, sales, byPay, byItem, byType, byCashier, avgPrep, owedToday, owedAmount };
  }, [orders, changeOwed, day, includeTraining]);

  const stat = (label: string, value: string) => (
    <div className="card" style={{ padding: 16 }}>
      <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>
    </div>
  );

  return (
    <div className="app">
      <TopBar title="Reports" />
      <div className="page">
        <div className="page-narrow">
          <div className="row wrap" style={{ marginBottom: 16 }}>
            <label className="field" style={{ marginTop: 0 }}>
              Day
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label className="row" style={{ marginTop: 18 }}>
              <input type="checkbox" checked={includeTraining} onChange={(e) => setIncludeTraining(e.target.checked)} />
              Include training orders
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
            {stat('Sales', fmt(r.sales, base))}
            {stat('Customers served', String(r.mains.length))}
            {stat('Average order', fmt(r.mains.length ? round2(r.sales / r.mains.length) : 0, base))}
            {stat('Avg kitchen time', r.avgPrep === null ? '—' : `${r.avgPrep} min`)}
            {stat('Change owed today', `${fmt(r.owedAmount, base)} (${r.owedToday.length})`)}
          </div>

          <div className="section-title">Money received by method and currency</div>
          <table className="list">
            <thead>
              <tr>
                <th>Method</th>
                <th>Currency</th>
                <th>Payments</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.byPay).map(([k, v]) => {
                const [m, c] = k.split('|');
                const cur = currencies.find((x) => x.code === c);
                return (
                  <tr key={k}>
                    <td>{methods.find((x) => x.id === m)?.name}</td>
                    <td>{c}</td>
                    <td>{v.count}</td>
                    <td>
                      <b>{fmt(v.amount, cur)}</b>
                    </td>
                  </tr>
                );
              })}
              {Object.keys(r.byPay).length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No sales yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 13 }}>
            Cash amounts are what customers handed over; change given is subtracted in the shift-close (Phase 1 build).
          </p>

          <div className="section-title">Best sellers</div>
          <table className="list">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Sales</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.byItem)
                .sort((a, b) => b[1].qty - a[1].qty)
                .map(([name, v]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{v.qty}</td>
                    <td>{fmt(v.amount, base)}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          <div className="row wrap" style={{ alignItems: 'flex-start', gap: 24 }}>
            <div className="grow">
              <div className="section-title">Eat In vs Take Away</div>
              <table className="list">
                <tbody>
                  {Object.entries(r.byType).map(([t, n]) => (
                    <tr key={t}>
                      <td>{orderTypes.find((x) => x.id === t)?.name}</td>
                      <td>
                        <b>{n}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grow">
              <div className="section-title">Sales by cashier</div>
              <table className="list">
                <tbody>
                  {Object.entries(r.byCashier).map(([id, v]) => (
                    <tr key={id}>
                      <td>{staff.find((s) => s.id === id)?.name}</td>
                      <td>
                        <b>{fmt(v, base)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
