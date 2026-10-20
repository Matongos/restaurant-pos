import { useSyncExternalStore } from 'react';
import type {
  AppState,
  Cancellation,
  Category,
  CreditEntry,
  Expense,
  PaidFrom,
  Purchase,
  PurchaseLine,
  RefundMethod,
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
  Role,
  Staff,
  StaffAction,
} from '../domain/types';
import { DEFAULT_MEAL_PERIODS, seedState, STOCK_ITEMS } from '../data/seed';
import { exampleBooks, exampleCancellations, exampleHistory } from '../data/exampleHistory';
import { nextFreeCard, cardsInUse, customerBalance, pinProblem, ROLE_LABEL, staffRights, tidyName, todayISO, uid, voucherCode } from '../domain/rules';
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
  if (raw?.version === 6) return raw as AppState;
  if (raw?.version === 5) {
    // v6: staff management (history of staff changes).
    const st = raw as AppState;
    // The old default green becomes the new default teal (a colour the owner chose is kept).
    const settings = st.settings.brandColor?.toLowerCase() === '#1f6f43' ? { ...st.settings, brandColor: '#0f766e' } : st.settings;
    return { ...st, version: 6, settings, staffLog: [] };
  }
  if (raw?.version === 4) {
    // v5: accounting (purchases, expenses, cancellations) and cost per plate.
    const st = raw as AppState;
    const seedMenu = seedState().menu;
    return migrate({
      ...st,
      version: 5,
      stockItems: STOCK_ITEMS,
      purchases: [],
      expenses: [],
      cancellations: [],
      menu: st.menu.map((m) => (m.costPerPlate === undefined ? { ...m, costPerPlate: seedMenu.find((x) => x.id === m.id)?.costPerPlate } : m)),
    });
  }
  if (raw?.version === 3 || raw?.version === 2) {
    // v4: example history is generated at load instead of saved; analytics settings added.
    const st = raw as AppState;
    return migrate({
      ...st,
      version: 4,
      orders: st.orders.filter((o) => !o.example),
      settings: { ...st.settings, showExampleHistory: true, mealPeriods: DEFAULT_MEAL_PERIODS, customersPerStaffHour: 12 },
    } as AppState);
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

/** Add the generated example records (demo only) in front of the real ones. They are never saved. */
let examplesCache: { orders: Order[]; cancellations: Cancellation[]; purchases: Purchase[]; expenses: Expense[] } | null = null;
function withExamples(st: AppState): AppState {
  if (!st.settings.showExampleHistory) return st;
  if (!examplesCache) {
    const sales = exampleCancellations(exampleHistory(st.menu));
    examplesCache = { ...sales, ...exampleBooks(STOCK_ITEMS) };
  }
  const real = stripExamples(st);
  return {
    ...real,
    orders: [...examplesCache.orders, ...real.orders],
    cancellations: [...examplesCache.cancellations, ...real.cancellations],
    purchases: [...examplesCache.purchases, ...real.purchases],
    expenses: [...examplesCache.expenses, ...real.expenses],
  };
}

function stripExamples(st: AppState): AppState {
  return {
    ...st,
    orders: st.orders.filter((o) => !o.example),
    cancellations: st.cancellations.filter((c) => !c.example),
    purchases: st.purchases.filter((p) => !p.example),
    expenses: st.expenses.filter((e) => !e.example),
  };
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
    const toSave = stripExamples(state);
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
      dropEndedSession();
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

/**
 * If the signed-in person was suspended or removed (on any till), forget their session
 * here, so reactivating them later doesn't silently sign them back in.
 */
function dropEndedSession() {
  const id = readSession();
  if (!id) return;
  const s = state.staff.find((x) => x.id === id);
  if (!s || !canSignIn(s)) writeSession(null);
}

export function currentUser(): Staff | null {
  const id = readSession();
  return state.staff.find((s) => s.id === id && canSignIn(s)) ?? null;
}

/** Suspended or removed staff are signed out everywhere straight away. */
const canSignIn = (s: Staff) => s.active && !s.deletedAt;

export function useCurrentUser(): Staff | null {
  const id = useSyncExternalStore(subscribe, readSession);
  const staff = useStore((s) => s.staff);
  return staff.find((s) => s.id === id && canSignIn(s)) ?? null;
}

export function login(pin: string): Staff | null {
  const user = state.staff.find((s) => canSignIn(s) && s.pin === pin) ?? null;
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

/* --------------------------------------------------------------- categories */

export function upsertCategory(c: Category) {
  set((st) => {
    const exists = st.categories.some((x) => x.id === c.id);
    const sort = exists ? c.sort : Math.max(0, ...st.categories.map((x) => x.sort)) + 1;
    const next = { ...c, name: c.name.trim(), sort };
    return { ...st, categories: exists ? st.categories.map((x) => (x.id === c.id ? next : x)) : [...st.categories, next] };
  });
}

/** Move a category one place left (-1) or right (+1) on the till. */
export function moveCategory(id: string, dir: -1 | 1) {
  set((st) => {
    const sorted = st.categories.slice().sort((a, b) => a.sort - b.sort);
    const i = sorted.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return st;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    return { ...st, categories: sorted.map((c, k) => ({ ...c, sort: k + 1 })) };
  });
}

/** Delete a category. Its meals must go somewhere: they are moved to `moveTo`. */
export function deleteCategory(id: string, moveTo?: string): { ok: true } | { ok: false; error: string } {
  const used = state.menu.filter((m) => m.categoryId === id).length;
  if (state.categories.length <= 1) return { ok: false, error: 'Keep at least one category' };
  if (used && (!moveTo || moveTo === id || !state.categories.some((c) => c.id === moveTo))) return { ok: false, error: 'Choose where its meals go' };
  set((st) => ({
    ...st,
    categories: st.categories.filter((c) => c.id !== id),
    menu: used ? st.menu.map((m) => (m.categoryId === id ? { ...m, categoryId: moveTo! } : m)) : st.menu,
  }));
  return { ok: true };
}

export function setExampleHistory(on: boolean) {
  set((st) => {
    const next = stripExamples({ ...st, settings: { ...st.settings, showExampleHistory: on } });
    return on ? withExamples(next) : next;
  });
}

export function resetDemo() {
  state = withExamples(seedState());
  persist();
  emit();
}

/* -------------------------------------------------------------- accounting */

/** A manager or owner PIN, used to approve cancellations. */
export function verifyManagerPin(pin: string): Staff | null {
  return state.staff.find((s) => canSignIn(s) && s.pin === pin && (s.role === 'manager' || s.role === 'super_admin')) ?? null;
}

export interface CancelInput {
  orderId: string;
  reason: string;
  refund: RefundMethod;
  requestedBy: string;
  approverPin: string;
}

/**
 * Cancel a sale. The order is kept (status "cancelled") together with a Cancellation record.
 * Add-on drinks on the same number are cancelled with it. Customer change that was used
 * or kept on this sale is put back; a refund can be paid in cash or added to the customer's change.
 */
export function cancelOrder(input: CancelInput): { ok: true; cancellation: Cancellation } | { ok: false; error: string } {
  const approver = verifyManagerPin(input.approverPin);
  if (!approver) return { ok: false, error: 'That is not a manager or owner PIN.' };
  if (!input.reason.trim()) return { ok: false, error: 'Give a reason.' };
  const order = state.orders.find((o) => o.id === input.orderId);
  if (!order) return { ok: false, error: 'Sale not found.' };
  if (order.status === 'cancelled') return { ok: false, error: 'This sale is already cancelled.' };
  const group = state.orders.filter((o) => (o.id === order.id || o.parentOrderId === order.id) && o.status !== 'cancelled');
  const ids = new Set(group.map((o) => o.id));
  const total = round2(group.reduce((s, o) => s + o.total, 0));
  const now = new Date().toISOString();

  // Customer change touched by these sales is put back as it was.
  const entries: CreditEntry[] = [];
  for (const e of state.credit) {
    if (!e.orderId || !ids.has(e.orderId)) continue;
    if (e.kind === 'used_for_food' || e.kind === 'change_left')
      entries.push({ id: uid('cr-'), branchId: e.branchId, customerId: e.customerId, kind: 'cancel_adjust', amount: -e.amount, orderId: e.orderId, orderNumber: e.orderNumber, at: now, by: approver.id });
  }
  const changeUsed = round2(group.flatMap((o) => o.payments).filter((p) => p.methodId === CREDIT_METHOD).reduce((s, p) => s + p.baseAmount, 0));
  const refundAmount = input.refund === 'none' ? 0 : round2(Math.max(0, total - changeUsed));
  if (input.refund === 'to_change') {
    if (!order.customerId) return { ok: false, error: 'This sale has no customer to give the change to.' };
    if (refundAmount > 0)
      entries.push({ id: uid('cr-'), branchId: order.branchId, customerId: order.customerId, kind: 'refund', amount: refundAmount, orderId: order.id, orderNumber: order.number, at: now, by: approver.id });
  }

  const c: Cancellation = {
    id: uid('cx-'),
    branchId: order.branchId,
    orderId: order.id,
    orderNumber: order.number,
    orderTotal: total,
    reason: input.reason.trim(),
    refund: input.refund,
    refundAmount,
    requestedBy: input.requestedBy,
    approvedBy: approver.id,
    at: now,
  };
  set((st) => ({
    ...st,
    orders: st.orders.map((o) =>
      ids.has(o.id) ? { ...o, status: 'cancelled', cancellationId: c.id, history: [...o.history, { status: 'cancelled', at: now, by: approver.id }] } : o,
    ),
    cancellations: [...st.cancellations, c],
    credit: entries.length ? [...st.credit, ...entries] : st.credit,
  }));
  return { ok: true, cancellation: c };
}

export interface PurchaseInput {
  date: string;
  supplier: string;
  lines: { name: string; qty: number; unit: string; unitCost: number }[];
  currency: string;
  paidFrom: PaidFrom;
  note?: string;
  by: string;
}

export function recordPurchase(input: PurchaseInput): { ok: true; purchase: Purchase } | { ok: false; error: string } {
  const cur = state.currencies.find((c) => c.code === input.currency);
  if (!cur) return { ok: false, error: 'Choose a currency.' };
  const lines = input.lines.filter((l) => l.name.trim() && l.qty > 0 && l.unitCost >= 0);
  if (!lines.length) return { ok: false, error: 'Add at least one item with a quantity and cost.' };
  if (!input.supplier.trim()) return { ok: false, error: 'Enter the supplier (where it was bought).' };

  // Each item name becomes (or matches) a stock item, remembering its last cost.
  const stock = [...state.stockItems];
  const pl: PurchaseLine[] = lines.map((l) => {
    const name = l.name.trim();
    let item = stock.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!item) {
      item = { id: uid('st-'), name, unit: l.unit.trim() || 'each' };
      stock.push(item);
    }
    const idx = stock.indexOf(item);
    stock[idx] = { ...item, unit: l.unit.trim() || item.unit, lastUnitCost: round2(l.unitCost / cur.rate) };
    return { stockItemId: item.id, name: item.name, qty: l.qty, unit: l.unit.trim() || item.unit, unitCost: round2(l.unitCost) };
  });
  const total = round2(pl.reduce((s, l) => s + l.qty * l.unitCost, 0));
  const purchase: Purchase = {
    id: uid('p-'),
    branchId: state.settings.branchId,
    date: input.date,
    supplier: input.supplier.trim(),
    lines: pl,
    currency: cur.code,
    total,
    baseTotal: round2(total / cur.rate),
    paidFrom: input.paidFrom,
    note: input.note?.trim() || undefined,
    at: new Date().toISOString(),
    by: input.by,
  };
  set((st) => ({ ...st, stockItems: stock, purchases: [...st.purchases, purchase] }));
  return { ok: true, purchase };
}

/** Correct a purchase entered by mistake: adds a reversing record with negative amounts. */
export function reversePurchase(id: string, reason: string, by: string): { ok: boolean; error?: string } {
  const p = state.purchases.find((x) => x.id === id);
  if (!p) return { ok: false, error: 'Not found.' };
  if (p.reversesId || state.purchases.some((x) => x.reversesId === id)) return { ok: false, error: 'Already reversed.' };
  if (!reason.trim()) return { ok: false, error: 'Give a reason.' };
  const r: Purchase = {
    ...p,
    id: uid('p-'),
    lines: p.lines.map((l) => ({ ...l, qty: -l.qty })),
    total: -p.total,
    baseTotal: -p.baseTotal,
    at: new Date().toISOString(),
    by,
    reversesId: p.id,
    reason: reason.trim(),
    example: undefined,
  };
  set((st) => ({ ...st, purchases: [...st.purchases, r] }));
  return { ok: true };
}

export interface ExpenseInput {
  date: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  paidFrom: PaidFrom;
  by: string;
}

export function recordExpense(input: ExpenseInput): { ok: true; expense: Expense } | { ok: false; error: string } {
  const cur = state.currencies.find((c) => c.code === input.currency);
  if (!cur) return { ok: false, error: 'Choose a currency.' };
  if (!(input.amount > 0)) return { ok: false, error: 'Enter the amount.' };
  if (!input.category.trim()) return { ok: false, error: 'Choose what it was for.' };
  const e: Expense = {
    id: uid('e-'),
    branchId: state.settings.branchId,
    date: input.date,
    category: input.category.trim(),
    description: input.description.trim() || input.category.trim(),
    currency: cur.code,
    amount: round2(input.amount),
    baseAmount: round2(input.amount / cur.rate),
    paidFrom: input.paidFrom,
    at: new Date().toISOString(),
    by: input.by,
  };
  set((st) => ({ ...st, expenses: [...st.expenses, e] }));
  return { ok: true, expense: e };
}

export function reverseExpense(id: string, reason: string, by: string): { ok: boolean; error?: string } {
  const e = state.expenses.find((x) => x.id === id);
  if (!e) return { ok: false, error: 'Not found.' };
  if (e.reversesId || state.expenses.some((x) => x.reversesId === id)) return { ok: false, error: 'Already reversed.' };
  if (!reason.trim()) return { ok: false, error: 'Give a reason.' };
  set((st) => ({
    ...st,
    expenses: [...st.expenses, { ...e, id: uid('e-'), amount: -e.amount, baseAmount: -e.baseAmount, at: new Date().toISOString(), by, reversesId: e.id, reason: reason.trim(), example: undefined }],
  }));
  return { ok: true };
}

/* ------------------------------------------------------------------- staff */

export type StaffResult = { ok: true; staff: Staff } | { ok: false; error: string };

function actorAndTarget(byId: string, targetId: string) {
  const actor = state.staff.find((s) => s.id === byId && canSignIn(s));
  const target = state.staff.find((s) => s.id === targetId);
  return { actor, target, rights: actor && target ? staffRights(actor, target) : null };
}

function logStaff(st: AppState, by: string, staffId: string, action: StaffAction, detail?: string): AppState {
  return { ...st, staffLog: [...st.staffLog, { id: uid('se-'), at: new Date().toISOString(), by, staffId, action, detail }] };
}

const activeOwners = (staff: Staff[]) => staff.filter((s) => s.role === 'super_admin' && canSignIn(s));

export interface NewStaff {
  name: string;
  role: Role;
  pin: string;
  phone?: string;
}

export function addStaff(input: NewStaff, byId: string): StaffResult {
  const actor = state.staff.find((s) => s.id === byId && canSignIn(s));
  if (!actor) return { ok: false, error: 'Please log in again' };
  const allowed = staffRights(actor, { id: '', name: '', pin: '', role: input.role, active: true });
  if (!allowed.role) return { ok: false, error: `${ROLE_LABEL[actor.role]}s can't add a ${ROLE_LABEL[input.role]}` };
  const name = tidyName(input.name);
  if (!name) return { ok: false, error: 'Type their name' };
  const bad = pinProblem(input.pin, state.staff);
  if (bad) return { ok: false, error: bad };
  const now = new Date().toISOString();
  const staff: Staff = { id: uid('u-'), name, role: input.role, pin: input.pin, phone: input.phone?.trim() || undefined, active: true, createdAt: now, pinChangedAt: now };
  set((st) => logStaff({ ...st, staff: [...st.staff, staff] }, byId, staff.id, 'added', ROLE_LABEL[staff.role]));
  return { ok: true, staff };
}

export function updateStaff(id: string, patch: { name?: string; phone?: string; role?: Role }, byId: string): StaffResult {
  const { actor, target, rights } = actorAndTarget(byId, id);
  if (!actor || !target || !rights?.edit) return { ok: false, error: "You can't change this person" };
  const name = patch.name !== undefined ? tidyName(patch.name) : target.name;
  if (!name) return { ok: false, error: 'Type their name' };
  let role = target.role;
  if (patch.role && patch.role !== target.role) {
    if (!rights.role) return { ok: false, error: "You can't change your own role" };
    const newRights = staffRights(actor, { ...target, role: patch.role });
    if (!newRights.role) return { ok: false, error: `${ROLE_LABEL[actor.role]}s can't make someone a ${ROLE_LABEL[patch.role]}` };
    if (target.role === 'super_admin' && activeOwners(state.staff).length <= 1) return { ok: false, error: 'There must always be at least one owner' };
    role = patch.role;
  }
  const phone = patch.phone !== undefined ? patch.phone.trim() || undefined : target.phone;
  const changes = [
    name !== target.name && `name ${target.name} → ${name}`,
    role !== target.role && `role ${ROLE_LABEL[target.role]} → ${ROLE_LABEL[role]}`,
    phone !== target.phone && 'phone',
  ].filter(Boolean);
  if (!changes.length) return { ok: true, staff: target };
  const updated = { ...target, name, role, phone };
  set((st) => logStaff({ ...st, staff: st.staff.map((s) => (s.id === id ? updated : s)) }, byId, id, 'edited', changes.join(', ')));
  return { ok: true, staff: updated };
}

export function setStaffPin(id: string, pin: string, byId: string): StaffResult {
  const { actor, target, rights } = actorAndTarget(byId, id);
  if (!actor || !target || !rights?.pin) return { ok: false, error: "You can't change this person's PIN" };
  const bad = pinProblem(pin, state.staff, id);
  if (bad) return { ok: false, error: bad };
  const updated = { ...target, pin, pinChangedAt: new Date().toISOString() };
  set((st) => logStaff({ ...st, staff: st.staff.map((s) => (s.id === id ? updated : s)) }, byId, id, 'pin_changed'));
  return { ok: true, staff: updated };
}

export function setStaffSuspended(id: string, suspended: boolean, byId: string, reason = ''): StaffResult {
  const { actor, target, rights } = actorAndTarget(byId, id);
  if (!actor || !target || !rights?.suspend) return { ok: false, error: actor?.id === id ? "You can't suspend yourself" : "You can't suspend this person" };
  if (suspended && target.role === 'super_admin' && activeOwners(state.staff).length <= 1) return { ok: false, error: 'There must always be at least one owner' };
  if (suspended === !target.active) return { ok: true, staff: target };
  const updated = { ...target, active: !suspended };
  set((st) => logStaff({ ...st, staff: st.staff.map((s) => (s.id === id ? updated : s)) }, byId, id, suspended ? 'suspended' : 'reactivated', reason.trim() || undefined));
  return { ok: true, staff: updated };
}

/** Removes someone from the staff list for good. Their name stays on everything they did. */
export function removeStaff(id: string, byId: string, reason = ''): StaffResult {
  const { actor, target, rights } = actorAndTarget(byId, id);
  if (!actor || !target || !rights?.remove) return { ok: false, error: actor?.id === id ? "You can't remove yourself" : "You can't remove this person" };
  if (target.role === 'super_admin' && activeOwners(state.staff).filter((s) => s.id !== id).length < 1) return { ok: false, error: 'There must always be at least one owner' };
  const updated = { ...target, active: false, deletedAt: new Date().toISOString() };
  set((st) => logStaff({ ...st, staff: st.staff.map((s) => (s.id === id ? updated : s)) }, byId, id, 'deleted', reason.trim() || undefined));
  return { ok: true, staff: updated };
}
