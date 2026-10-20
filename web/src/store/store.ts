import { useSyncExternalStore } from 'react';
import type {
  AppState,
  CreditEntry,
  Currency,
  Customer,
  LiveCart,
  MenuItem,
  Order,
  OrderLine,
  OrderStatus,
  Payment,
  PaymentMethod,
  Settings,
  Staff,
} from '../domain/types';
import { DEFAULT_MEAL_PERIODS, seedState } from '../data/seed';
import { exampleHistory } from '../data/exampleHistory';
import { nextFreeCard, cardsInUse, customerBalance, tidyName, todayISO, uid, voucherCode } from '../domain/rules';
import { CREDIT_METHOD } from '../domain/types';
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

/** Bring data saved by an older version of the app up to date. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrate(raw: any): AppState | null {
  if (raw?.version === 4) return raw as AppState;
  if (raw?.version === 3 || raw?.version === 2) {
    // v4: example history is generated at load instead of saved; analytics settings added.
    const st = raw as AppState;
    return {
      ...st,
      version: 4,
      orders: st.orders.filter((o) => !o.example),
      settings: { ...st.settings, showExampleHistory: true, mealPeriods: DEFAULT_MEAL_PERIODS, customersPerStaffHour: 12 },
    };
  }
  if (raw?.version === 1) {
    // v1 kept one-off IOUs; v2 keeps a running change balance per customer.
    const customers: Customer[] = [];
    const credit: CreditEntry[] = [];
    for (const c of raw.changeOwed ?? []) {
      const cu: Customer = {
        id: uid('cu-'),
        branchId: c.branchId,
        name: c.customerName,
        phone: c.phone,
        createdAt: c.createdAt,
        lastSeenAt: c.createdAt,
      };
      customers.push(cu);
      credit.push({ id: uid('cr-'), branchId: c.branchId, customerId: cu.id, kind: 'change_left', amount: c.amount, code: c.code, currency: c.currency, orderId: c.orderId, orderNumber: c.orderNumber, at: c.createdAt, by: c.createdBy });
      for (const p of c.payouts ?? [])
        credit.push({ id: uid('cr-'), branchId: c.branchId, customerId: cu.id, kind: p.method === 'cash' ? 'paid_out' : 'used_for_food', amount: -p.amount, at: p.at, by: p.by });
    }
    const { changeOwed: _old, ...rest } = raw;
    void _old;
    const settings = { ...rest.settings, warnAfterMinutes: 3, lateAfterMinutes: 5 };
    delete settings.kitchenAmberMinutes;
    delete settings.kitchenRedMinutes;
    return migrate({ ...rest, version: 2, settings, customers, credit });
  }
  return null;
}

/** Add the generated example orders (demo only) in front of the real ones. */
let examplesCache: Order[] | null = null;
function withExamples(st: AppState): AppState {
  if (!st.settings.showExampleHistory) return st;
  examplesCache = examplesCache ?? exampleHistory(st.menu);
  return { ...st, orders: [...examplesCache, ...st.orders.filter((o) => !o.example)] };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const migrated = migrate(JSON.parse(raw));
      if (migrated) return withExamples(migrated);
    }
  } catch {
    /* ignore and fall back to demo data */
  }
  return withExamples(seedState());
}

let state: AppState = load();

function persist() {
  try {
    // Example orders are regenerated at load, so they are never written to storage.
    const toSave = state.settings.showExampleHistory ? { ...state, orders: state.orders.filter((o) => !o.example) } : state;
    localStorage.setItem(KEY, JSON.stringify(toSave));
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
  /** Existing customer, or details of a new one. Needed when change is used or kept. */
  customer?: CustomerRef;
  /** Change (base currency) kept on the customer's balance instead of handed over. */
  keep?: { amount: number; currency: string };
  parentOrderId?: string;
  cashierId: string;
}

export type CustomerRef = { id: string } | { name: string; phone?: string; note?: string };

export interface PlaceOrderSuccess {
  ok: true;
  order: Order;
  customer?: Customer;
  /** The 'change left' entry, when change was kept. */
  kept?: CreditEntry;
  /** Change used from the balance to pay for this order. */
  used: number;
  balanceAfter?: number;
}
export type PlaceOrderResult = PlaceOrderSuccess | { ok: false; error: string };

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

  // ---- customer change balance
  const used = round2(input.payments.filter((p) => p.methodId === CREDIT_METHOD).reduce((a, p) => a + p.baseAmount, 0));
  const keepAmount = round2(input.keep?.amount ?? 0);
  let customer: Customer | undefined;
  let newCustomer: Customer | undefined;
  const entries: CreditEntry[] = [];

  if (used > 0 || keepAmount > 0) {
    if (!input.customer) return { ok: false, error: 'Choose the customer first.' };
    const ref = input.customer;
    if (!('name' in ref)) {
      customer = s.customers.find((c) => c.id === ref.id);
      if (!customer) return { ok: false, error: 'Customer not found.' };
    } else {
      const name = tidyName(ref.name);
      if (!name) return { ok: false, error: 'Enter the customer name.' };
      newCustomer = customer = {
        id: uid('cu-'),
        branchId: s.settings.branchId,
        name,
        phone: ref.phone?.trim() || undefined,
        note: ref.note?.trim() || undefined,
        createdAt: now,
        lastSeenAt: now,
      };
    }
    const balance = customerBalance(s.credit, customer.id);
    if (used > balance + 0.004) return { ok: false, error: `${customer.name} only has ${balance.toFixed(2)} change.` };
    order.customerId = customer.id;
    if (used > 0)
      entries.push({ id: uid('cr-'), branchId: order.branchId, customerId: customer.id, kind: 'used_for_food', amount: -used, orderId: order.id, orderNumber: number, at: now, by: input.cashierId });
    if (keepAmount > 0)
      entries.push({ id: uid('cr-'), branchId: order.branchId, customerId: customer.id, kind: 'change_left', amount: keepAmount, code: voucherCode(), currency: input.keep!.currency, orderId: order.id, orderNumber: number, at: now, by: input.cashierId });
  }

  const custId = customer?.id;
  // A card handed over again is evidently back: close the order still holding it.
  const reusedCard = !input.parentOrderId && mode !== 'slip' && cardsInUse(s.orders).has(number);
  const open = (o: Order) => o.status === 'in_kitchen' || o.status === 'ready';
  const oldIds = new Set(reusedCard ? s.orders.filter((o) => !o.parentOrderId && o.number === number && open(o)).map((o) => o.id) : []);
  const closeOld = (o: Order): Order =>
    (oldIds.has(o.id) || (o.parentOrderId && oldIds.has(o.parentOrderId))) && open(o)
      ? { ...o, status: 'served', history: [...o.history, { status: 'served', at: now, by: input.cashierId, auto: true }] }
      : o;
  set((st) => ({
    ...st,
    dayCounter,
    orders: [...st.orders.map(closeOld), order],
    customers: newCustomer
      ? [...st.customers, newCustomer]
      : custId
        ? st.customers.map((c) => (c.id === custId ? { ...c, lastSeenAt: now } : c))
        : st.customers,
    credit: entries.length ? [...st.credit, ...entries] : st.credit,
  }));
  const kept = entries.find((e) => e.kind === 'change_left');
  return { ok: true, order, customer, kept, used, balanceAfter: custId ? customerBalance(state.credit, custId) : undefined };
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

/* --------------------------------------------------------- customer change */

/** Hand change from the balance back to the customer in cash. */
export function payOutChange(customerId: string, amount: number, by: string): { ok: boolean; error?: string } {
  const bal = customerBalance(state.credit, customerId);
  const a = round2(amount);
  if (!(a > 0)) return { ok: false, error: 'Enter an amount.' };
  if (a > bal + 0.004) return { ok: false, error: 'That is more than the balance.' };
  const at = new Date().toISOString();
  set((st) => ({
    ...st,
    credit: [...st.credit, { id: uid('cr-'), branchId: st.settings.branchId, customerId, kind: 'paid_out', amount: -a, at, by }],
    customers: st.customers.map((c) => (c.id === customerId ? { ...c, lastSeenAt: at } : c)),
  }));
  return { ok: true };
}

export function updateCustomer(id: string, patch: Partial<Pick<Customer, 'name' | 'phone' | 'note'>>) {
  set((st) => ({
    ...st,
    customers: st.customers.map((c) => (c.id === id ? { ...c, ...patch, name: patch.name ? tidyName(patch.name) : c.name } : c)),
  }));
}

/* ---------------------------------------------------------------- settings */

export function updateSettings(patch: Partial<Settings>) {
  set((st) => ({ ...st, settings: { ...st.settings, ...patch } }));
}

export function updatePaymentMethod(id: string, patch: Partial<PaymentMethod>) {
  set((st) => ({ ...st, paymentMethods: st.paymentMethods.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
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

export function setExampleHistory(on: boolean) {
  set((st) => {
    const next = { ...st, settings: { ...st.settings, showExampleHistory: on }, orders: st.orders.filter((o) => !o.example) };
    return on ? withExamples(next) : next;
  });
}

export function resetDemo() {
  state = withExamples(seedState());
  persist();
  emit();
}
