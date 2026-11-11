import type { AddOn, AppState, ID, MenuItem, OrderLine, StockItem } from './types';

/**
 * Stock levels, worked out from permanent records (nothing is stored as a running total):
 *
 *   amount left = last count
 *               + purchases recorded after it
 *               − waste recorded after it
 *               − what every sale since then used (worked out when sold, kept on the order)
 *
 * A cancelled sale stops counting, so its stock goes back.
 * Until an item has been counted once, the system cannot know what is there.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const countUnit = (i: StockItem) => i.countUnit?.trim() || i.unit;
export const perPack = (i: StockItem) => (i.perPack && i.perPack > 0 ? i.perPack : 1);

/** "4.25 kg", "12 bottles". Up to two decimals, no trailing zeros. */
export function fmtQty(n: number, unit: string): string {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const s = v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${s} ${unit}`;
}

/** What a purchase line adds to stock: "2 × 10 kg bag" → 20 kg; "3 kg" of a kg item → 3 kg. */
export function purchaseToStock(item: StockItem, qty: number, unit: string): number {
  const u = unit.trim().toLowerCase();
  const cu = countUnit(item).toLowerCase();
  if (u && u === cu && u !== item.unit.trim().toLowerCase()) return r3(qty);
  return r3(qty * perPack(item));
}

/** Stock one sale uses: each meal's recipe and its add-ons, times plates, plus packaging for take-away. */
export function usageFor(
  lines: OrderLine[],
  orderTypeId: string,
  s: { menu: MenuItem[]; addOns: AddOn[]; stockItems: StockItem[] },
): Record<ID, number> | undefined {
  const used: Record<ID, number> = {};
  const add = (id: ID, q: number) => {
    if (q > 0) used[id] = r3((used[id] ?? 0) + q);
  };
  const packed = orderTypeId === 'take_away' || orderTypeId === 'delivery';
  const packaging = s.stockItems.filter((i) => i.track && (i.perPackedPlate ?? 0) > 0);
  for (const l of lines) {
    const m = s.menu.find((x) => x.id === l.itemId);
    for (const r of m?.recipe ?? []) add(r.stockItemId, r.qty * l.qty);
    for (const x of l.extras ?? []) for (const r of s.addOns.find((a) => a.id === x.id)?.recipe ?? []) add(r.stockItemId, r.qty * l.qty);
    if (packed && m && !m.isDrink) for (const p of packaging) add(p.id, p.perPackedPlate! * l.qty);
  }
  return Object.keys(used).length ? used : undefined;
}

export type StockStatus = 'ok' | 'low' | 'out' | 'uncounted' | 'untracked';

export interface StockLevel {
  item: StockItem;
  status: StockStatus;
  /** In count units. Only meaningful once counted. */
  onHand: number;
  lastCountAt?: string;
  usedToday: number;
  /** Average used per day over the last 7 days (count units). */
  perDay: number;
  /** About how many days it lasts at that rate. */
  daysLeft?: number;
  /** onHand × cost per count unit (base currency). */
  value?: number;
}

type StockState = Pick<AppState, 'stockItems' | 'stockMoves' | 'orders' | 'purchases'>;

export function stockLevels(s: StockState, now = Date.now()): Map<ID, StockLevel> {
  const out = new Map<ID, StockLevel>();
  const lastCount = new Map<ID, { at: string; qty: number }>();
  for (const m of s.stockMoves) if (m.kind === 'count') {
    const cur = lastCount.get(m.stockItemId);
    if (!cur || m.at >= cur.at) lastCount.set(m.stockItemId, { at: m.at, qty: m.qty });
  }
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.toISOString();
  const weekAgo = new Date(now - 7 * 864e5).toISOString();

  for (const item of s.stockItems) {
    const base: StockLevel = { item, status: 'untracked', onHand: 0, usedToday: 0, perDay: 0 };
    if (!item.track) { out.set(item.id, base); continue; }
    const c = lastCount.get(item.id);
    let onHand = c?.qty ?? 0;
    let usedToday = 0, usedWeek = 0;
    for (const m of s.stockMoves) if (m.stockItemId === item.id && m.kind === 'waste' && c && m.at > c.at) onHand -= m.qty;
    for (const p of s.purchases) {
      if (p.example || !c || p.at <= c.at) continue;
      for (const l of p.lines) if (l.stockItemId === item.id) onHand += l.stockQty ?? l.qty * perPack(item);
    }
    for (const o of s.orders) {
      const q = o.stockUsed?.[item.id];
      if (!q || o.example || o.status === 'cancelled') continue;
      if (c && o.createdAt > c.at) onHand -= q;
      if (o.createdAt >= today) usedToday += q;
      if (o.createdAt >= weekAgo) usedWeek += q;
    }
    // Average over the days we actually have (a new item counted yesterday is not averaged over a week).
    const firstSeen = c ? Math.max(Date.parse(weekAgo), Math.min(...s.stockMoves.filter((m) => m.stockItemId === item.id).map((m) => Date.parse(m.at)))) : Date.parse(weekAgo);
    const days = Math.max(1, (now - firstSeen) / 864e5);
    const perDay = r3(usedWeek / days);
    onHand = r3(onHand);
    const status: StockStatus = !c ? 'uncounted' : onHand <= 0.0005 ? 'out' : item.lowAt !== undefined && onHand <= item.lowAt ? 'low' : 'ok';
    const unitCost = item.lastUnitCost !== undefined ? item.lastUnitCost / perPack(item) : undefined;
    out.set(item.id, {
      item,
      status,
      onHand,
      lastCountAt: c?.at,
      usedToday: r3(usedToday),
      perDay,
      daysLeft: c && perDay > 0 && onHand > 0 ? onHand / perDay : undefined,
      value: c && unitCost !== undefined ? Math.round(Math.max(0, onHand) * unitCost * 100) / 100 : undefined,
    });
  }
  return out;
}

/** Stock items that are counted, set to hide their meals, and have run out. */
export function outOfStockIds(levels: Map<ID, StockLevel>): Set<ID> {
  const ids = new Set<ID>();
  for (const l of levels.values()) if (l.status === 'out' && l.item.hideWhenOut) ids.add(l.item.id);
  return ids;
}

/** Names of the out-of-stock items a recipe needs, e.g. ["Beef"]. */
export function missingStock(recipe: { stockItemId: ID }[] | undefined, out: Set<ID>, items: StockItem[]): string[] {
  return (recipe ?? []).filter((r) => out.has(r.stockItemId)).map((r) => items.find((i) => i.id === r.stockItemId)?.name ?? r.stockItemId);
}
