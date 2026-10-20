import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { fmt, round2 } from '../domain/money';
import { balances, fmtDuration, serviceTimes } from '../domain/rules';
import {
  allOrdersIn,
  buckets,
  customersIn,
  demandByHour,
  GRAIN_LABEL,
  hourProfile,
  labelPartial,
  mealPeriodStats,
  METRICS,
  metricValue,
  pctChange,
  periodRange,
  PERIODS,
  readyBy,
  seriesFor,
  weekdayHourGrid,
  type DemandTarget,
  type Grain,
  type MetricKey,
  type PeriodKey,
} from '../domain/analytics';
import { CREDIT_METHOD, type Currency } from '../domain/types';
import { TopBar } from '../components/ui';
import BarChart from '../components/BarChart';
import { Heatmap, Sparkline, TrendChart } from '../components/charts';

type Tab = 'overview' | 'busy' | 'sells' | 'service' | 'money';
const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['busy', 'Busy times & staff'],
  ['sells', 'What sells when'],
  ['service', 'Serving speed'],
  ['money', 'Money'],
];
const TYPE_COLORS = ['#9a3412', '#2563eb', '#6d28d9'];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const one = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));

export default function Analytics() {
  const orders = useStore((s) => s.orders);
  const settings = useStore((s) => s.settings);
  const currencies = useStore((s) => s.currencies);
  const base = currencies.find((c) => c.code === settings.baseCurrency)!;
  const [tab, setTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [includeTraining, setIncludeTraining] = useState(true);
  const lateMs = settings.lateAfterMinutes * 60000;

  const open = useMemo(
    () => ({ from: Math.min(...settings.mealPeriods.map((p) => p.from)), to: Math.max(...settings.mealPeriods.map((p) => p.to)) }),
    [settings.mealPeriods],
  );
  const hours = useMemo(() => Array.from({ length: open.to - open.from }, (_, i) => open.from + i), [open]);

  const dataFrom = useMemo(() => orders.reduce((m, o) => Math.min(m, Date.parse(o.createdAt)), Infinity), [orders]);

  const data = useMemo(() => {
    const r = periodRange(period);
    // Compare like with like: the previous period only up to the same point in time
    // (e.g. today until 15:00 against yesterday until 15:00).
    const full = periodRange(period, new Date(), 1);
    const prev = { ...full, end: new Date(full.end.getTime() - (r.end.getTime() - Date.now())) };
    return {
      r,
      prev,
      customers: customersIn(orders, r, includeTraining),
      all: allOrdersIn(orders, r, includeTraining),
      prevCustomers: customersIn(orders, prev, includeTraining),
      prevAll: allOrdersIn(orders, prev, includeTraining),
    };
  }, [orders, period, includeTraining]);

  const ctx = { ...data, base, lateMs, hours, open, period, dataFrom };

  return (
    <div className="app">
      <TopBar title="Analytics" />
      <div className="page">
        <div className="an-wrap">
          <div className="an-controls">
            <div className="seg">
              {PERIODS.map((p) => (
                <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            <label className="row" style={{ gap: 8, fontSize: 14 }}>
              <input id="include-training" type="checkbox" checked={includeTraining} onChange={(e) => setIncludeTraining(e.target.checked)} />
              Include training &amp; example orders
            </label>
          </div>
          <div className="tabs an-tabs">
            {TABS.map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
          {data.customers.length === 0 && <div className="card empty">No orders in this period yet.</div>}
          {data.customers.length > 0 && tab === 'overview' && <Overview {...ctx} />}
          {data.customers.length > 0 && tab === 'busy' && <BusyTimes {...ctx} />}
          {data.customers.length > 0 && tab === 'sells' && <SellsWhen {...ctx} />}
          {data.customers.length > 0 && tab === 'service' && <Service {...ctx} />}
          {data.customers.length > 0 && tab === 'money' && <Money {...ctx} />}
        </div>
      </div>
    </div>
  );
}

type Ctx = {
  r: ReturnType<typeof periodRange>;
  prev: ReturnType<typeof periodRange>;
  customers: import('../domain/types').Order[];
  all: import('../domain/types').Order[];
  prevCustomers: import('../domain/types').Order[];
  prevAll: import('../domain/types').Order[];
  base: Currency;
  lateMs: number;
  hours: number[];
  open: { from: number; to: number };
  period: PeriodKey;
  /** Time of the oldest order on record (no data before it). */
  dataFrom: number;
};

function compactMoney(v: number, base: Currency): string {
  const n = v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : v % 1 === 0 ? String(v) : v.toFixed(2);
  return base.symbol.length <= 1 ? `${base.symbol}${n}` : `${base.symbol} ${n}`;
}

function fmtMetric(key: MetricKey, v: number | null, base: Currency): string {
  if (v === null) return '—';
  switch (key) {
    case 'customers':
      return one(v);
    case 'sales':
    case 'avgOrder':
      return fmt(v, base);
    case 'avgWait':
      return fmtDuration(v);
    default:
      return `${Math.round(v)}%`;
  }
}

/* ================================================================ overview */

function Overview({ r, prev, customers, all, prevCustomers, prevAll, base, lateMs, open, period, dataFrom }: Ctx) {
  const [metric, setMetric] = useState<MetricKey>('customers');
  const grains = PERIODS.find((p) => p.key === period)!.grains;
  const [grainPick, setGrain] = useState<Grain>('day');
  const grain = grains.includes(grainPick) ? grainPick : grains[0];
  const bs = useMemo(() => labelPartial(buckets(r, grain, open), grain), [r, grain, open]);
  const pbs = useMemo(() => buckets(prev, grain, open), [prev, grain, open]);
  const spark = useMemo(() => buckets(r, PERIODS.find((p) => p.key === period)!.days > 1 ? 'day' : 'hour', open), [r, period, open]);

  const values = useMemo(() => seriesFor(metric, bs, customers, all, lateMs, dataFrom), [metric, bs, customers, all, lateMs, dataFrom]);
  const compare = useMemo(
    () => seriesFor(metric, pbs, prevCustomers, prevAll, lateMs, dataFrom, prev.end.getTime()).slice(0, bs.length),
    [metric, pbs, prevCustomers, prevAll, lateMs, bs.length, dataFrom, prev.end],
  );
  const def = METRICS.find((m) => m.key === metric)!;
  const prevLabel = period === 'today' ? 'yesterday' : `previous ${PERIODS.find((p) => p.key === period)!.label}`;

  return (
    <>
      <div className="metric-grid">
        {METRICS.map((m) => {
          const now = metricValue(m.key, customers, all, lateMs);
          const before = metricValue(m.key, prevCustomers, prevAll, lateMs);
          const ch = pctChange(now, before);
          const good = ch === null || m.better === 'none' ? 'flat' : (ch > 0) === (m.better === 'up') ? 'good' : 'bad';
          return (
            <button key={m.key} className={`metric ${metric === m.key ? 'on' : ''}`} onClick={() => setMetric(m.key)} aria-pressed={metric === m.key}>
              <span className="m-label">{m.label}</span>
              <span className="m-value">{fmtMetric(m.key, now, base)}</span>
              <span className="m-foot">
                {ch === null ? (
                  <span className="chg flat">no earlier data</span>
                ) : (
                  <span className={`chg ${good}`}>
                    {ch >= 0 ? '▲' : '▼'} {Math.abs(Math.round(ch))}%
                  </span>
                )}
                <Sparkline values={seriesFor(m.key, spark, customers, all, lateMs)} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="row wrap" style={{ justifyContent: 'space-between', marginTop: 18 }}>
        <h2 className="rep-h" style={{ margin: 0 }}>
          {def.label}
        </h2>
        <div className="seg small">
          {grains.map((g) => (
            <button key={g} className={grain === g ? 'on' : ''} onClick={() => setGrain(g)}>
              {GRAIN_LABEL[g]}
            </button>
          ))}
        </div>
      </div>
      <TrendChart
        caption={`${def.label} — ${GRAIN_LABEL[grain].toLowerCase()}, compared with ${prevLabel}`}
        labels={bs.map((b) => b.label)}
        values={values}
        compare={compare}
        format={(v) => fmtMetric(metric, v, base)}
        tickFormat={(v) => (metric === 'sales' || metric === 'avgOrder' ? compactMoney(v, base) : fmtMetric(metric, v, base))}
      />
      <p className="muted" style={{ fontSize: 13 }}>
        Tap a card to chart it. ▲▼ compare with the {prevLabel}. Green means better for the business.
      </p>
    </>
  );
}

/* ================================================================ busy times */

function BusyTimes({ r, customers, all, lateMs, hours }: Ctx) {
  const settings = useStore((s) => s.settings);
  const orderTypes = useStore((s) => s.orderTypes);
  const prof = useMemo(() => hourProfile(customers, r, hours, lateMs), [customers, r, hours, lateMs]);
  const grid = useMemo(() => weekdayHourGrid(customers, r, hours), [customers, r, hours]);
  const periods = useMemo(() => mealPeriodStats(customers, all, r, settings.mealPeriods, lateMs), [customers, all, r, settings.mealPeriods, lateMs]);
  const cap = Math.max(1, settings.customersPerStaffHour);
  const staff = (n: number) => Math.max(1, Math.ceil(n / cap));
  const types = orderTypes.filter((t) => customers.some((o) => o.orderTypeId === t.id));
  const perType = types.map((t) => hours.map((h) => customers.filter((o) => o.orderTypeId === t.id && new Date(o.createdAt).getHours() === h).length / r.days.length));

  const peakIdx = prof.reduce((bi, p, i) => (p.avg > prof[bi].avg ? i : bi), 0);
  let busiestCell = { d: 0, h: 0, v: 0 };
  grid.forEach((row, d) => row.forEach((v, h) => v > busiestCell.v && (busiestCell = { d, h, v })));
  // The rush = the unbroken run of hours around the peak with at least 60% of the peak's customers.
  let rs = peakIdx, re = peakIdx;
  while (rs > 0 && prof[rs - 1].avg >= prof[peakIdx].avg * 0.6) rs--;
  while (re < prof.length - 1 && prof[re + 1].avg >= prof[peakIdx].avg * 0.6) re++;
  const rushHours = prof.slice(rs, re + 1);
  const rushStaff = staff(Math.max(...rushHours.map((p) => p.peak)));
  const worstLate = prof.filter((p) => p.latePct !== null).sort((a, b) => (b.latePct ?? 0) - (a.latePct ?? 0))[0];

  return (
    <>
      <div className="insight">
        <div>
          <b>Busiest hour:</b> {hh(prof[peakIdx].hour)} with about {one(prof[peakIdx].avg)} customers a day (up to {prof[peakIdx].peak} on the busiest day).
        </div>
        {r.days.length >= 7 && (
          <div>
            <b>Busiest slot of the week:</b> {WEEK[busiestCell.d]} {hh(hours[busiestCell.h])}, about {one(busiestCell.v)} customers.
          </div>
        )}
        {rushHours.length > 0 && (
          <div>
            <b>Rush:</b> {hh(rushHours[0].hour)}–{hh(rushHours[rushHours.length - 1].hour + 1)} — plan {rushStaff} {rushStaff === 1 ? 'person' : 'people'}{' '}
            serving (one person handles about {cap} customers an hour).
          </div>
        )}
        {worstLate && (worstLate.latePct ?? 0) > 0 && (
          <div>
            <b>Most late orders:</b> {hh(worstLate.hour)} ({Math.round(worstLate.latePct!)}% late) — the kitchen needs help here first.
          </div>
        )}
      </div>

      <div className="section-title">Parts of the day</div>
      <div className="period-grid">
        {periods.map((p) => (
          <div key={p.period.id} className="card period-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{p.period.name}</b>
              <span className="muted" style={{ fontSize: 13 }}>
                {hh(p.period.from)}–{hh(p.period.to)}
              </span>
            </div>
            <div className="pc-big">{one(p.customersPerDay)}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              customers a day · {Math.round(p.salesShare)}% of sales
            </div>
            <div className="pc-rows">
              <span>Peak</span>
              <b>{p.peakHour === null ? '—' : hh(p.peakHour)}</b>
              <span>Average wait</span>
              <b>{p.avgWait === null ? '—' : fmtDuration(p.avgWait)}</b>
              <span>Late</span>
              <b>{p.latePct === null ? '—' : `${Math.round(p.latePct)}%`}</b>
            </div>
            {p.topItems.length > 0 && (
              <div className="muted" style={{ fontSize: 13 }}>
                Top: {p.topItems.map((t) => t.name).join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>

      <BarChart
        caption={r.days.length > 1 ? `Customers by hour — average per day` : 'Customers by hour'}
        labels={hours.map(hh)}
        series={types.map((t, i) => ({ name: t.name, color: TYPE_COLORS[i] ?? '#57534e', values: perType[i] }))}
        format={one}
        unit="customers"
        highlight={peakIdx}
      />

      {r.days.length >= 7 && (
        <Heatmap
          caption="When customers come — average per day, by weekday and hour"
          rows={WEEK}
          cols={hours.map((h) => String(h).padStart(2, '0'))}
          values={grid}
          format={(v) => one(v)}
          cellTitle={(ri, ci) => `${WEEK[ri]} ${hh(hours[ci])}: about ${one(grid[ri][ci])} customers`}
        />
      )}

      <div className="section-title">Staff plan by hour</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="list staff-table">
          <thead>
            <tr>
              <th>Hour</th>
              <th>Customers (avg)</th>
              <th>Busiest day</th>
              <th>Serving staff</th>
              <th>Late</th>
            </tr>
          </thead>
          <tbody>
            {prof.map((p) => (
              <tr key={p.hour} className={rushHours.includes(p) ? 'rush' : ''}>
                <td>
                  <b>{hh(p.hour)}</b>
                </td>
                <td>
                  <span className="mini-bar">
                    <span style={{ width: `${(p.avg / Math.max(0.01, prof[peakIdx].avg)) * 100}%` }} />
                  </span>
                  {one(p.avg)}
                </td>
                <td className="num">{p.peak}</td>
                <td>
                  <span className="staff-dots" aria-label={`${staff(p.peak)} people`}>
                    {'●'.repeat(staff(p.peak))}
                  </span>{' '}
                  {staff(p.peak)}
                </td>
                <td className="num" style={(p.latePct ?? 0) >= 20 ? { color: 'var(--bad)', fontWeight: 800 } : undefined}>
                  {p.latePct === null ? '—' : `${Math.round(p.latePct)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Staff is planned for the busiest day at each hour, at {cap} customers per person an hour. Change this and the parts of the day in Settings →
        Serving times.
      </p>
    </>
  );
}

/* ================================================================ what sells when */

function SellsWhen({ r, all, hours }: Ctx) {
  const menu = useStore((s) => s.menu);
  const components = useStore((s) => s.components);
  const categories = useStore((s) => s.categories);
  const [target, setTarget] = useState<DemandTarget>(() => {
    const sadza = components.find((c) => c.id === 'sadza') ?? components[0];
    return { kind: 'component', id: sadza.id, name: sadza.name };
  });
  const values = useMemo(() => demandByHour(all, r, hours, target, menu), [all, r, hours, target, menu]);
  const rb = readyBy(values, hours);
  const daily = values.reduce((a, b) => a + b, 0);
  const peakIdx = values.indexOf(Math.max(...values));

  // Prepare-by plan for every ingredient and every category.
  const plan = useMemo(() => {
    const targets: DemandTarget[] = [
      ...components.map((c) => ({ kind: 'component' as const, id: c.id, name: c.name })),
      ...categories.map((c) => ({ kind: 'category' as const, id: c.id, name: `All ${c.name.toLowerCase()}` })),
    ];
    return targets
      .map((t) => {
        const v = demandByHour(all, r, hours, t, menu);
        return { t, daily: v.reduce((a, b) => a + b, 0), rb: readyBy(v, hours) };
      })
      .filter((x) => x.daily > 0)
      .sort((a, b) => (a.rb?.readyBy ?? '99').localeCompare(b.rb?.readyBy ?? '99'));
  }, [all, r, hours, menu, components, categories]);

  const isOn = (k: DemandTarget['kind'], id: string) => target.kind === k && target.id === id;

  return (
    <>
      <div className="pick-groups">
        <div>
          <div className="step-label">Ingredient</div>
          <div className="seg small">
            {components.map((c) => (
              <button key={c.id} className={isOn('component', c.id) ? 'on' : ''} onClick={() => setTarget({ kind: 'component', id: c.id, name: c.name })}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="step-label">Group</div>
          <div className="seg small">
            {categories.map((c) => (
              <button key={c.id} className={isOn('category', c.id) ? 'on' : ''} onClick={() => setTarget({ kind: 'category', id: c.id, name: c.name })}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <label className="field" style={{ marginTop: 0, maxWidth: 320 }}>
          Or one item
          <select
            id="sells-item"
            value={target.kind === 'item' ? target.id : ''}
            onChange={(e) => {
              const m = menu.find((x) => x.id === e.target.value);
              if (m) setTarget({ kind: 'item', id: m.id, name: m.name });
            }}
          >
            <option value="">Choose a menu item…</option>
            {menu.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="insight">
        {rb ? (
          <>
            <div>
              <b>{target.name}:</b> about {one(daily)} portions a day. Most at <b>{hh(rb.peakHour)}</b> ({one(values[peakIdx])} an hour).
            </div>
            <div>
              <b>Rush:</b> {hh(rb.rushFrom)}–{hh(rb.rushTo)}. Have it ready by <b>{rb.readyBy}</b>.
            </div>
          </>
        ) : (
          <div>No {target.name.toLowerCase()} sold in this period.</div>
        )}
      </div>

      <BarChart
        caption={`${target.name} — portions by hour${r.days.length > 1 ? ', average per day' : ''}`}
        labels={hours.map(hh)}
        series={[{ name: target.name, color: 'var(--brand)', values }]}
        format={one}
        unit="portions"
        highlight={peakIdx}
      />

      <div className="section-title">Preparation plan — ready by</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <th>What</th>
              <th>Portions a day</th>
              <th>Rush</th>
              <th>Ready by</th>
            </tr>
          </thead>
          <tbody>
            {plan.map((p) => (
              <tr key={p.t.kind + p.t.id}>
                <td>
                  <b>{p.t.name}</b>
                </td>
                <td className="num">{one(p.daily)}</td>
                <td>{p.rb ? `${hh(p.rb.rushFrom)}–${hh(p.rb.rushTo)}` : '—'}</td>
                <td>
                  <span className="tag open">{p.rb?.readyBy ?? '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        "Ready by" is 30 minutes before demand reaches half of its peak. Drinks such as punch follow "All drinks".
      </p>
    </>
  );
}

/* ================================================================ service */

function Service({ customers, base, lateMs, hours, r }: Ctx) {
  const staff = useStore((s) => s.staff);
  const settings = useStore((s) => s.settings);
  const timed = customers.map((o) => ({ o, t: serviceTimes(o) }));
  const served = timed.filter((x) => x.t.toServedMs !== undefined);
  const waits = served.map((x) => x.t.toServedMs!);
  const avgOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const kitchen = timed.filter((x) => x.t.toReadyMs !== undefined).map((x) => x.t.toReadyMs!);
  const handover = served.filter((x) => x.t.ready).map((x) => Date.parse(x.t.served!) - Date.parse(x.t.ready!));
  const late = served.filter((x) => x.t.toServedMs! >= lateMs);
  const slowest = [...served].sort((a, b) => b.t.toServedMs! - a.t.toServedMs!).slice(0, 10);
  const prof = hourProfile(customers, r, hours, lateMs);
  const byMeal = new Map<string, number[]>();
  for (const x of served) for (const l of x.o.lines) byMeal.set(l.name, [...(byMeal.get(l.name) ?? []), x.t.toServedMs!]);
  const meals = [...byMeal.entries()].map(([name, ws]) => ({ name, avg: avgOf(ws)!, n: ws.length, late: ws.filter((w) => w >= lateMs).length })).sort((a, b) => b.avg - a.avg);
  void base;

  const stat = (label: string, value: string, sub?: string, bad?: boolean) => (
    <div className="card stat">
      <div className="muted lbl">{label}</div>
      <div className="val" style={bad ? { color: 'var(--bad)' } : undefined}>
        {value}
      </div>
      {sub && <div className="muted sub">{sub}</div>}
    </div>
  );

  return (
    <>
      <div className="stats">
        {stat('Average wait', avgOf(waits) === null ? '—' : fmtDuration(avgOf(waits)!), 'paying → food served')}
        {stat('Late orders', `${late.length}`, served.length ? `${Math.round((late.length / served.length) * 100)}% took ${settings.lateAfterMinutes} min or more` : undefined, late.length > 0)}
        {stat('Kitchen time', avgOf(kitchen) === null ? '—' : fmtDuration(avgOf(kitchen)!), 'paying → ready')}
        {stat('Hand-over time', avgOf(handover) === null ? '—' : fmtDuration(avgOf(handover)!), 'ready → served')}
      </div>
      <BarChart
        caption={`Average wait by hour (minutes) — late is ${settings.lateAfterMinutes} min`}
        labels={hours.map(hh)}
        series={[{ name: 'Average wait', color: '#b45309', values: prof.map((p) => (p.avgWait ?? 0) / 60000) }]}
        format={(v) => v.toFixed(1)}
        unit="minutes"
        highlight={prof.reduce((bi, p, i) => ((p.avgWait ?? 0) > (prof[bi].avgWait ?? 0) ? i : bi), 0)}
      />
      <div className="section-title">Slowest orders</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <th>No.</th>
              <th>When</th>
              <th>Items</th>
              <th>Kitchen</th>
              <th>Total wait</th>
              <th>Cashier</th>
            </tr>
          </thead>
          <tbody>
            {slowest.map(({ o, t }) => (
              <tr key={o.id}>
                <td>
                  <b>{o.number}</b>
                </td>
                <td>{new Date(t.placed).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</td>
                <td className="num">{t.toReadyMs !== undefined ? fmtDuration(t.toReadyMs) : '—'}</td>
                <td className="num">
                  <b style={t.toServedMs! >= lateMs ? { color: 'var(--bad)' } : undefined}>{fmtDuration(t.toServedMs!)}</b>
                </td>
                <td>{staff.find((s) => s.id === o.cashierId)?.name}</td>
              </tr>
            ))}
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
          {meals.map((m) => (
            <tr key={m.name}>
              <td>{m.name}</td>
              <td className="num">{m.n}</td>
              <td className="num">
                <b style={m.avg >= lateMs ? { color: 'var(--bad)' } : undefined}>{fmtDuration(m.avg)}</b>
              </td>
              <td className="num">{m.late || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ================================================================ money */

function Money({ customers, all, base, r }: Ctx) {
  const currencies = useStore((s) => s.currencies);
  const methods = useStore((s) => s.paymentMethods);
  const staff = useStore((s) => s.staff);
  const orderTypes = useStore((s) => s.orderTypes);
  const credit = useStore((s) => s.credit);

  const byPay = new Map<string, { amount: number; count: number }>();
  for (const o of all)
    for (const p of o.payments) {
      const k = `${p.methodId}|${p.currency}`;
      const cur = byPay.get(k) ?? { amount: 0, count: 0 };
      byPay.set(k, { amount: round2(cur.amount + p.amount), count: cur.count + 1 });
    }
  const byItem = new Map<string, { qty: number; amount: number }>();
  for (const o of all)
    for (const l of o.lines) {
      const cur = byItem.get(l.name) ?? { qty: 0, amount: 0 };
      byItem.set(l.name, { qty: cur.qty + l.qty, amount: round2(cur.amount + l.qty * l.unitPrice) });
    }
  const byCashier = new Map<string, number>();
  for (const o of all) byCashier.set(o.cashierId, round2((byCashier.get(o.cashierId) ?? 0) + o.total));
  const a = r.start.getTime(), b = r.end.getTime();
  const inR = credit.filter((e) => Date.parse(e.at) >= a && Date.parse(e.at) < b);
  const sum = (k: string) => round2(inR.filter((e) => e.kind === k).reduce((s, e) => s + Math.abs(e.amount), 0));
  const held = round2([...balances(credit).values()].reduce((s, v) => s + Math.max(0, v), 0));
  const methodName = (id: string) => (id === CREDIT_METHOD ? 'Customer change used' : methods.find((m) => m.id === id)?.name ?? id);

  return (
    <>
      <div className="stats">
        <div className="card stat">
          <div className="muted lbl">Kept for customers</div>
          <div className="val">{fmt(sum('change_left'), base)}</div>
        </div>
        <div className="card stat">
          <div className="muted lbl">Change used for food</div>
          <div className="val">{fmt(sum('used_for_food'), base)}</div>
        </div>
        <div className="card stat">
          <div className="muted lbl">Change paid out</div>
          <div className="val">{fmt(sum('paid_out'), base)}</div>
        </div>
        <div className="card stat">
          <div className="muted lbl">Holding now</div>
          <div className="val">{fmt(held, base)}</div>
          <div className="muted sub">all customers</div>
        </div>
      </div>
      <div className="section-title">Money received</div>
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
          {[...byPay.entries()].map(([k, v]) => {
            const [m, c] = k.split('|');
            return (
              <tr key={k}>
                <td>{methodName(m)}</td>
                <td>{c}</td>
                <td className="num">{v.count}</td>
                <td className="num">
                  <b>{fmt(v.amount, currencies.find((x) => x.code === c))}</b>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
          {[...byItem.entries()]
            .sort((x, y) => y[1].qty - x[1].qty)
            .map(([name, v]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{v.qty}</td>
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
              {orderTypes
                .filter((t) => customers.some((o) => o.orderTypeId === t.id))
                .map((t) => {
                  const n = customers.filter((o) => o.orderTypeId === t.id).length;
                  return (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td className="num">
                        <b>{n}</b> ({Math.round((n / customers.length) * 100)}%)
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <div className="grow">
          <div className="section-title">Sales by cashier</div>
          <table className="list">
            <tbody>
              {[...byCashier.entries()].map(([id, v]) => (
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
    </>
  );
}
