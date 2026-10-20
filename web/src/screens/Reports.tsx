import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { round2, fmt } from '../domain/money';
import { balances, fmtDuration, serviceTimes, todayISO } from '../domain/rules';
import { CREDIT_METHOD } from '../domain/types';
import { TopBar } from '../components/ui';
import BarChart from '../components/BarChart';

const TYPE_COLORS = ['#9a3412', '#2563eb', '#6d28d9'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (h: number) => String(h).padStart(2, '0');
const fmtCount = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const dayLabel = (iso: string, withWeekday: boolean) => {
  const d = new Date(iso + 'T12:00:00');
  return withWeekday ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()}` : String(d.getDate());
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Daily report. Full date-range reports and exports live in the Back Office module. */
export default function Reports() {
  const orders = useStore((s) => s.orders);
  const credit = useStore((s) => s.credit);
  const currencies = useStore((s) => s.currencies);
  const methods = useStore((s) => s.paymentMethods);
  const orderTypes = useStore((s) => s.orderTypes);
  const staff = useStore((s) => s.staff);
  const settings = useStore((s) => s.settings);
  const base = currencies.find((c) => c.code === settings.baseCurrency)!;
  const lateMs = settings.lateAfterMinutes * 60000;
  const [day, setDay] = useState(todayISO());
  const [span, setSpan] = useState<1 | 7 | 30>(7);
  const [includeTraining, setIncludeTraining] = useState(true);

  // Dates in the chosen period, oldest first (YYYY-MM-DD).
  const dates = useMemo(() => {
    const end = new Date(day + 'T12:00:00');
    return Array.from({ length: span }, (_, i) => todayISO(new Date(end.getTime() - (span - 1 - i) * 86400000)));
  }, [day, span]);

  const r = useMemo(() => {
    const dateSet = new Set(dates);
    const list = orders.filter(
      (o) => o.status !== 'cancelled' && dateSet.has(todayISO(new Date(o.createdAt))) && (includeTraining || !o.training),
    );
    const sales = round2(list.reduce((s, o) => s + o.total, 0));
    const mains = list.filter((o) => !o.parentOrderId);

    // ---- serving times (main orders only; add-on drinks follow their order)
    const timed = mains.map((o) => ({ o, t: serviceTimes(o) }));
    const served = timed.filter((x) => x.t.toServedMs !== undefined);
    const waits = served.map((x) => x.t.toServedMs!);
    const kitchen = timed.filter((x) => x.t.toReadyMs !== undefined).map((x) => x.t.toReadyMs!);
    const handover = served.filter((x) => x.t.ready).map((x) => Date.parse(x.t.served!) - Date.parse(x.t.ready!));
    const late = served.filter((x) => x.t.toServedMs! >= lateMs);
    const slowest = [...served].sort((a, b) => b.t.toServedMs! - a.t.toServedMs!).slice(0, 10);

    const byHour = new Map<number, number[]>();
    for (const x of served) {
      const h = new Date(x.o.createdAt).getHours();
      byHour.set(h, [...(byHour.get(h) ?? []), x.t.toServedMs!]);
    }
    const hours = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([h, ws]) => ({ h, avg: avg(ws)!, n: ws.length, late: ws.filter((w) => w >= lateMs).length }));

    const byMeal = new Map<string, number[]>();
    for (const x of served) for (const l of x.o.lines) byMeal.set(l.name, [...(byMeal.get(l.name) ?? []), x.t.toServedMs!]);
    const meals = [...byMeal.entries()]
      .map(([name, ws]) => ({ name, avg: avg(ws)!, n: ws.length, late: ws.filter((w) => w >= lateMs).length }))
      .sort((a, b) => b.avg - a.avg);

    // ---- money
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

    // ---- customer change on this day
    const dayCredit = credit.filter((e) => dateSet.has(todayISO(new Date(e.at))));

    // ---- when customers come (main orders = customers)
    const types = orderTypes.filter((t) => t.enabled || mains.some((o) => o.orderTypeId === t.id));
    const hoursSeen = mains.map((o) => new Date(o.createdAt).getHours());
    const hFrom = Math.min(6, ...hoursSeen);
    const hTo = Math.max(20, ...hoursSeen);
    const hourList = Array.from({ length: hTo - hFrom + 1 }, (_, i) => hFrom + i);
    const perHour = types.map((t) =>
      hourList.map((h) => mains.filter((o) => o.orderTypeId === t.id && new Date(o.createdAt).getHours() === h).length / dates.length),
    );
    const perDay = types.map((t) => dates.map((d) => mains.filter((o) => o.orderTypeId === t.id && todayISO(new Date(o.createdAt)) === d).length));
    const hourTotals = hourList.map((_, i) => perHour.reduce((a, s) => a + s[i], 0));
    const busiestHourIdx = hourTotals.indexOf(Math.max(...hourTotals));
    const dayTotals = dates.map((_, i) => perDay.reduce((a, s) => a + s[i], 0));
    const busiestDayIdx = dayTotals.indexOf(Math.max(...dayTotals));
    const weekday = Array.from({ length: 7 }, (_, wd) => {
      const ds = dates.filter((d) => new Date(d + 'T12:00:00').getDay() === wd);
      const total = ds.reduce((a, d) => a + dayTotals[dates.indexOf(d)], 0);
      return ds.length ? total / ds.length : 0;
    });
    const sumKind = (k: string) => round2(dayCredit.filter((e) => e.kind === k).reduce((a, e) => a + Math.abs(e.amount), 0));
    const held = round2([...balances(credit).values()].reduce((a, b) => a + Math.max(0, b), 0));

    return {
      types, hourList, perHour, perDay, hourTotals, busiestHourIdx, dayTotals, busiestDayIdx, weekday,
      list, mains, sales, served, waits, kitchen, handover, late, slowest, hours, meals,
      stillWaiting: timed.length - served.length,
      byPay, byItem, byType, byCashier,
      kept: sumKind('change_left'), used: sumKind('used_for_food'), paidOut: sumKind('paid_out'), held,
    };
  }, [orders, credit, dates, includeTraining, lateMs, orderTypes]);

  const stat = (label: string, value: string, sub?: string, tone?: 'bad') => (
    <div className="card stat">
      <div className="muted lbl">{label}</div>
      <div className="val" style={tone === 'bad' ? { color: 'var(--bad)' } : undefined}>
        {value}
      </div>
      {sub && <div className="muted sub">{sub}</div>}
    </div>
  );

  const maxHour = Math.max(lateMs, ...r.hours.map((h) => h.avg));
  const avgWait = avg(r.waits);
  const latePct = r.served.length ? Math.round((r.late.length / r.served.length) * 100) : 0;
  const methodName = (id: string) => (id === CREDIT_METHOD ? 'Change used' : methods.find((x) => x.id === id)?.name ?? id);

  return (
    <div className="app">
      <TopBar title="Reports" />
      <div className="page">
        <div className="page-narrow">
          <div className="row wrap" style={{ marginBottom: 16 }}>
            <div className="seg">
              {([1, 7, 30] as const).map((n) => (
                <button key={n} className={span === n ? 'on' : ''} onClick={() => setSpan(n)}>
                  {n === 1 ? 'One day' : `Last ${n} days`}
                </button>
              ))}
            </div>
            <label className="field" style={{ marginTop: 0 }}>
              {span === 1 ? 'Day' : 'Up to'}
              <input id="report-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label className="row" style={{ marginTop: 18 }}>
              <input id="include-training" type="checkbox" checked={includeTraining} onChange={(e) => setIncludeTraining(e.target.checked)} />
              Include training orders
            </label>
          </div>

          <div className="stats">
            {stat('Sales', fmt(r.sales, base))}
            {stat('Customers served', String(r.mains.length), r.stillWaiting ? `${r.stillWaiting} still waiting` : undefined)}
            {stat('Average wait', avgWait === null ? '—' : fmtDuration(avgWait), 'from paying to food served')}
            {stat(
              'Late orders',
              `${r.late.length}`,
              r.served.length ? `${latePct}% took ${settings.lateAfterMinutes} min or more` : `late = ${settings.lateAfterMinutes} min or more`,
              r.late.length ? 'bad' : undefined,
            )}
          </div>

          <h2 className="rep-h">When customers come</h2>
          <div className="stats">
            {stat(
              'Busiest hour',
              r.hourTotals[r.busiestHourIdx] > 0 ? `${pad(r.hourList[r.busiestHourIdx])}:00` : '—',
              r.hourTotals[r.busiestHourIdx] > 0 ? `${fmtCount(r.hourTotals[r.busiestHourIdx])} customers${span > 1 ? ' a day' : ''}` : undefined,
            )}
            {span > 1 &&
              stat(
                'Busiest day',
                r.dayTotals[r.busiestDayIdx] > 0 ? dayLabel(dates[r.busiestDayIdx], true) : '—',
                r.dayTotals[r.busiestDayIdx] > 0 ? `${r.dayTotals[r.busiestDayIdx]} customers` : undefined,
              )}
            {span > 1 && stat('Customers a day', fmtCount(r.mains.length / dates.length), 'average')}
            {stat('Take away', r.mains.length ? `${Math.round((r.mains.filter((o) => o.orderTypeId === 'take_away').length / r.mains.length) * 100)}%` : '—', 'of customers')}
          </div>
          <BarChart
            caption={span === 1 ? 'Customers by hour' : `Customers by hour — average per day, last ${span} days`}
            labels={r.hourList.map((h) => `${pad(h)}:00`)}
            series={r.types.map((t, i) => ({ name: t.name, color: TYPE_COLORS[i] ?? '#57534e', values: r.perHour[i] }))}
            format={fmtCount}
            unit="customers"
            highlight={r.busiestHourIdx}
          />
          {span > 1 && (
            <BarChart
              caption={`Customers per day, last ${span} days`}
              labels={dates.map((d) => dayLabel(d, span <= 7))}
              series={r.types.map((t, i) => ({ name: t.name, color: TYPE_COLORS[i] ?? '#57534e', values: r.perDay[i] }))}
              unit="customers"
              highlight={r.busiestDayIdx}
            />
          )}
          {span === 30 && (
            <BarChart
              caption="Average customers by day of the week"
              labels={WEEKDAYS}
              series={[{ name: 'Customers', color: 'var(--brand)', values: [1, 2, 3, 4, 5, 6, 0].map((wd) => r.weekday[wd]) }]}
              format={fmtCount}
              height={200}
              highlight={(() => { const v = [1, 2, 3, 4, 5, 6, 0].map((wd) => r.weekday[wd]); return v.indexOf(Math.max(...v)); })()}
            />
          )}

          <h2 className="rep-h">Serving times</h2>
          <div className="stats">
            {stat('Kitchen time', avg(r.kitchen) === null ? '—' : fmtDuration(avg(r.kitchen)!), 'paid → food ready')}
            {stat('Hand-over time', avg(r.handover) === null ? '—' : fmtDuration(avg(r.handover)!), 'ready → served to customer')}
            {stat('Fastest', r.waits.length ? fmtDuration(Math.min(...r.waits)) : '—')}
            {stat('Slowest', r.waits.length ? fmtDuration(Math.max(...r.waits)) : '—')}
          </div>

          <div className="section-title">Average wait by hour</div>
          {r.hours.length === 0 ? (
            <p className="muted">No served orders in this period yet.</p>
          ) : (
            <div className="hour-chart card">
              {r.hours.map((h) => (
                <div key={h.h} className="hour-row">
                  <span className="hr">{String(h.h).padStart(2, '0')}:00</span>
                  <span className="bar-track">
                    <span className={`bar ${h.avg >= lateMs ? 'late' : ''}`} style={{ width: `${(h.avg / maxHour) * 100}%` }} />
                    <span className="late-line" style={{ left: `${(lateMs / maxHour) * 100}%` }} title={`Late: ${settings.lateAfterMinutes} min`} />
                  </span>
                  <span className="hv">{fmtDuration(h.avg)}</span>
                  <span className="muted hn">
                    {h.n} order{h.n === 1 ? '' : 's'}
                    {h.late ? `, ${h.late} late` : ''}
                  </span>
                </div>
              ))}
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                The dashed line marks {settings.lateAfterMinutes} minutes (late). Change it in Settings → Serving times.
              </div>
            </div>
          )}

          <div className="section-title">Slowest orders</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="list">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Paid at</th>
                  <th>Items</th>
                  <th>Kitchen</th>
                  <th>Total wait</th>
                  <th>Cashier</th>
                </tr>
              </thead>
              <tbody>
                {r.slowest.map(({ o, t }) => (
                  <tr key={o.id}>
                    <td>
                      <b>{o.number}</b>
                    </td>
                    <td>{hhmm(t.placed)}</td>
                    <td>{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</td>
                    <td className="num">{t.toReadyMs !== undefined ? fmtDuration(t.toReadyMs) : '—'}</td>
                    <td className="num">
                      <b style={t.toServedMs! >= lateMs ? { color: 'var(--bad)' } : undefined}>{fmtDuration(t.toServedMs!)}</b>
                      {t.toServedMs! >= lateMs && <span className="tag open" style={{ marginLeft: 6 }}>late</span>}
                    </td>
                    <td>{staff.find((s) => s.id === o.cashierId)?.name}</td>
                  </tr>
                ))}
                {r.slowest.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No served orders yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="section-title">Wait by meal (slowest first)</div>
          <table className="list">
            <thead>
              <tr>
                <th>Meal</th>
                <th>Orders</th>
                <th>Average wait</th>
                <th>Late</th>
              </tr>
            </thead>
            <tbody>
              {r.meals.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td>{m.n}</td>
                  <td className="num">
                    <b style={m.avg >= lateMs ? { color: 'var(--bad)' } : undefined}>{fmtDuration(m.avg)}</b>
                  </td>
                  <td>{m.late || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="rep-h">Money</h2>
          <div className="section-title" style={{ marginTop: 0 }}>
            Received by method and currency
          </div>
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
                    <td>{methodName(m)}</td>
                    <td>{c}</td>
                    <td>{v.count}</td>
                    <td className="num">
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

          <div className="section-title">Customer change</div>
          <div className="stats">
            {stat('Kept for customers', fmt(r.kept, base), 'in this period')}
            {stat('Used for food', fmt(r.used, base), 'in this period')}
            {stat('Paid out in cash', fmt(r.paidOut, base), 'in this period')}
            {stat('Holding now', fmt(r.held, base), 'all customers')}
          </div>

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
                    <td className="num">{fmt(v.amount, base)}</td>
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
                      <td className="num">
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
