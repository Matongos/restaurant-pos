import type { AppState, CreditEntry, Customer, MenuItem, Order, Role } from './types';

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

export function customerBalance(credit: CreditEntry[], customerId: string): number {
  let sum = 0;
  for (const e of credit) if (e.customerId === customerId) sum += e.amount;
  return Math.round(sum * 100) / 100;
}

export function balances(credit: CreditEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of credit) m.set(e.customerId, Math.round(((m.get(e.customerId) ?? 0) + e.amount) * 100) / 100);
  return m;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Customers whose name matches what has been typed (start of first or last name), people owed change first. */
export function findCustomers(customers: Customer[], credit: CreditEntry[], typed: string, limit = 6): Customer[] {
  const q = norm(typed);
  if (!q) return [];
  const bal = balances(credit);
  const digits = q.replace(/\D/g, '');
  return customers
    .filter((c) => {
      const n = norm(c.name);
      return n.startsWith(q) || n.split(' ').some((w) => w.startsWith(q)) || (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits));
    })
    .sort((a, b) => (bal.get(b.id) ?? 0) - (bal.get(a.id) ?? 0) || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, limit);
}

/** Other customers with exactly this name (to make the cashier tell them apart). */
export function sameNameCustomers(customers: Customer[], name: string, exceptId?: string): Customer[] {
  const n = norm(name);
  return customers.filter((c) => c.id !== exceptId && norm(c.name) === n);
}

/** Title-case a typed name: "anashe moyo" -> "Anashe Moyo". */
export function tidyName(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
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

/** 245000 ms -> "4:05"; over an hour -> "1:02:10". */
export function fmtDuration(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** When an order was placed, became ready and was served, and the waits between. */
export function serviceTimes(o: Order) {
  const at = (st: string) => o.history.find((h) => h.status === st)?.at;
  const placed = at('placed') ?? o.createdAt;
  // Use the LAST "ready" in case the kitchen recalled the order.
  const ready = [...o.history].reverse().find((h) => h.status === 'ready')?.at;
  const served = at('served');
  const p = Date.parse(placed);
  return {
    placed,
    ready,
    served,
    toReadyMs: ready ? Date.parse(ready) - p : undefined,
    toServedMs: served ? Date.parse(served) - p : undefined,
  };
}

export type TimerState = 'ok' | 'warn' | 'late';
export function timerState(ms: number, warnMin: number, lateMin: number): TimerState {
  return ms >= lateMin * 60000 ? 'late' : ms >= warnMin * 60000 ? 'warn' : 'ok';
}
