/**
 * Today's cooking: raw stock (8 chickens) becomes ready portions (66 portions, 8 quarters), and the
 * system learns from the real entries how much one raw unit usually gives — nothing is fixed in advance.
 */
import type { AppState, ID, MenuItem, StockItem, StockMove } from './types';
import { countUnit, type StockLevel } from './stock';
import { todayISO } from './rules';

type KState = Pick<AppState, 'stockItems' | 'stockMoves' | 'orders'>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayOf = (iso: string) => todayISO(new Date(iso));

/** Cooking entries that still count (an undone entry and its undo cancel out). */
export function cookEntries(s: Pick<AppState, 'stockMoves'>): StockMove[] {
  const undone = new Set(s.stockMoves.filter((m) => m.kind === 'cook' && m.reversesId).map((m) => m.reversesId!));
  return s.stockMoves.filter((m) => m.kind === 'cook' && !m.reversesId && !undone.has(m.id));
}

export const readyItems = (s: Pick<AppState, 'stockItems'>) => s.stockItems.filter((i) => !!i.madeFrom);

/** Plates of a ready portion sold between two times (from what each sale used). */
function soldBetween(s: KState, id: ID, fromMs: number, toMs: number): number {
  let n = 0;
  for (const o of s.orders) {
    if (o.example || o.status === 'cancelled') continue;
    const t = Date.parse(o.createdAt);
    if (t >= fromMs && t < toMs) n += o.stockUsed?.[id] ?? 0;
  }
  return n;
}

export interface Yield {
  /** How many ready portions one raw unit gives on average (11 portions per chicken). */
  perRaw: number | null;
  /** Raw used and portions made (or sold, when the kitchen does not count) behind the average. */
  raw: number;
  made: number;
  entries: number;
}

/**
 * What one raw unit usually gives, from the last `days` days of entries (today left out when asked, so
 * today can be compared with "usual"). Rice-style items: plates sold per raw unit used.
 */
export function yieldOf(s: KState, item: StockItem, opts: { days?: number; excludeToday?: boolean; now?: number } = {}): Yield {
  const now = opts.now ?? Date.now();
  const days = opts.days ?? 28;
  const from = now - days * 864e5;
  const today = todayISO(new Date(now));
  const list = cookEntries(s).filter((m) => m.stockItemId === item.id && (!item.madeFrom || m.rawId === item.madeFrom) && Date.parse(m.at) >= from && Date.parse(m.at) < now && (!opts.excludeToday || dayOf(m.at) !== today));
  const raw = list.reduce((t, m) => t + (m.rawQty ?? 0), 0);
  if (!raw) return { perRaw: null, raw: 0, made: 0, entries: 0 };
  let made: number;
  if (item.countMade === false) {
    // Plates counted from the sales over the same days the entries cover.
    const first = Math.min(...list.map((m) => Date.parse(m.at)));
    const startDay = new Date(first);
    startDay.setHours(0, 0, 0, 0);
    let end = now;
    if (opts.excludeToday) {
      const t = new Date(now);
      t.setHours(0, 0, 0, 0);
      end = t.getTime();
    }
    made = soldBetween(s, item.id, startDay.getTime(), end);
  } else made = list.reduce((t, m) => t + m.qty, 0);
  return { perRaw: made > 0 ? r2(made / raw) : null, raw: r2(raw), made: r2(made), entries: list.length };
}

/** How far one entry is from the usual yield: −0.13 = 13% fewer. null when there is no usual yet. */
export function yieldDiff(perRaw: number, usual: number | null): number | null {
  if (!usual || !perRaw) return null;
  return Math.round(((perRaw - usual) / usual) * 100) / 100;
}

/** Counts more than 10% away from usual are flagged. */
export const UNUSUAL = 0.1;

/** Ready portions the kitchen usually cooks but has not entered today (shown as a reminder at the till). */
export function cookingReminders(s: KState & Pick<AppState, 'menu'>, now = Date.now()): StockItem[] {
  const today = todayISO(new Date(now));
  const since = now - 14 * 864e5;
  const used = new Set(s.menu.flatMap((m) => (m.recipe ?? []).map((r) => r.stockItemId)));
  const entries = cookEntries(s);
  return readyItems(s).filter(
    (i) =>
      i.countMade !== false &&
      used.has(i.id) &&
      entries.some((m) => m.stockItemId === i.id && Date.parse(m.at) >= since) &&
      !entries.some((m) => m.stockItemId === i.id && dayOf(m.at) === today && m.qty > 0),
  );
}

/** Plates of a meal still possible from today's cooked portions (null when nothing it uses is cooked today). */
export function platesLeft(m: MenuItem, levels: Map<ID, StockLevel>): number | null {
  let min: number | null = null;
  for (const r of m.recipe ?? []) {
    const l = levels.get(r.stockItemId);
    if (!l?.ready || !l.cookedToday || !(r.qty > 0)) continue;
    const n = Math.max(0, Math.floor((l.onHand + 1e-6) / r.qty));
    min = min === null ? n : Math.min(min, n);
  }
  return min;
}

export interface KitchenDay {
  day: string;
  item: StockItem;
  made: number;
  rawUsed: number;
  sold: number;
  waste: number;
  /** From closing counts: what was missing compared with what should have been there. */
  missing: number;
  /** Cut into another ready portion (2 quarters cut into pieces). */
  cut: number;
}

/** Per day and ready portion: made, raw used, sold, waste and missing, for the Kitchen report. */
export function kitchenDays(s: KState, fromDay: string, toDay: string): KitchenDay[] {
  const items = readyItems(s);
  const rows = new Map<string, KitchenDay>();
  const row = (day: string, item: StockItem) => {
    const k = `${day}|${item.id}`;
    if (!rows.has(k)) rows.set(k, { day, item, made: 0, rawUsed: 0, sold: 0, waste: 0, missing: 0, cut: 0 });
    return rows.get(k)!;
  };
  const byId = new Map(items.map((i) => [i.id, i]));
  const inRange = (d: string) => d >= fromDay && d <= toDay;
  for (const m of cookEntries(s)) {
    const it = byId.get(m.stockItemId);
    const d = dayOf(m.at);
    if (!it || !inRange(d)) continue;
    const r = row(d, it);
    r.made += m.qty;
    if (m.rawId === it.madeFrom) r.rawUsed += m.rawQty ?? 0;
    // Made from another ready portion: that one was cut up.
    const src = m.rawId ? byId.get(m.rawId) : undefined;
    if (src) row(d, src).cut += m.rawQty ?? 0;
  }
  for (const m of s.stockMoves) {
    const it = byId.get(m.stockItemId);
    const d = dayOf(m.at);
    if (!it || !inRange(d)) continue;
    if (m.kind === 'waste') row(d, it).waste += m.qty;
    if (m.kind === 'count' && m.expected !== undefined && m.expected - m.qty > 0.0005) row(d, it).missing += m.expected - m.qty;
  }
  for (const o of s.orders) {
    if (o.example || o.status === 'cancelled' || !o.stockUsed) continue;
    const d = dayOf(o.createdAt);
    if (!inRange(d)) continue;
    for (const [id, q] of Object.entries(o.stockUsed)) {
      const it = byId.get(id);
      if (it) row(d, it).sold += q;
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, made: r2(r.made), rawUsed: r2(r.rawUsed), sold: r2(r.sold), waste: r2(r.waste), missing: r2(r.missing), cut: r2(r.cut) }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.item.name.localeCompare(b.item.name));
}

/** "11 portions per chicken", "78 plates per 10 kg bag". */
export function yieldText(item: StockItem, raw: StockItem | undefined, perRaw: number | null): string {
  if (perRaw === null) return 'not known yet';
  const one = countUnit(item);
  const rawUnit = raw ? countUnit(raw) : 'unit';
  return `${perRaw.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${one}${perRaw === 1 ? '' : 's'} per ${rawUnit}`;
}
