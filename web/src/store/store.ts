import { useSyncExternalStore } from 'react';
import type {
  AppState,
  ChangeOwed,
  Currency,
  LiveCart,
  MenuItem,
  Order,
  OrderLine,
  OrderStatus,
  Payment,
  Settings,
  Staff,
} from '../domain/types';
import { seedState } from '../data/seed';
import { nextFreeCard, cardsInUse, todayISO, uid, voucherCode } from '../domain/rules';
import { round2 } from '../domain/money';

/**
 * Prototype store.
 *
 * State lives in the browser (localStorage) and is shared between windows on the
 * same computer, so the customer display in a second window updates live.
 *
 * In Phase 1 proper this module is replaced by a client for the local server
 * (REST + WebSocket order feed). Screens only call the actions below, so they
 * do not change when the backend changes.
 */

const KEY = 'restaurant-pos.state.v1';
const listeners = new Set<() => void>();

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed.version === 1) return parsed;
    }
  } catch {
    /* ignore and fall back to demo data */
  }
  return seedState();
}

let state: AppState = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save state (storage full?)', e);
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function set(updater: (s: AppState) => AppState) {
  state = updater(state);
  persist();
  emit();
}

// Another window (e.g. customer display) changed the data → reload it here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      state = load();
      emit();
    }
  });
}

export function getState() {
  return state;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Subscribe to a slice of state. The selector must return an existing part of
 * the state (e.g. s.orders), not a newly built array; derive lists with useMemo.
 */
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

/* ------------------------------------------------------------------ session */

const SESSION_KEY = 'restaurant-pos.session';
let memorySession: string | null = null;
function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return memorySession;
  }
}
function writeSession(id: string | null) {
  memorySession = id;
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: keep the session in memory */
  }
}

export function currentUser(): Staff | null {
  const id = readSession();
  return state.staff.find((s) => s.id === id) ?? null;
}

export function useCurrentUser(): Staff | null {
  const id = useSyncExternalStore(subscribe, readSession);
  const staff = useStore((s) => s.staff);
  return staff.find((s) => s.id === id) ?? null;
}

export function login(pin: string): Staff | null {
  const user = state.staff.find((s) => s.active && s.pin === pin) ?? null;
  if (user) writeSession(user.id);
  emit();
  return user;
}

export function logout() {
  writeSession(null);
  emit();
}

/* ------------------------------------------------------------------ orders */

export interface PlaceOrderInput {
  tillId: string;
  orderTypeId: string;
  lines: OrderLine[];
  payments: Payment[];
  changeGiven: number;
  changeCurrency: string;
  /** Card number chosen by the cashier (card / both modes). */
  cardNumber?: number;
  owe?: { customerName: string; phone?: string; amount: number; currency: string };
  parentOrderId?: string;
  cashierId: string;
}

export type PlaceOrderResult = { ok: true; order: Order; changeOwed?: ChangeOwed } | { ok: false; error: string };

export function placeOrder(input: PlaceOrderInput): PlaceOrderResult {
  const s = state;
  const now = new Date().toISOString();
  const total = round2(input.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0));
  const mode = s.settings.numberMode;

  let number: number;
  let dayCounter = s.dayCounter;

  if (input.parentOrderId) {
    const parent = s.orders.find((o) => o.id === input.parentOrderId);
    if (!parent) return { ok: false, error: 'Original order not found.' };
    number = parent.number;
  } else if (mode === 'slip') {
    if (s.settings.slipResetDaily && dayCounter.date !== todayISO()) dayCounter = { date: todayISO(), lastSlip: 0 };
    number = dayCounter.lastSlip + 1;
    dayCounter = { ...dayCounter, lastSlip: number };
  } else {
    const chosen = input.cardNumber ?? nextFreeCard(s.orders, s.settings.cardFrom, s.settings.cardTo);
    if (chosen == null) return { ok: false, error: 'All cards are in use. Mark served orders first.' };
    if (cardsInUse(s.orders).has(chosen)) return { ok: false, error: `Card ${chosen} is still with another customer.` };
    if (chosen < s.settings.cardFrom || chosen > s.settings.cardTo)
      return { ok: false, error: `Card must be between ${s.settings.cardFrom} and ${s.settings.cardTo}.` };
    number = chosen;
    if (mode === 'both') {
      if (s.settings.slipResetDaily && dayCounter.date !== todayISO()) dayCounter = { date: todayISO(), lastSlip: 0 };
    }
  }

  const order: Order = {
    id: uid('o-'),
    branchId: s.settings.branchId,
    tillId: input.tillId,
    number,
    numberMode: mode,
    orderTypeId: input.orderTypeId,
    lines: input.lines,
    total,
    payments: input.payments,
    changeGiven: round2(input.changeGiven),
    changeCurrency: input.changeCurrency,
    status: 'in_kitchen',
    history: [
      { status: 'placed', at: now, by: input.cashierId },
      { status: 'in_kitchen', at: now, by: input.cashierId },
    ],
    cashierId: input.cashierId,
    createdAt: now,
    parentOrderId: input.parentOrderId,
    training: s.settings.trainingMode,
  };

  let changeOwed: ChangeOwed | undefined;
  if (input.owe && input.owe.amount > 0) {
    changeOwed = {
      id: uid('c-'),
      branchId: s.settings.branchId,
      code: voucherCode(),
      orderId: order.id,
      orderNumber: number,
      customerName: input.owe.customerName.trim(),
      phone: input.owe.phone?.trim() || undefined,
      amount: round2(input.owe.amount),
      currency: input.owe.currency,
      payouts: [],
      createdAt: now,
      createdBy: input.cashierId,
    };
    order.changeOwedId = changeOwed.id;
  }

  set((st) => ({
    ...st,
    dayCounter,
    orders: [...st.orders, order],
    changeOwed: changeOwed ? [...st.changeOwed, changeOwed] : st.changeOwed,
  }));
  return { ok: true, order, changeOwed };
}

export function setOrderStatus(orderId: string, status: OrderStatus, by?: string) {
  const at = new Date().toISOString();
  set((st) => ({
    ...st,
    orders: st.orders.map((o) => {
      // An add-on (drink) follows its parent's status when the parent is served.
      const match = o.id === orderId || (status === 'served' && o.parentOrderId === orderId);
      return match ? { ...o, status, history: [...o.history, { status, at, by }] } : o;
    }),
  }));
}

/* ------------------------------------------------------------- live display */

export function setLiveCart(tillId: string, cart: Omit<LiveCart, 'tillId' | 'updatedAt'> | null) {
  set((st) => {
    const liveCarts = { ...st.liveCarts };
    if (cart) liveCarts[tillId] = { ...cart, tillId, updatedAt: new Date().toISOString() };
    else delete liveCarts[tillId];
    return { ...st, liveCarts };
  });
}

/* ------------------------------------------------------------ availability */

export function setComponentAvailable(id: string, available: boolean, by?: string) {
  const changedAt = new Date().toISOString();
  set((st) => ({
    ...st,
    components: st.components.map((c) => (c.id === id ? { ...c, available, changedAt, changedBy: by } : c)),
  }));
}

export function setItemAvailable(id: string, available: boolean) {
  set((st) => ({ ...st, menu: st.menu.map((m) => (m.id === id ? { ...m, available } : m)) }));
}

/* ------------------------------------------------------------- change owed */

export function payOutChangeOwed(id: string, amount: number, by: string, method: 'cash' | 'credit') {
  const at = new Date().toISOString();
  set((st) => ({
    ...st,
    changeOwed: st.changeOwed.map((c) =>
      c.id === id ? { ...c, payouts: [...c.payouts, { amount: round2(amount), at, by, method }] } : c,
    ),
  }));
}

/* ---------------------------------------------------------------- settings */

export function updateSettings(patch: Partial<Settings>) {
  set((st) => ({ ...st, settings: { ...st.settings, ...patch } }));
}

export function upsertCurrency(c: Currency) {
  set((st) => {
    const exists = st.currencies.some((x) => x.code === c.code);
    return {
      ...st,
      currencies: exists ? st.currencies.map((x) => (x.code === c.code ? c : x)) : [...st.currencies, c],
    };
  });
}

export function upsertMenuItem(item: MenuItem) {
  set((st) => {
    const exists = st.menu.some((x) => x.id === item.id);
    return { ...st, menu: exists ? st.menu.map((x) => (x.id === item.id ? item : x)) : [...st.menu, item] };
  });
}

export function resetDemo() {
  state = seedState();
  persist();
  emit();
}
