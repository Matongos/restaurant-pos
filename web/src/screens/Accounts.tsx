import { useMemo, useState } from 'react';
import {
  recordExpense,
  recordPurchase,
  reverseExpense,
  reversePurchase,
  useCurrentUser,
  useStore,
} from '../store/store';
import { fmt, round2 } from '../domain/money';
import { todayISO } from '../domain/rules';
import { CREDIT_METHOD, type AppState, type Expense, type Order, type PaidFrom, type Purchase } from '../domain/types';
import { Dialog, TopBar, toast } from '../components/ui';
import BarChart from '../components/BarChart';
import CancelSaleDialog from '../components/CancelSaleDialog';
import { go } from '../router';

/* ---------------------------------------------------------------- periods */

type PeriodKey = 'today' | '7d' | '28d' | 'month' | 'lastMonth' | '90d';
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '28d', label: '28 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: '90d', label: '90 days' },
];

interface Period {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  start: number;
  end: number; // exclusive timestamp
  days: string[];
}

function periodOf(key: PeriodKey, now = new Date()): Period {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date;
  let end = new Date(d0.getTime() + 86400000);
  if (key === 'today') start = d0;
  else if (key === '7d') start = new Date(d0.getTime() - 6 * 86400000);
  else if (key === '28d') start = new Date(d0.getTime() - 27 * 86400000);
  else if (key === '90d') start = new Date(d0.getTime() - 89 * 86400000);
  else if (key === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
  else {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const days: string[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += 86400000) days.push(todayISO(new Date(t + 3600000)));
  return { from: days[0], to: days[days.length - 1], start: start.getTime(), end: end.getTime(), days };
}

const PAID_FROM: Record<PaidFrom, string> = {
  cash_drawer: 'Cash drawer',
  bank: 'Bank',
  mobile_money: 'Mobile money',
  owner: "Owner's pocket",
};
const EXPENSE_CATEGORIES = ['Wages', 'Rent', 'Electricity', 'Gas', 'Water', 'Transport', 'Repairs', 'Cleaning', 'Licences & tax', 'Other'];
const MONEY_COLORS = { sales: '#0d9488', bought: '#d97706', expenses: '#7c3aed' };

type Tab = 'profit' | 'purchases' | 'expenses' | 'journal' | 'cancellations';
const TABS: [Tab, string][] = [
  ['profit', 'Profit'],
  ['purchases', 'Purchases'],
  ['expenses', 'Expenses'],
  ['journal', 'Sales journal'],
  ['cancellations', 'Cancellations'],
];

const inDays = (date: string, p: Period) => date >= p.from && date <= p.to;
const inTime = (iso: string, p: Period) => {
  const t = Date.parse(iso);
  return t >= p.start && t < p.end;
};

export default function Accounts() {
  const [tab, setTab] = useState<Tab>('profit');
  const [periodKey, setPeriodKey] = useState<PeriodKey>('28d');
  const period = useMemo(() => periodOf(periodKey), [periodKey]);

  return (
    <div className="app">
      <TopBar title="Books" />
      <div className="page">
        <div className="an-wrap">
          <div className="an-controls">
            <div className="seg">
              {PERIODS.map((p) => (
                <button key={p.key} className={periodKey === p.key ? 'on' : ''} onClick={() => setPeriodKey(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            <span className="muted" style={{ fontSize: 14 }}>
              {period.from === period.to ? period.from : `${period.from} to ${period.to}`}
            </span>
          </div>
          <div className="tabs an-tabs">
            {TABS.map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
          {tab === 'profit' && <Profit p={period} />}
          {tab === 'purchases' && <Purchases p={period} />}
          {tab === 'expenses' && <Expenses p={period} />}
          {tab === 'journal' && <Journal p={period} />}
          {tab === 'cancellations' && <Cancellations p={period} />}
        </div>
      </div>
    </div>
  );
}

function useBase() {
  const currencies = useStore((s) => s.currencies);
  const baseCode = useStore((s) => s.settings.baseCurrency);
  return currencies.find((c) => c.code === baseCode)!;
}

/* ================================================================ profit */

function figures(st: Pick<AppState, 'orders' | 'purchases' | 'expenses' | 'cancellations' | 'credit'>, p: Period) {
  const sales = st.orders.filter((o) => inTime(o.createdAt, p));
  const gross = round2(sales.reduce((s, o) => s + o.total, 0));
  const cancelledOrders = sales.filter((o) => o.status === 'cancelled');
  const cancelled = round2(cancelledOrders.reduce((s, o) => s + o.total, 0));
  const net = round2(gross - cancelled);
  const purchases = st.purchases.filter((x) => inDays(x.date, p));
  const bought = round2(purchases.reduce((s, x) => s + x.baseTotal, 0));
  const expenses = st.expenses.filter((x) => inDays(x.date, p));
  const spent = round2(expenses.reduce((s, x) => s + x.baseAmount, 0));
  const byCat = new Map<string, number>();
  for (const e of expenses) byCat.set(e.category, round2((byCat.get(e.category) ?? 0) + e.baseAmount));
  const grossProfit = round2(net - bought);
  const profit = round2(grossProfit - spent);

  // Cash drawer: what should have come in and gone out of the drawer.
  const live = sales.filter((o) => o.status !== 'cancelled');
  const cashIn = round2(
    sales.reduce((s, o) => s + o.payments.filter((x) => x.methodId === 'cash').reduce((a, x) => a + x.baseAmount, 0) - o.changeGiven, 0),
  );
  const cashRefunds = round2(st.cancellations.filter((c) => inTime(c.at, p) && c.refund === 'cash').reduce((s, c) => s + c.refundAmount, 0));
  const changePaidOut = round2(st.credit.filter((e) => e.kind === 'paid_out' && inTime(e.at, p)).reduce((s, e) => s - e.amount, 0));
  const drawerSpend = round2(
    purchases.filter((x) => x.paidFrom === 'cash_drawer').reduce((s, x) => s + x.baseTotal, 0) +
      expenses.filter((x) => x.paidFrom === 'cash_drawer').reduce((s, x) => s + x.baseAmount, 0),
  );
  const changeKept = round2(st.credit.filter((e) => e.kind === 'change_left' && inTime(e.at, p)).reduce((s, e) => s + e.amount, 0));
  return {
    sales, live, gross, cancelled, cancelledCount: cancelledOrders.length, net, bought, spent, byCat, grossProfit, profit,
    cashIn, cashRefunds, changePaidOut, drawerSpend, changeKept,
    drawerNet: round2(cashIn - cashRefunds - changePaidOut - drawerSpend),
  };
}

function Profit({ p }: { p: Period }) {
  const orders = useStore((s) => s.orders);
  const purchases = useStore((s) => s.purchases);
  const expenses = useStore((s) => s.expenses);
  const cancellations = useStore((s) => s.cancellations);
  const credit = useStore((s) => s.credit);
  const menu = useStore((s) => s.menu);
  const base = useBase();
  const f = useMemo(() => figures({ orders, purchases, expenses, cancellations, credit }, p), [orders, purchases, expenses, cancellations, credit, p]);

  // Chart: by day for short periods, by week for long ones.
  const chart = useMemo(() => {
    const weekly = p.days.length > 14;
    const groups: { label: string; days: string[] }[] = [];
    if (!weekly) for (const d of p.days) groups.push({ label: String(Number(d.slice(8))), days: [d] });
    else
      for (let i = 0; i < p.days.length; i += 7) {
        const ds = p.days.slice(i, i + 7);
        groups.push({ label: `${Number(ds[0].slice(8))}/${Number(ds[0].slice(5, 7))}`, days: ds });
      }
    const sum = <T,>(xs: T[], pick: (x: T) => number) => round2(xs.reduce((s, x) => s + pick(x), 0));
    return {
      weekly,
      labels: groups.map((g) => g.label),
      sales: groups.map((g) => sum(orders.filter((o) => o.status !== 'cancelled' && g.days.includes(todayISO(new Date(o.createdAt)))), (o) => o.total)),
      bought: groups.map((g) => sum(purchases.filter((x) => g.days.includes(x.date)), (x) => x.baseTotal)),
      spent: groups.map((g) => sum(expenses.filter((x) => g.days.includes(x.date)), (x) => x.baseAmount)),
    };
  }, [orders, purchases, expenses, p]);

  // Profit per meal (needs a cost per plate on the menu item).
  const perMeal = useMemo(() => {
    const m = new Map<string, { qty: number; sales: number }>();
    for (const o of f.live) for (const l of o.lines) {
      const cur = m.get(l.itemId) ?? { qty: 0, sales: 0 };
      m.set(l.itemId, { qty: cur.qty + l.qty, sales: round2(cur.sales + l.qty * l.unitPrice) });
    }
    return [...m.entries()]
      .map(([id, v]) => {
        const item = menu.find((x) => x.id === id);
        const cost = item?.costPerPlate;
        const totalCost = cost === undefined ? null : round2(cost * v.qty);
        return { id, name: item?.name ?? id, ...v, cost, totalCost, profit: totalCost === null ? null : round2(v.sales - totalCost) };
      })
      .sort((a, b) => (b.profit ?? -1) - (a.profit ?? -1));
  }, [f.live, menu]);

  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const neg = (v: number) => `− ${fmt(v, base)}`;

  return (
    <>
      <div className="stats">
        <div className="card stat">
          <div className="muted lbl">Net sales</div>
          <div className="val">{fmt(f.net, base)}</div>
          <div className="muted sub">after {f.cancelledCount} cancelled</div>
        </div>
        <div className="card stat">
          <div className="muted lbl">Food & stock bought</div>
          <div className="val">{fmt(f.bought, base)}</div>
          <div className="muted sub">{pct(f.bought, f.net)} of sales (food cost)</div>
        </div>
        <div className="card stat">
          <div className="muted lbl">Expenses</div>
          <div className="val">{fmt(f.spent, base)}</div>
          <div className="muted sub">{pct(f.spent, f.net)} of sales</div>
        </div>
        <div className={`card stat profit-card ${f.profit < 0 ? 'loss' : ''}`}>
          <div className="lbl">{f.profit < 0 ? 'Loss' : 'Profit'}</div>
          <div className="val">{fmt(Math.abs(f.profit), base)}</div>
          <div className="sub">{pct(f.profit, f.net)} of sales</div>
        </div>
      </div>

      <div className="pl-grid">
        <div className="card pl">
          <div className="pl-title">Profit and loss</div>
          <div className="pl-row">
            <span>Sales rung up</span>
            <span>{fmt(f.gross, base)}</span>
          </div>
          <div className="pl-row minus">
            <span>Cancelled sales ({f.cancelledCount})</span>
            <span>{neg(f.cancelled)}</span>
          </div>
          <div className="pl-row total">
            <span>Net sales</span>
            <span>{fmt(f.net, base)}</span>
          </div>
          <div className="pl-row minus">
            <span>Food & stock bought</span>
            <span>{neg(f.bought)}</span>
          </div>
          <div className="pl-row total">
            <span>Gross profit</span>
            <span>{fmt(f.grossProfit, base)}</span>
          </div>
          {[...f.byCat.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([cat, v]) => (
              <div key={cat} className="pl-row minus">
                <span>{cat}</span>
                <span>{neg(v)}</span>
              </div>
            ))}
          <div className={`pl-row grand ${f.profit < 0 ? 'loss' : ''}`}>
            <span>{f.profit < 0 ? 'Loss' : 'Profit'}</span>
            <span>{fmt(f.profit, base)}</span>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            Food cost counts what was bought in this period, not what was used. Stock counts come with stock-taking.
          </p>
        </div>

        <div className="card pl">
          <div className="pl-title">Cash drawer in this period</div>
          <div className="pl-row">
            <span>Cash from sales (after change)</span>
            <span>{fmt(f.cashIn, base)}</span>
          </div>
          <div className="pl-row minus">
            <span>Cash refunds</span>
            <span>{neg(f.cashRefunds)}</span>
          </div>
          <div className="pl-row minus">
            <span>Customer change paid out</span>
            <span>{neg(f.changePaidOut)}</span>
          </div>
          <div className="pl-row minus">
            <span>Purchases & expenses paid from drawer</span>
            <span>{neg(f.drawerSpend)}</span>
          </div>
          <div className="pl-row grand">
            <span>Drawer should have grown by</span>
            <span>{fmt(f.drawerNet, base)}</span>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            Includes {fmt(f.changeKept, base)} of change kept for customers that is still theirs. Compare with the cash counted at shift close.
          </p>
        </div>
      </div>

      <BarChart
        grouped
        caption={`Money in and out — ${chart.weekly ? 'by week' : 'by day'}`}
        labels={chart.labels}
        series={[
          { name: 'Net sales', color: MONEY_COLORS.sales, values: chart.sales },
          { name: 'Bought', color: MONEY_COLORS.bought, values: chart.bought },
          { name: 'Expenses', color: MONEY_COLORS.expenses, values: chart.spent },
        ]}
        format={(v) => fmt(v, base)}
        tickFormat={(v) => `${base.symbol}${v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : Math.round(v)}`}
      />

      <div className="section-title">Profit per meal</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <th>Meal</th>
              <th>Sold</th>
              <th>Sales</th>
              <th>Cost per plate</th>
              <th>Profit</th>
              <th>Margin</th>
            </tr>
          </thead>
          <tbody>
            {perMeal.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="num">{m.qty}</td>
                <td className="num">{fmt(m.sales, base)}</td>
                <td className="num">
                  {m.cost === undefined ? (
                    <button className="link-btn" onClick={() => go('/menu')}>
                      Set cost
                    </button>
                  ) : (
                    fmt(m.cost, base)
                  )}
                </td>
                <td className="num">
                  <b>{m.profit === null ? '—' : fmt(m.profit, base)}</b>
                </td>
                <td className="num">{m.profit === null ? '—' : pct(m.profit, m.sales)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ================================================================ purchases */

function Purchases({ p }: { p: Period }) {
  const all = useStore((s) => s.purchases);
  const staff = useStore((s) => s.staff);
  const currencies = useStore((s) => s.currencies);
  const base = useBase();
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState<Purchase | null>(null);
  const list = useMemo(() => all.filter((x) => inDays(x.date, p)).sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)), [all, p]);
  const reversed = new Set(all.filter((x) => x.reversesId).map((x) => x.reversesId));
  const total = round2(list.reduce((s, x) => s + x.baseTotal, 0));
  const bySupplier = new Map<string, number>();
  for (const x of list) bySupplier.set(x.supplier, round2((bySupplier.get(x.supplier) ?? 0) + x.baseTotal));

  return (
    <>
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <b style={{ fontSize: 18 }}>
          Bought in this period: {fmt(total, base)}
        </b>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Record a purchase
        </button>
      </div>
      {bySupplier.size > 0 && (
        <div className="chips-row">
          {[...bySupplier.entries()].sort((a, b) => b[1] - a[1]).map(([s, v]) => (
            <span key={s} className="tag">
              {s}: {fmt(v, base)}
            </span>
          ))}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <th>Date</th>
              <th>Supplier</th>
              <th>Items</th>
              <th>Paid from</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 200).map((x) => (
              <tr key={x.id} className={x.reversesId || reversed.has(x.id) ? 'struck' : ''}>
                <td className="num">{x.date}</td>
                <td>
                  <b>{x.supplier}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    by {staff.find((s) => s.id === x.by)?.name}
                  </div>
                </td>
                <td style={{ fontSize: 13 }}>
                  {x.lines.map((l) => `${Math.abs(l.qty)} ${l.unit} ${l.name}`).join(', ')}
                  {x.reversesId && <div className="muted">Reversal: {x.reason}</div>}
                </td>
                <td>{PAID_FROM[x.paidFrom]}</td>
                <td className="num">
                  <b>{fmt(x.total, currencies.find((c) => c.code === x.currency))}</b>
                  {x.reversesId && <span className="tag rev" style={{ marginLeft: 6 }}>reversal</span>}
                  {reversed.has(x.id) && <span className="tag rev" style={{ marginLeft: 6 }}>reversed</span>}
                </td>
                <td>
                  {x.example ? (
                    <span className="muted" style={{ fontSize: 12 }}>example</span>
                  ) : (
                    !x.reversesId &&
                    !reversed.has(x.id) && (
                      <button className="btn" onClick={() => setReversing(x)}>
                        Reverse
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No purchases recorded in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {adding && <PurchaseDialog onClose={() => setAdding(false)} />}
      {reversing && (
        <ReverseDialog
          what={`purchase from ${reversing.supplier} on ${reversing.date}`}
          onClose={() => setReversing(null)}
          onReverse={(reason, by) => reversePurchase(reversing.id, reason, by)}
        />
      )}
    </>
  );
}

interface LineDraft {
  name: string;
  qty: string;
  unit: string;
  unitCost: string;
}

function PurchaseDialog({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser()!;
  const stock = useStore((s) => s.stockItems);
  const purchases = useStore((s) => s.purchases);
  const currencies = useStore((s) => s.currencies);
  const base = useBase();
  const [date, setDate] = useState(todayISO());
  const [supplier, setSupplier] = useState('');
  const [currency, setCurrency] = useState(base.code);
  const [paidFrom, setPaidFrom] = useState<PaidFrom>('cash_drawer');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ name: '', qty: '', unit: '', unitCost: '' }]);
  const [error, setError] = useState('');
  const cur = currencies.find((c) => c.code === currency)!;
  const suppliers = useMemo(() => [...new Set(purchases.map((x) => x.supplier))].sort(), [purchases]);

  const setLine = (i: number, patch: Partial<LineDraft>) => {
    setLines((ls) => {
      const next = ls.map((l, j) => (j === i ? { ...l, ...patch } : l));
      // Known item: fill its unit and last cost.
      if (patch.name !== undefined) {
        const item = stock.find((s) => s.name.toLowerCase() === patch.name!.trim().toLowerCase());
        if (item) {
          next[i] = {
            ...next[i],
            unit: next[i].unit || item.unit,
            unitCost: next[i].unitCost || (item.lastUnitCost !== undefined ? String(round2(item.lastUnitCost * cur.rate)) : ''),
          };
        }
      }
      // Always keep one empty line at the end for the next item.
      const last = next[next.length - 1];
      if (last.name.trim()) next.push({ name: '', qty: '', unit: '', unitCost: '' });
      return next;
    });
  };

  const parsed = lines.filter((l) => l.name.trim()).map((l) => ({ name: l.name, qty: Number(l.qty) || 0, unit: l.unit, unitCost: Number(l.unitCost) || 0 }));
  const total = round2(parsed.reduce((s, l) => s + l.qty * l.unitCost, 0));

  const save = () => {
    const r = recordPurchase({ date, supplier, lines: parsed, currency, paidFrom, note, by: user.id });
    if (!r.ok) return setError(r.error);
    toast(`Purchase of ${fmt(r.purchase.total, cur)} recorded`);
    onClose();
  };

  return (
    <Dialog
      title="Record a purchase"
      onClose={onClose}
      width={860}
      footer={
        <>
          {error && <span className="error" style={{ marginRight: 'auto' }}>{error}</span>}
          <b style={{ fontSize: 20 }}>Total {fmt(total, cur)}</b>
          <button className="btn primary" onClick={save}>
            Save purchase
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          Date bought
          <input id="pur-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          Supplier / where
          <input id="pur-supplier" list="supplier-list" placeholder="e.g. Mbare Musika, Butchery" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <datalist id="supplier-list">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="field">
          Currency
          <select id="pur-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.filter((c) => c.enabled).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Paid from
          <select id="pur-paid" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value as PaidFrom)}>
            {Object.entries(PAID_FROM).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="section-title">What was bought</div>
      <datalist id="stock-list">
        {stock.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      <div style={{ overflowX: 'auto' }}>
        <table className="list lines-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Cost per unit ({cur.code})</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <input id={`pl-name-${i}`} list="stock-list" placeholder="Start typing, e.g. Beef" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} />
                </td>
                <td>
                  <input id={`pl-qty-${i}`} inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^\d.]/g, '') })} style={{ width: 80 }} />
                </td>
                <td>
                  <input id={`pl-unit-${i}`} placeholder="kg, bag…" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} style={{ width: 120 }} />
                </td>
                <td>
                  <input id={`pl-cost-${i}`} inputMode="decimal" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value.replace(/[^\d.]/g, '') })} style={{ width: 110 }} />
                </td>
                <td className="num">{l.name.trim() ? fmt(round2((Number(l.qty) || 0) * (Number(l.unitCost) || 0)), cur) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="field">
        Note (optional)
        <input id="pur-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Receipt number, who went to buy…" />
      </label>
    </Dialog>
  );
}

/* ================================================================ expenses */

function Expenses({ p }: { p: Period }) {
  const all = useStore((s) => s.expenses);
  const staff = useStore((s) => s.staff);
  const currencies = useStore((s) => s.currencies);
  const base = useBase();
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState<Expense | null>(null);
  const list = useMemo(() => all.filter((x) => inDays(x.date, p)).sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)), [all, p]);
  const reversed = new Set(all.filter((x) => x.reversesId).map((x) => x.reversesId));
  const total = round2(list.reduce((s, x) => s + x.baseAmount, 0));
  const byCat = new Map<string, number>();
  for (const x of list) byCat.set(x.category, round2((byCat.get(x.category) ?? 0) + x.baseAmount));

  return (
    <>
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <b style={{ fontSize: 18 }}>Expenses in this period: {fmt(total, base)}</b>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Record an expense
        </button>
      </div>
      {byCat.size > 0 && (
        <div className="chips-row">
          {[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => (
            <span key={c} className="tag">
              {c}: {fmt(v, base)}
            </span>
          ))}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <th>Date</th>
              <th>For</th>
              <th>Paid from</th>
              <th>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 200).map((x) => (
              <tr key={x.id} className={x.reversesId || reversed.has(x.id) ? 'struck' : ''}>
                <td className="num">{x.date}</td>
                <td>
                  <b>{x.category}</b> · {x.description}
                  <div className="muted" style={{ fontSize: 12 }}>
                    by {staff.find((s) => s.id === x.by)?.name}
                    {x.reversesId && ` · reversal: ${x.reason}`}
                  </div>
                </td>
                <td>{PAID_FROM[x.paidFrom]}</td>
                <td className="num">
                  <b>{fmt(x.amount, currencies.find((c) => c.code === x.currency))}</b>
                  {x.reversesId && <span className="tag rev" style={{ marginLeft: 6 }}>reversal</span>}
                  {reversed.has(x.id) && <span className="tag rev" style={{ marginLeft: 6 }}>reversed</span>}
                </td>
                <td>
                  {x.example ? (
                    <span className="muted" style={{ fontSize: 12 }}>example</span>
                  ) : (
                    !x.reversesId &&
                    !reversed.has(x.id) && (
                      <button className="btn" onClick={() => setReversing(x)}>
                        Reverse
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No expenses recorded in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {adding && <ExpenseDialog onClose={() => setAdding(false)} />}
      {reversing && (
        <ReverseDialog
          what={`${reversing.category} expense on ${reversing.date}`}
          onClose={() => setReversing(null)}
          onReverse={(reason, by) => reverseExpense(reversing.id, reason, by)}
        />
      )}
    </>
  );
}

function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser()!;
  const currencies = useStore((s) => s.currencies);
  const base = useBase();
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(base.code);
  const [paidFrom, setPaidFrom] = useState<PaidFrom>('cash_drawer');
  const [error, setError] = useState('');
  const cur = currencies.find((c) => c.code === currency)!;

  const save = () => {
    const r = recordExpense({ date, category, description, amount: Number(amount) || 0, currency, paidFrom, by: user.id });
    if (!r.ok) return setError(r.error);
    toast(`${r.expense.category} ${fmt(r.expense.amount, cur)} recorded`);
    onClose();
  };

  return (
    <Dialog
      title="Record an expense"
      onClose={onClose}
      width={640}
      footer={
        <>
          {error && <span className="error" style={{ marginRight: 'auto' }}>{error}</span>}
          <button className="btn primary" onClick={save}>
            Save expense
          </button>
        </>
      }
    >
      <div className="step-label">What was it for?</div>
      <div className="seg small">
        {EXPENSE_CATEGORIES.map((c) => (
          <button key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label className="field">
          Details
          <input id="exp-desc" placeholder="e.g. Wages for Tafara and Rudo" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          Amount ({cur.code})
          <input id="exp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className="field">
          Currency
          <select id="exp-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.filter((c) => c.enabled).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Date
          <input id="exp-date" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          Paid from
          <select id="exp-paid" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value as PaidFrom)}>
            {Object.entries(PAID_FROM).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Dialog>
  );
}

function ReverseDialog({ what, onClose, onReverse }: { what: string; onClose: () => void; onReverse: (reason: string, by: string) => { ok: boolean; error?: string } }) {
  const user = useCurrentUser()!;
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  return (
    <Dialog
      title="Reverse a record"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Keep it
          </button>
          <button
            className="btn danger-fill"
            onClick={() => {
              const r = onReverse(reason, user.id);
              if (!r.ok) return setError(r.error ?? 'Could not reverse.');
              toast('Reversed. Both records stay in the books.');
              onClose();
            }}
          >
            Reverse it
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        This adds a reversing record that cancels the {what}. The original stays visible, so the books always add up.
      </p>
      <label className="field">
        Reason
        <input id="reverse-reason" autoFocus placeholder="e.g. Entered twice, wrong amount" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <div className="error">{error}</div>}
    </Dialog>
  );
}

/* ================================================================ journal */

function Journal({ p }: { p: Period }) {
  const orders = useStore((s) => s.orders);
  const staff = useStore((s) => s.staff);
  const methods = useStore((s) => s.paymentMethods);
  const currencies = useStore((s) => s.currencies);
  const cancellations = useStore((s) => s.cancellations);
  const base = useBase();
  const [q, setQ] = useState('');
  const [show, setShow] = useState(100);
  const [cancelling, setCancelling] = useState<Order | null>(null);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orders
      .filter((o) => inTime(o.createdAt, p))
      .filter((o) => !term || String(o.number) === term || o.lines.some((l) => l.name.toLowerCase().includes(term)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [orders, p, q]);
  const paid = round2(list.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0));

  return (
    <>
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <b style={{ fontSize: 18 }}>
          {list.length} sales · {fmt(paid, base)} kept
        </b>
        <input id="journal-search" className="plain-input" style={{ maxWidth: 280, marginTop: 0 }} placeholder="Search card number or meal" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Every sale is a permanent record. A mistake is fixed by cancelling it with a manager PIN — the sale stays here, marked cancelled.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <th>When</th>
              <th>No.</th>
              <th>Items</th>
              <th>Paid with</th>
              <th>Cashier</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, show).map((o) => {
              const c = o.cancellationId ? cancellations.find((x) => x.id === o.cancellationId) : undefined;
              return (
                <tr key={o.id} className={o.status === 'cancelled' ? 'struck' : ''}>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(o.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td>
                    <b>{o.number}</b>
                    {o.parentOrderId && <div className="muted" style={{ fontSize: 12 }}>add-on</div>}
                  </td>
                  <td style={{ fontSize: 13 }}>{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</td>
                  <td style={{ fontSize: 13 }}>
                    {o.payments
                      .map((x) => `${x.methodId === CREDIT_METHOD ? 'Change' : methods.find((m) => m.id === x.methodId)?.name ?? x.methodId} ${fmt(x.amount, currencies.find((cc) => cc.code === x.currency))}`)
                      .join(' + ')}
                  </td>
                  <td style={{ fontSize: 13 }}>{staff.find((s) => s.id === o.cashierId)?.name}</td>
                  <td className="num">
                    <b>{fmt(o.total, base)}</b>
                    {o.status === 'cancelled' && (
                      <div>
                        <span className="tag void" title={c?.reason}>
                          cancelled
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    {o.status !== 'cancelled' && !o.parentOrderId && !o.example && (
                      <button className="btn" onClick={() => setCancelling(o)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > show && (
        <button className="btn" style={{ marginTop: 10 }} onClick={() => setShow((n) => n + 200)}>
          Show more ({list.length - show} older)
        </button>
      )}
      {cancelling && <CancelSaleDialog order={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

/* ================================================================ cancellations */

function Cancellations({ p }: { p: Period }) {
  const all = useStore((s) => s.cancellations);
  const staff = useStore((s) => s.staff);
  const base = useBase();
  const list = useMemo(() => all.filter((c) => inTime(c.at, p)).sort((a, b) => b.at.localeCompare(a.at)), [all, p]);
  const total = round2(list.reduce((s, c) => s + c.orderTotal, 0));
  const refunded = round2(list.reduce((s, c) => s + c.refundAmount, 0));
  const byPerson = new Map<string, number>();
  for (const c of list) byPerson.set(c.requestedBy, (byPerson.get(c.requestedBy) ?? 0) + 1);
  const name = (id: string) => staff.find((s) => s.id === id)?.name ?? id;
  const REFUND: Record<string, string> = { cash: 'Cash back', to_change: "To customer's change", none: 'No money back' };

  return (
    <>
      <div className="stats">
        <div className="card stat">
          <div className="muted lbl">Cancelled sales</div>
          <div className="val">{list.length}</div>
        </div>
        <div className="card stat">
          <div className="muted lbl">Value cancelled</div>
          <div className="val">{fmt(total, base)}</div>
        </div>
        <div className="card stat">
          <div className="muted lbl">Money given back</div>
          <div className="val">{fmt(refunded, base)}</div>
        </div>
      </div>
      {byPerson.size > 0 && (
        <div className="chips-row" style={{ marginTop: 12 }}>
          <span className="muted">Asked for by:</span>
          {[...byPerson.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => (
            <span key={id} className="tag">
              {name(id)}: {n}
            </span>
          ))}
        </div>
      )}
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table className="list">
          <thead>
            <tr>
              <th>When</th>
              <th>Sale</th>
              <th>Reason</th>
              <th>Money back</th>
              <th>Asked by</th>
              <th>Approved by</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {new Date(c.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td>
                  <b>#{c.orderNumber}</b> · {fmt(c.orderTotal, base)}
                </td>
                <td>{c.reason}</td>
                <td>
                  {REFUND[c.refund]}
                  {c.refundAmount > 0 && ` ${fmt(c.refundAmount, base)}`}
                </td>
                <td>{name(c.requestedBy)}</td>
                <td>
                  <b>{name(c.approvedBy)}</b>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No cancelled sales in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
