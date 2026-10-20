import type { MealPeriod, MenuItem, Order } from './types';
import { serviceTimes, todayISO } from './rules';
import { round2 } from './money';

/**
 * Business analytics, computed from orders. Pure functions, no UI.
 * A "customer" is one main order (add-on drinks belong to their order).
 */

export type PeriodKey = 'today' | '7d' | '28d' | '90d';
export type Grain = 'hour' | 'day' | 'week' | 'month';
export type MetricKey = 'customers' | 'sales' | 'avgOrder' | 'avgWait' | 'latePct' | 'takeAwayPct';

export const PERIODS: { key: PeriodKey; label: string; days: number; grains: Grain[] }[] = [
  { key: 'today', label: 'Today', days: 1, grains: ['hour'] },
  { key: '7d', label: '7 days', days: 7, grains: ['hour', 'day'] },
  { key: '28d', label: '28 days', days: 28, grains: ['day', 'week'] },
  { key: '90d', label: '90 days', days: 90, grains: ['day', 'week', 'month'] },
];

export const GRAIN_LABEL: Record<Grain, string> = { hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly' };

export const METRICS: { key: MetricKey; label: string; better: 'up' | 'down' | 'none' }[] = [
  { key: 'customers', label: 'Customers', better: 'up' },
  { key: 'sales', label: 'Sales', better: 'up' },
  { key: 'avgOrder', label: 'Average order', better: 'up' },
  { key: 'avgWait', label: 'Average wait', better: 'down' },
  { key: 'latePct', label: 'Late orders', better: 'down' },
  { key: 'takeAwayPct', label: 'Take away', better: 'none' },
];

const DAY = 86400000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export interface Range {
  start: Date; // inclusive
  end: Date; // exclusive
  days: string[]; // YYYY-MM-DD, oldest first
}

export function periodRange(key: PeriodKey, now = new Date(), offsetPeriods = 0): Range {
  const p = PERIODS.find((x) => x.key === key)!;
  const end = new Date(startOfDay(now).getTime() + DAY - offsetPeriods * p.days * DAY);
  const start = new Date(end.getTime() - p.days * DAY);
  const days = Array.from({ length: p.days }, (_, i) => todayISO(new Date(start.getTime() + i * DAY + DAY / 2)));
  return { start, end, days };
}

/** Main orders (customers) inside a range. */
export function customersIn(orders: Order[], r: Range, includeTraining: boolean): Order[] {
  const a = r.start.getTime();
  const b = r.end.getTime();
  return orders.filter((o) => {
    if (o.parentOrderId || o.status === 'cancelled') return false;
    if (!includeTraining && o.training) return false;
    const t = Date.parse(o.createdAt);
    return t >= a && t < b;
  });
}

/** Add-on orders (drinks added later) count toward sales and item demand. */
export function allOrdersIn(orders: Order[], r: Range, includeTraining: boolean): Order[] {
  const a = r.start.getTime();
  const b = r.end.getTime();
  return orders.filter((o) => o.status !== 'cancelled' && (includeTraining || !o.training) && Date.parse(o.createdAt) >= a && Date.parse(o.createdAt) < b);
}

export function metricValue(key: MetricKey, customers: Order[], all: Order[], lateMs: number): number | null {
  switch (key) {
    case 'customers':
      return customers.length;
    case 'sales':
      return round2(all.reduce((s, o) => s + o.total, 0));
    case 'avgOrder':
      return customers.length ? round2(all.reduce((s, o) => s + o.total, 0) / customers.length) : null;
    case 'avgWait': {
      const w = customers.map((o) => serviceTimes(o).toServedMs).filter((x): x is number => x !== undefined);
      return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
    }
    case 'latePct': {
      const w = customers.map((o) => serviceTimes(o).toServedMs).filter((x): x is number => x !== undefined);
      return w.length ? (w.filter((x) => x >= lateMs).length / w.length) * 100 : null;
    }
    case 'takeAwayPct':
      return customers.length ? (customers.filter((o) => o.orderTypeId === 'take_away').length / customers.length) * 100 : null;
  }
}

export interface Bucket {
  key: string;
  label: string;
  start: number;
  end: number;
}

/** Mark buckets that are not complete: the current one ("so far") and cut-off weeks/months ("part"). */
export function labelPartial(bs: Bucket[], grain: Grain, now = Date.now()): Bucket[] {
  return bs.map((b) => {
    if (now >= b.start && now < b.end && grain !== 'hour') return { ...b, label: `${b.label} (so far)` };
    const full = grain === 'week' ? 7 * DAY : grain === 'month' ? 28 * DAY : 0;
    if (full && b.end - b.start < full) return { ...b, label: `${b.label} (part)` };
    return b;
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Time buckets covering a range. Hourly buckets only cover opening hours. */
export function buckets(r: Range, grain: Grain, open: { from: number; to: number }): Bucket[] {
  const out: Bucket[] = [];
  if (grain === 'hour') {
    for (const d of r.days) {
      const base = new Date(d + 'T00:00:00');
      for (let h = open.from; h < open.to; h++) {
        const s = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h).getTime();
        const label = r.days.length === 1 ? `${String(h).padStart(2, '0')}:00` : `${WD[base.getDay()]} ${String(h).padStart(2, '0')}h`;
        out.push({ key: `${d}-${h}`, label, start: s, end: s + 3600000 });
      }
    }
  } else if (grain === 'day') {
    for (const d of r.days) {
      const s = new Date(d + 'T00:00:00').getTime();
      const dt = new Date(s);
      out.push({ key: d, label: `${WD[dt.getDay()]} ${dt.getDate()}`, start: s, end: s + DAY });
    }
  } else if (grain === 'week') {
    // Weeks start on Monday.
    let s = startOfDay(r.start);
    s = new Date(s.getTime() - ((s.getDay() + 6) % 7) * DAY);
    while (s.getTime() < r.end.getTime()) {
      const e = new Date(s.getTime() + 7 * DAY);
      out.push({ key: todayISO(s), label: `${s.getDate()} ${MONTHS[s.getMonth()]}`, start: Math.max(s.getTime(), r.start.getTime()), end: Math.min(e.getTime(), r.end.getTime()) });
      s = e;
    }
  } else {
    let s = new Date(r.start.getFullYear(), r.start.getMonth(), 1);
    while (s.getTime() < r.end.getTime()) {
      const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
      out.push({ key: `${s.getFullYear()}-${s.getMonth()}`, label: `${MONTHS[s.getMonth()]} ${s.getFullYear()}`, start: Math.max(s.getTime(), r.start.getTime()), end: Math.min(e.getTime(), r.end.getTime()) });
      s = e;
    }
  }
  return out;
}

/** One value per bucket. Buckets before `dataFrom` (no records yet) or in the future are null, not zero. */
export function seriesFor(key: MetricKey, bs: Bucket[], customers: Order[], all: Order[], lateMs: number, dataFrom = 0, now = Date.now()): (number | null)[] {
  return bs.map((b) => {
    if (b.end <= dataFrom || b.start > now) return null;
    const inB = (o: Order) => {
      const t = Date.parse(o.createdAt);
      return t >= b.start && t < b.end;
    };
    return metricValue(key, customers.filter(inB), all.filter(inB), lateMs);
  });
}

/** Average customers per weekday × hour (rows Mon..Sun). */
export function weekdayHourGrid(customers: Order[], r: Range, hours: number[]): number[][] {
  const dayCount = [0, 0, 0, 0, 0, 0, 0];
  for (const d of r.days) dayCount[new Date(d + 'T12:00:00').getDay()]++;
  const grid = Array.from({ length: 7 }, () => hours.map(() => 0));
  for (const o of customers) {
    const t = new Date(o.createdAt);
    const hi = hours.indexOf(t.getHours());
    if (hi >= 0) grid[(t.getDay() + 6) % 7][hi]++;
  }
  return grid.map((row, i) => row.map((v) => (dayCount[(i + 1) % 7] ? v / dayCount[(i + 1) % 7] : 0)));
}

export interface HourStat {
  hour: number;
  avg: number; // customers per day
  peak: number; // busiest single day at this hour
  latePct: number | null;
  avgWait: number | null;
}

export function hourProfile(customers: Order[], r: Range, hours: number[], lateMs: number): HourStat[] {
  return hours.map((h) => {
    const at = customers.filter((o) => new Date(o.createdAt).getHours() === h);
    const perDay = new Map<string, number>();
    for (const o of at) {
      const d = todayISO(new Date(o.createdAt));
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const waits = at.map((o) => serviceTimes(o).toServedMs).filter((x): x is number => x !== undefined);
    return {
      hour: h,
      avg: at.length / r.days.length,
      peak: Math.max(0, ...perDay.values()),
      latePct: waits.length ? (waits.filter((w) => w >= lateMs).length / waits.length) * 100 : null,
      avgWait: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null,
    };
  });
}

export interface PeriodStat {
  period: MealPeriod;
  customersPerDay: number;
  salesShare: number;
  peakHour: number | null;
  avgWait: number | null;
  latePct: number | null;
  topItems: { name: string; qty: number }[];
}

export function mealPeriodStats(customers: Order[], all: Order[], r: Range, periods: MealPeriod[], lateMs: number): PeriodStat[] {
  const totalSales = all.reduce((s, o) => s + o.total, 0) || 1;
  return periods.map((p) => {
    const inP = (o: Order) => {
      const h = new Date(o.createdAt).getHours();
      return h >= p.from && h < p.to;
    };
    const cs = customers.filter(inP);
    const as = all.filter(inP);
    const byHour = new Map<number, number>();
    for (const o of cs) byHour.set(new Date(o.createdAt).getHours(), (byHour.get(new Date(o.createdAt).getHours()) ?? 0) + 1);
    const peak = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
    const waits = cs.map((o) => serviceTimes(o).toServedMs).filter((x): x is number => x !== undefined);
    const items = new Map<string, number>();
    for (const o of as) for (const l of o.lines) items.set(l.name, (items.get(l.name) ?? 0) + l.qty);
    return {
      period: p,
      customersPerDay: cs.length / r.days.length,
      salesShare: (as.reduce((s, o) => s + o.total, 0) / totalSales) * 100,
      peakHour: peak ? peak[0] : null,
      avgWait: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null,
      latePct: waits.length ? (waits.filter((w) => w >= lateMs).length / waits.length) * 100 : null,
      topItems: [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, qty]) => ({ name, qty })),
    };
  });
}

export type DemandTarget = { kind: 'item' | 'component' | 'category'; id: string; name: string };

/** Portions sold per hour, averaged per day, for an item, an ingredient (e.g. Sadza) or a category (e.g. Drinks). */
export function demandByHour(all: Order[], r: Range, hours: number[], target: DemandTarget, menu: MenuItem[]): number[] {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const counts = (o: Order) =>
    o.lines.reduce((s, l) => {
      const m = byId.get(l.itemId);
      const hit =
        target.kind === 'item' ? l.itemId === target.id : target.kind === 'component' ? !!m?.componentIds.includes(target.id) : m?.categoryId === target.id;
      return s + (hit ? l.qty : 0);
    }, 0);
  return hours.map((h) => all.filter((o) => new Date(o.createdAt).getHours() === h).reduce((s, o) => s + counts(o), 0) / r.days.length);
}

/**
 * When should it be ready? The first hour (before the peak) where demand reaches half of the peak,
 * minus 30 minutes for preparation.
 */
export function readyBy(values: number[], hours: number[]): { peakHour: number; rushFrom: number; readyBy: string; rushTo: number } | null {
  const max = Math.max(...values);
  if (!(max > 0)) return null;
  const pi = values.indexOf(max);
  let si = pi;
  while (si > 0 && values[si - 1] >= max * 0.5) si--;
  let ei = pi;
  while (ei < values.length - 1 && values[ei + 1] >= max * 0.5) ei++;
  const startMin = hours[si] * 60 - 30;
  const hh = String(Math.floor(startMin / 60)).padStart(2, '0');
  const mm = String(startMin % 60).padStart(2, '0');
  return { peakHour: hours[pi], rushFrom: hours[si], rushTo: hours[ei] + 1, readyBy: `${hh}:${mm}` };
}

export function pctChange(now: number | null, prev: number | null): number | null {
  if (now === null || prev === null || prev === 0) return null;
  return ((now - prev) / prev) * 100;
}
