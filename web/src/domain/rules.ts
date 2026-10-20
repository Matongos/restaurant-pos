import type { AppState, MenuItem, Order, Role } from './types';

/** A meal can be sold only if it is switched on AND every component it uses is available. */
export function isSellable(item: MenuItem, state: Pick<AppState, 'components'>): boolean {
  if (!item.available) return false;
  return item.componentIds.every((cid) => state.components.find((c) => c.id === cid)?.available !== false);
}

/** Cards currently held by customers (orders not yet served). */
export function cardsInUse(orders: Order[]): Set<number> {
  const used = new Set<number>();
  for (const o of orders) {
    if (o.parentOrderId) continue;
    if ((o.numberMode === 'card' || o.numberMode === 'both') && (o.status === 'in_kitchen' || o.status === 'ready')) {
      used.add(o.number);
    }
  }
  return used;
}

export function nextFreeCard(orders: Order[], from: number, to: number): number | null {
  const used = cardsInUse(orders);
  for (let n = from; n <= to; n++) if (!used.has(n)) return n;
  return null;
}

export function changeOwedBalance(c: { amount: number; payouts: { amount: number }[] }): number {
  const paid = c.payouts.reduce((s, p) => s + p.amount, 0);
  return Math.round((c.amount - paid) * 100) / 100;
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
  kitchen: 'Kitchen',
  attendant: 'Attendant',
};

export type Permission =
  | 'take_orders'
  | 'active_orders'
  | 'change_owed'
  | 'todays_menu'
  | 'kitchen'
  | 'menu_edit'
  | 'settings'
  | 'reports'
  | 'screens';

const PERMS: Record<Role, Permission[]> = {
  super_admin: ['take_orders', 'active_orders', 'change_owed', 'todays_menu', 'kitchen', 'menu_edit', 'settings', 'reports', 'screens'],
  manager: ['take_orders', 'active_orders', 'change_owed', 'todays_menu', 'kitchen', 'menu_edit', 'reports', 'screens'],
  cashier: ['take_orders', 'active_orders', 'change_owed'],
  kitchen: ['todays_menu', 'kitchen', 'active_orders'],
  attendant: ['active_orders'],
};

export const can = (role: Role, p: Permission) => PERMS[role].includes(p);

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

/** Short voucher code customers can read out: no 0/O/1/I confusion. */
export function voucherCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
