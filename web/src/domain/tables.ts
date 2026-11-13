import type { AppState, Order, ServiceMode } from './types';

/**
 * Table service. A table's bill ("tab") is its first round: an order with `table.round === 1`.
 * Later rounds point to it (parentOrderId). Money paid for the table is kept on round 1, so the
 * books, cash drawer and reports keep working as they do for counter sales.
 */

export const serviceMode = (s: Pick<AppState, 'settings'>): ServiceMode => s.settings.serviceMode ?? 'counter';
export const tablesOn = (s: Pick<AppState, 'settings'>) => serviceMode(s) !== 'counter';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The open bill at this table, if any. */
export function openTab(orders: Order[], tableId: string): Order | undefined {
  return orders.find((o) => o.table?.round === 1 && !o.online && o.table.tableId === tableId && o.status !== 'cancelled' && o.table.status !== 'paid');
}

/** Every open bill (tables that are taken). */
export function openTabs(orders: Order[]): Order[] {
  return orders.filter((o) => o.table?.round === 1 && !o.online && o.status !== 'cancelled' && o.table.status !== 'paid' && !o.example);
}

/** All rounds of a bill, oldest first (cancelled ones left out). */
export function tabRounds(orders: Order[], tab: Order): Order[] {
  return orders
    .filter((o) => (o.id === tab.id || o.parentOrderId === tab.id) && o.status !== 'cancelled')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The bill total: every round (round 1 includes any service charge). */
export const tabTotal = (orders: Order[], tab: Order) => r2(tabRounds(orders, tab).reduce((s, o) => s + o.total, 0));
/** Food and drinks only, without the service charge. */
export const tabItemsTotal = (orders: Order[], tab: Order) =>
  r2(tabRounds(orders, tab).reduce((s, o) => s + o.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0), 0));
export const tabPaid = (tab: Order) => r2((tab.table?.shares ?? []).reduce((s, x) => s + x.amount, 0));
export const tabDue = (orders: Order[], tab: Order) => r2(Math.max(0, tabTotal(orders, tab) - tabPaid(tab)));

export type TableState = 'free' | 'ordering' | 'ready' | 'eating' | 'billed';

/** What a table is doing, for its colour on the Tables screen. */
export function tableState(orders: Order[], tab?: Order): TableState {
  if (!tab) return 'free';
  if (tab.table?.status === 'billed') return 'billed';
  const rounds = tabRounds(orders, tab);
  if (rounds.some((o) => o.status === 'ready')) return 'ready';
  if (rounds.some((o) => o.status === 'in_kitchen')) return 'ordering';
  return 'eating';
}

/** "Order 4" or "T4 (round 2)": how an order is named in lists. */
export const orderName = (o: Order) => (o.table ? `${o.table.name}${o.table.round > 1 ? ` (round ${o.table.round})` : ''}` : `#${o.number}`);

/** Split an amount into n shares whose cents add up exactly: $41.00 / 3 = 13.67 + 13.67 + 13.66. */
export function equalShares(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const extra = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}
