import { useMemo, useSyncExternalStore } from 'react';
import type {
  DiningTable,
  OnlineOrderInfo,
  TableInfo,
  TabShare,
  AddOn,
  StockItem,
  StockMove,
  AppState,
  DeliveryArea,
  DeliveryInfo,
  OrderType,
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
import { DEFAULT_TABLES, DEFAULT_ADD_ONS, DEFAULT_ADDON_RECIPES, DEFAULT_DELIVERY_AREAS, DEFAULT_MEAL_ADD_ONS, DEFAULT_RECIPES, demoOpeningMoves, STOCK_SETUP, DEFAULT_MEAL_PERIODS, seedState, STOCK_ITEMS } from '../data/seed';
import { exampleBooks, exampleCancellations, exampleHistory } from '../data/exampleHistory';
import { nextFreeCard, cardsInUse, customerBalance, pinProblem, ROLE_LABEL, staffRights, tidyName, todayISO, uid, voucherCode } from '../domain/rules';
import { CREDIT_METHOD } from '../domain/types';
import { round2 } from '../domain/money';
import { purchaseToStock, stockLevels, usageFor, type StockLevel } from '../domain/stock';
import { openTab, openTabs, tabDue, tabItemsTotal, tabRounds } from '../domain/tables';

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
  if (raw?.version === 11) return raw as AppState;
  if (raw?.version === 10) {
    // v11: table service (off by default) with example tables.
    const st = raw as AppState;
    return { ...st, version: 11, settings: { serviceMode: 'counter', tables: DEFAULT_TABLES, askGuests: true, serviceChargePct: 0, ...st.settings } };
  }
  if (raw?.version === 9) {
    // v10: stock counted down with every sale (recipes per meal, counts, waste).
    const st = raw as AppState;
    const known = new Set(st.stockItems.map((i) => i.id));
    return migrate({
      ...st,
      version: 10,
      stockItems: st.stockItems.map((i) => (i.track === undefined && STOCK_SETUP[i.id] ? { ...i, ...STOCK_SETUP[i.id] } : i)),
      menu: st.menu.map((m) => (m.recipe || !DEFAULT_RECIPES[m.id] ? m : { ...m, recipe: DEFAULT_RECIPES[m.id].filter((r) => known.has(r.stockItemId)) })),
      addOns: st.addOns.map((a) => (a.recipe || !DEFAULT_ADDON_RECIPES[a.id] ? a : { ...a, recipe: DEFAULT_ADDON_RECIPES[a.id] })),
      // Practice data only: give the demo an opening stock take. A real (non-training) set-up starts uncounted.
      stockMoves: st.settings.trainingMode ? demoOpeningMoves(new Date().toISOString()).filter((m) => known.has(m.stockItemId)) : [],
    });
  }
  if (raw?.version === 8) {
    // v9: delivery orders (areas with fees; customer, address and rider on the order).
    const st = raw as AppState;
    return migrate({
      ...st,
      version: 9,
      settings: { ...st.settings, deliveryAreas: st.settings.deliveryAreas ?? DEFAULT_DELIVERY_AREAS },
      orderTypes: st.orderTypes.map((t) => (t.id === 'delivery' ? { ...t, packaging: t.packaging || 'Plastic container + bag' } : t)),
    });
  }
  if (raw?.version === 7) {
    // v8: priced add-ons (extra meat +$1.50, extra gravy free ...), chosen per meal.
    const st = raw as AppState;
    const menu = st.menu.map((m) => (m.addOnIds || !DEFAULT_MEAL_ADD_ONS[m.id] ? m : { ...m, addOnIds: DEFAULT_MEAL_ADD_ONS[m.id] }));
    return migrate({ ...st, version: 8, addOns: st.addOns ?? DEFAULT_ADD_ONS, menu });
  }
  if (raw?.version === 6) {
    // v7: meals "come with" parts the customer can say no to (coslo with rice meals, covo with sadza).
    const st = raw as AppState;
    const components = st.components.some((c) => c.id === 'coslo') ? st.components : [...st.components, { id: 'coslo', name: 'Coslo (cabbage salad)', available: true }];
    const menu = st.menu.map((m) => {
      if (m.optionalIds) return m;
      const withCoslo = (m.id === 'm-rice-beef' || m.id === 'm-rice-chicken') && !m.componentIds.includes('coslo') ? [...m.componentIds, 'coslo'] : m.componentIds;
      const optionalIds = withCoslo.filter((id) => id === 'coslo' || id === 'greens');
      return { ...m, componentIds: withCoslo, optionalIds: optionalIds.length ? optionalIds : undefined };
    });
    return migrate({ ...st, version: 7, components, menu });
  }
  if (raw?.version === 5) {
    // v6: staff management (history of staff changes).
    const st = raw as AppState;
    // The old default green becomes the new default teal (a colour the owner chose is kept).
    const settings = st.settings.brandColor?.toLowerCase() === '#1f6f43' ? { ...st.settings, brandColor: '#0f766e' } : st.settings;
    return migrate({ ...st, version: 6, settings, staffLog: [] });
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

type ChangeHook = (prev: AppState, next: AppState) => void;
let changeHook: ChangeHook | null = null;
/** The online sync listens here for changes made on this device. */
export function onLocalChange(hook: ChangeHook | null) {
  changeHook = hook;
}

function set(updater: (s: AppState) => AppState) {
  const prev = state;
  state = updater(state);
  persist();
  emit();
  changeHook?.(prev, state);
}

/** Changes that came from another device: saved and shown, but not sent back out. */
export function applyRemote(updater: (s: AppState) => AppState) {
  const next = updater(state);
  if (next === state) return;
  state = next;
  persist();
  dropEndedSession();
  emit();
}

/** Replace everything on this device with the restaurant's data from the online account. */
export function replaceAll(next: AppState) {
  state = withExamples(next);
  persist();
  dropEndedSession();
  emit();
}

/** An empty restaurant (no menu, orders or staff) with this version's default settings, to fill from the online account. */
export function emptyState(): AppState {
  const seed = stripExamples(seedState());
  return {
    ...seed,
    staff: [], currencies: [], paymentMethods: [], orderTypes: [], categories: [], components: [], menu: [], addOns: [],
    orders: [], customers: [], credit: [], stockItems: [], stockMoves: [], purchases: [], expenses: [], cancellations: [], staffLog: [],
    liveCarts: {},
  };
}

// Another window (e.g. customer display) changed the data → reload it here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      const prev = state;
      state = load();
      dropEndedSession();
      emit();
      changeHook?.(prev, state); // another window of this app changed something: send it too
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
  /** Delivery orders: name, phone, address and fee (the fee is added to the total). */
  delivery?: DeliveryInfo;
}

/** What still stops a delivery order going through, or '' when the details are complete. */
export function deliveryProblem(d?: Partial<DeliveryInfo>): string {
  if (!d) return 'Add the delivery details';
  if (!d.name?.trim()) return 'Type the customer name';
  if ((d.phone ?? '').replace(/\D/g, '').length < 7) return 'Type a phone number for the rider';
  if (!d.address?.trim()) return 'Type the delivery address';
  if (!(Number(d.fee) >= 0)) return 'Check the delivery fee';
  return '';
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

/**
 * Customer change on a payment: change used to pay (taken off their balance) and change kept for
 * them (added). Shared by counter sales and table bill shares.
 */
function customerChange(
  s: AppState,
  x: { payments: Payment[]; customer?: CustomerRef; keep?: { amount: number; currency: string }; cashierId: string; orderId: string; orderNumber: number; branchId: string; now: string },
): { ok: true; customer?: Customer; newCustomer?: Customer; entries: CreditEntry[]; used: number } | { ok: false; error: string } {
  const used = round2(x.payments.filter((p) => p.methodId === CREDIT_METHOD).reduce((a, p) => a + p.baseAmount, 0));
  const keepAmount = round2(x.keep?.amount ?? 0);
  const entries: CreditEntry[] = [];
  if (!(used > 0 || keepAmount > 0)) return { ok: true, entries, used };
  if (!x.customer) return { ok: false, error: 'Choose the customer first.' };
  const ref = x.customer;
  let customer: Customer | undefined;
  let newCustomer: Customer | undefined;
  if (!('name' in ref)) {
    customer = s.customers.find((c) => c.id === ref.id);
    if (!customer) return { ok: false, error: 'Customer not found.' };
  } else {
    const name = tidyName(ref.name);
    if (!name) return { ok: false, error: 'Enter the customer name.' };
    newCustomer = customer = { id: uid('cu-'), branchId: s.settings.branchId, name, phone: ref.phone?.trim() || undefined, note: ref.note?.trim() || undefined, createdAt: x.now, lastSeenAt: x.now };
  }
  const balance = customerBalance(s.credit, customer.id);
  if (used > balance + 0.004) return { ok: false, error: `${customer.name} only has ${balance.toFixed(2)} change.` };
  if (used > 0)
    entries.push({ id: uid('cr-'), branchId: x.branchId, customerId: customer.id, kind: 'used_for_food', amount: -used, orderId: x.orderId, orderNumber: x.orderNumber, at: x.now, by: x.cashierId });
  if (keepAmount > 0)
    entries.push({ id: uid('cr-'), branchId: x.branchId, customerId: customer.id, kind: 'change_left', amount: keepAmount, code: voucherCode(), currency: x.keep!.currency, orderId: x.orderId, orderNumber: x.orderNumber, at: x.now, by: x.cashierId });
  return { ok: true, customer, newCustomer, entries, used };
}

export function placeOrder(input: PlaceOrderInput): PlaceOrderResult {
  const s = state;
  const now = new Date().toISOString();
  const isDelivery = input.orderTypeId === 'delivery' && !input.parentOrderId;
  if (isDelivery) {
    const problem = deliveryProblem(input.delivery);
    if (problem) return { ok: false, error: problem };
  }
  const delivery: DeliveryInfo | undefined = isDelivery
    ? {
        ...input.delivery!,
        name: tidyName(input.delivery!.name),
        phone: input.delivery!.phone.trim(),
        address: input.delivery!.address.trim(),
        note: input.delivery!.note?.trim() || undefined,
        fee: round2(input.delivery!.fee),
      }
    : undefined;
  const total = round2(input.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0) + (delivery?.fee ?? 0));
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
    ...(delivery ? { delivery } : {}),
  };
  const stockUsed = usageFor(input.lines, input.orderTypeId, s);
  if (stockUsed) order.stockUsed = stockUsed;

  // ---- customer change balance
  const cc = customerChange(s, { payments: input.payments, customer: input.customer, keep: input.keep, cashierId: input.cashierId, orderId: order.id, orderNumber: number, branchId: order.branchId, now });
  if (!cc.ok) return cc;
  const { customer, newCustomer, entries, used } = cc;
  if (customer) order.customerId = customer.id;

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

/** A rider leaves with a delivery order. It stays open (and its card in use) until marked delivered. */
export function sendOutForDelivery(orderId: string, rider: string, by: string) {
  const at = new Date().toISOString();
  set((st) => ({
    ...st,
    orders: st.orders.map((o) =>
      o.id === orderId && o.delivery
        ? {
            ...o,
            // Food leaving the shop is done in the kitchen, even if nobody tapped Done there.
            status: o.status === 'in_kitchen' ? 'ready' : o.status,
            delivery: { ...o.delivery, outAt: at, outBy: by, rider: rider.trim() || undefined },
            history: [...o.history, ...(o.status === 'in_kitchen' ? [{ status: 'ready' as const, at, by }] : []), { status: 'out_for_delivery' as const, at, by }],
          }
        : o,
    ),
  }));
}

/* ----------------------------------------------------------- order types */

export function setOrderTypeEnabled(id: string, enabled: boolean) {
  set((st) => ({ ...st, orderTypes: st.orderTypes.map((t) => (t.id === id ? { ...t, enabled } : t)) }));
}

export function updateOrderType(id: string, patch: Partial<Pick<OrderType, 'name' | 'ticketLabel' | 'packaging'>>) {
  set((st) => ({ ...st, orderTypes: st.orderTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}

/** Add or change a delivery area (Town centre $1 ...). */
export function upsertDeliveryArea(a: DeliveryArea): { ok: true } | { ok: false; error: string } {
  const name = a.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Give the area a name' };
  if (!(a.fee >= 0)) return { ok: false, error: 'The fee cannot be below zero' };
  const areas = state.settings.deliveryAreas ?? [];
  if (areas.some((x) => x.id !== a.id && x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `${name} is already listed` };
  const next = { ...a, name, fee: round2(a.fee) };
  const list = areas.some((x) => x.id === a.id) ? areas.map((x) => (x.id === a.id ? next : x)) : [...areas, next];
  set((st) => ({ ...st, settings: { ...st.settings, deliveryAreas: list } }));
  return { ok: true };
}

export function deleteDeliveryArea(id: string) {
  set((st) => ({ ...st, settings: { ...st.settings, deliveryAreas: (st.settings.deliveryAreas ?? []).filter((a) => a.id !== id) } }));
}

/* ------------------------------------------------------------------ tables */

/**
 * Send what was just entered for a table to the kitchen, without payment. The first round opens
 * the table's bill (who serves it, how many guests); later rounds are added to it.
 */
export function sendTableRound(input: { tableId: string; guests?: number; lines: OrderLine[]; cashierId: string }): { ok: true; order: Order } | { ok: false; error: string } {
  const s = state;
  const table = (s.settings.tables ?? []).find((t) => t.id === input.tableId);
  if (!table) return { ok: false, error: 'Table not found.' };
  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) return { ok: false, error: 'Add something first.' };
  const tab = openTab(s.orders, table.id);
  const now = new Date().toISOString();
  const round = tab ? tabRounds(s.orders, tab).length + 1 : 1;
  const order: Order = {
    id: uid('o-'),
    branchId: s.settings.branchId,
    tillId: 'tables',
    number: 0,
    numberMode: 'slip',
    orderTypeId: 'eat_in',
    lines,
    total: round2(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)),
    payments: [],
    changeGiven: 0,
    changeCurrency: s.settings.baseCurrency,
    status: 'in_kitchen',
    history: [
      { status: 'placed', at: now, by: input.cashierId },
      { status: 'in_kitchen', at: now, by: input.cashierId },
    ],
    cashierId: input.cashierId,
    createdAt: now,
    parentOrderId: tab?.id,
    training: s.settings.trainingMode,
    table: tab
      ? { tableId: table.id, name: table.name, round }
      : { tableId: table.id, name: table.name, round: 1, guests: input.guests && input.guests > 0 ? input.guests : undefined, waiterId: input.cashierId, status: 'open', shares: [] },
  };
  const stockUsed = usageFor(lines, 'eat_in', s);
  if (stockUsed) order.stockUsed = stockUsed;
  set((st) => ({
    ...st,
    // New food on a bill that was already printed: the bill is out of date again.
    orders: [...st.orders.map((o) => (tab && o.id === tab.id && o.table?.status === 'billed' ? { ...o, table: { ...o.table, status: 'open' as const } } : o)), order],
  }));
  return { ok: true, order };
}

/** A customer's order from the web page / QR menu, accepted at the till: goes to the kitchen now, paid at the counter. */
export function acceptOnlineOrder(input: {
  online: OnlineOrderInfo;
  lines: { itemId: string; name: string; qty: number; unitPrice: number; extras?: string[]; without?: string[]; note?: string }[];
  cashierId: string;
}): { ok: true; order: Order } | { ok: false; error: string } {
  const s = state;
  if (s.orders.some((o) => o.online?.id === input.online.id)) return { ok: false, error: 'This order is already on the till.' };
  const lines: OrderLine[] = input.lines.map((l) => {
    const item = s.menu.find((m) => m.id === l.itemId);
    const extras = (l.extras ?? []).map((id) => s.addOns.find((a) => a.id === id)).filter((a): a is AddOn => !!a).map((a) => ({ id: a.id, name: a.name, price: a.price, cost: a.cost }));
    return {
      id: uid('l-'),
      itemId: l.itemId,
      name: item?.name ?? l.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      ...(extras.length ? { extras } : {}),
      ...(l.without?.length ? { without: l.without } : {}),
      ...(l.note ? { note: l.note } : {}),
    };
  });
  if (!lines.length) return { ok: false, error: 'This order is empty.' };
  const now = new Date().toISOString();
  const typeId = input.online.mode === 'table' ? 'eat_in' : s.orderTypes.find((t) => t.id === 'take_away')?.id ?? 'eat_in';
  const label = input.online.mode === 'table' && input.online.table ? `${input.online.table} · WEB ${input.online.number}` : `WEB ${input.online.number}`;
  const order: Order = {
    id: uid('o-'),
    branchId: s.settings.branchId,
    tillId: 'online',
    number: input.online.number,
    numberMode: 'slip',
    orderTypeId: typeId,
    lines,
    total: round2(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)),
    payments: [],
    changeGiven: 0,
    changeCurrency: s.settings.baseCurrency,
    status: 'in_kitchen',
    history: [
      { status: 'placed', at: now, by: input.cashierId },
      { status: 'in_kitchen', at: now, by: input.cashierId },
    ],
    cashierId: input.cashierId,
    createdAt: now,
    training: s.settings.trainingMode,
    table: { tableId: `web-${input.online.id}`, name: label, round: 1, waiterId: input.cashierId, status: 'open', shares: [] },
    online: input.online,
  };
  const stockUsed = usageFor(lines, typeId, s);
  if (stockUsed) order.stockUsed = stockUsed;
  set((st) => ({ ...st, orders: [...st.orders, order] }));
  return { ok: true, order };
}

/** Food taken to the table: rounds that are ready (or still in the kitchen) are marked served. */
export function serveTable(tabId: string, by: string) {
  const at = new Date().toISOString();
  set((st) => ({
    ...st,
    orders: st.orders.map((o) =>
      (o.id === tabId || o.parentOrderId === tabId) && o.table && o.status === 'ready' ? { ...o, status: 'served', history: [...o.history, { status: 'served', at, by }] } : o,
    ),
  }));
}

/** Print the bill: adds the service charge (if set) to round 1 and marks the table as waiting to pay. */
export function billTable(tabId: string, by: string): { ok: true } | { ok: false; error: string } {
  const tab = state.orders.find((o) => o.id === tabId);
  if (!tab?.table) return { ok: false, error: 'Bill not found.' };
  const pct = tab.online ? 0 : state.settings.serviceChargePct ?? 0;
  const items = tabItemsTotal(state.orders, tab);
  const sc = pct > 0 ? round2((items * pct) / 100) : 0;
  const own = round2(tab.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0));
  const at = new Date().toISOString();
  void by;
  set((st) => ({
    ...st,
    orders: st.orders.map((o) => (o.id === tabId ? { ...o, total: round2(own + sc), table: { ...o.table!, status: 'billed', billedAt: at, serviceCharge: sc || undefined } } : o)),
  }));
  return { ok: true };
}

/** Remember how the bill is being split (so it survives closing the screen half-way). */
export function setTabSplit(tabId: string, split: NonNullable<TableInfo['split']>) {
  set((st) => ({ ...st, orders: st.orders.map((o) => (o.id === tabId && o.table ? { ...o, table: { ...o.table, split } } : o)) }));
}

export interface TabPayInput {
  tabId: string;
  label: string;
  /** What this share settles (base currency). */
  amount: number;
  payments: Payment[];
  changeGiven: number;
  changeCurrency: string;
  customer?: CustomerRef;
  keep?: { amount: number; currency: string };
  cashierId: string;
}

/**
 * Pay one share of a table bill (or the whole bill). The money goes on round 1, so the books and the
 * cash drawer see it like any sale. When nothing is left to pay the table is free again.
 */
export function payTabShare(input: TabPayInput): { ok: true; closed: boolean; due: number; kept?: CreditEntry; customer?: Customer; balanceAfter?: number } | { ok: false; error: string } {
  const s = state;
  const tab = s.orders.find((o) => o.id === input.tabId);
  if (!tab?.table || tab.status === 'cancelled') return { ok: false, error: 'This bill is closed.' };
  const due = tabDue(s.orders, tab);
  const amount = round2(input.amount);
  if (!(amount > 0)) return { ok: false, error: 'Nothing to pay.' };
  if (amount > due + 0.004) return { ok: false, error: `Only ${due.toFixed(2)} is left to pay.` };
  const now = new Date().toISOString();
  const cc = customerChange(s, { payments: input.payments, customer: input.customer, keep: input.keep, cashierId: input.cashierId, orderId: tab.id, orderNumber: 0, branchId: tab.branchId, now });
  if (!cc.ok) return cc;
  const share: TabShare = { id: uid('sh-'), label: input.label.trim() || 'Payment', amount, at: now, by: input.cashierId };
  const closed = due - amount <= 0.004;
  const roundIds = new Set(tabRounds(s.orders, tab).map((o) => o.id));
  set((st) => ({
    ...st,
    orders: st.orders.map((o) => {
      if (o.id === tab.id) {
        const t = { ...o.table!, shares: [...(o.table!.shares ?? []), share], ...(closed ? { status: 'paid' as const, paidAt: now } : {}) };
        const served = closed && (o.status === 'in_kitchen' || o.status === 'ready');
        return {
          ...o,
          payments: [...o.payments, ...input.payments],
          changeGiven: round2(o.changeGiven + input.changeGiven),
          changeCurrency: input.changeCurrency,
          customerId: cc.customer?.id ?? o.customerId,
          table: t,
          ...(served ? { status: 'served' as const, history: [...o.history, { status: 'served' as const, at: now, by: input.cashierId, auto: true }] } : {}),
        };
      }
      // Paid in full: the table is done, so any round not marked served is closed (not counted in serving speed).
      if (closed && roundIds.has(o.id) && (o.status === 'in_kitchen' || o.status === 'ready'))
        return { ...o, status: 'served' as const, history: [...o.history, { status: 'served' as const, at: now, by: input.cashierId, auto: true }] };
      return o;
    }),
    customers: cc.newCustomer ? [...st.customers, cc.newCustomer] : cc.customer ? st.customers.map((c) => (c.id === cc.customer!.id ? { ...c, lastSeenAt: now } : c)) : st.customers,
    credit: cc.entries.length ? [...st.credit, ...cc.entries] : st.credit,
  }));
  const kept = cc.entries.find((e) => e.kind === 'change_left');
  return { ok: true, closed, due: round2(Math.max(0, due - amount)), kept, customer: cc.customer, balanceAfter: cc.customer ? customerBalance(state.credit, cc.customer.id) : undefined };
}

/** Add, change or remove tables (Settings → How you serve). A table with an open bill cannot be removed. */
export function saveTables(tables: DiningTable[]): { ok: true } | { ok: false; error: string } {
  const names = new Set<string>();
  for (const t of tables) {
    const n = t.name.trim().toLowerCase();
    if (!n) return { ok: false, error: 'Every table needs a name.' };
    if (names.has(n)) return { ok: false, error: `Two tables are called ${t.name.trim()}.` };
    names.add(n);
  }
  const busy = openTabs(state.orders).find((o) => !tables.some((t) => t.id === o.table!.tableId));
  if (busy) return { ok: false, error: `${busy.table!.name} has an open bill. Close it before removing the table.` };
  set((st) => ({ ...st, settings: { ...st.settings, tables: tables.map((t) => ({ ...t, name: t.name.trim(), area: t.area?.trim() || undefined })) } }));
  return { ok: true };
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

/** A new ingredient or side (e.g. "Coslo"), so meals can be made with it and it can be marked sold out. */
export function addComponent(name: string): string | null {
  const clean = name.trim();
  if (!clean) return null;
  const existing = state.components.find((c) => c.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing.id;
  const id = uid('c-');
  set((st) => ({ ...st, components: [...st.components, { id, name: clean, available: true }] }));
  return id;
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

/* ------------------------------------------------------------------ add-ons */

/** Add or change an add-on (Extra meat +$1.50 ...). Its price applies to new orders only. */
export function upsertAddOn(a: AddOn): { ok: true } | { ok: false; error: string } {
  const name = a.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Give the add-on a name' };
  if (!(a.price >= 0)) return { ok: false, error: 'The price cannot be below zero' };
  if (state.addOns.some((x) => x.id !== a.id && x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `There is already an add-on called ${name}` };
  set((st) => {
    const exists = st.addOns.some((x) => x.id === a.id);
    const sort = exists ? a.sort : Math.max(0, ...st.addOns.map((x) => x.sort)) + 1;
    const next = { ...a, name, price: round2(a.price), cost: a.cost === undefined ? undefined : round2(a.cost), sort };
    return { ...st, addOns: exists ? st.addOns.map((x) => (x.id === a.id ? next : x)) : [...st.addOns, next] };
  });
  return { ok: true };
}

/** Remove an add-on from the menu and from every meal. Past sales keep it (they store their own copy). */
export function deleteAddOn(id: string) {
  set((st) => ({
    ...st,
    addOns: st.addOns.filter((a) => a.id !== id),
    menu: st.menu.map((m) => (m.addOnIds?.includes(id) ? { ...m, addOnIds: m.addOnIds.filter((x) => x !== id) } : m)),
  }));
}

/** Sold out today: a switched-off add-on can't be added at the till until it is back. */
export function setAddOnAvailable(id: string, available: boolean) {
  set((st) => ({ ...st, addOns: st.addOns.map((a) => (a.id === id ? { ...a, available } : a)) }));
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
  const prev = state;
  state = withExamples(seedState());
  persist();
  emit();
  changeHook?.(prev, state);
}

/**
 * Start a real restaurant: remove the demo staff, customers, change, stock, sales and books, and
 * (unless kept) the sample menu. Keeps payment methods, currencies, order types and categories.
 * The owner stays, with a new PIN. Goes to the online account like any other change.
 */
export function startFresh(opts: { ownerPin: string; keepMenu: boolean; byId?: string; ownerName?: string; restaurantName?: string; town?: string }): { ok: true } | { ok: false; error: string } {
  const pin = opts.ownerPin.trim();
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'Owner PIN must be 4 digits.' };
  if (/^(\d)\1{3}$/.test(pin) || pin === '1234') return { ok: false, error: 'Choose a PIN that is harder to guess.' };
  const now = new Date().toISOString();
  set((st0) => {
    const st = stripExamples(st0);
    const me = st.staff.find((x) => x.id === opts.byId && x.role === 'super_admin') ?? st.staff.find((x) => x.role === 'super_admin' && !x.deletedAt);
    const owner: Staff = { ...(me ?? { id: uid('u-'), name: 'Owner', role: 'super_admin', active: true }), pin, active: true, pinChangedAt: now, createdAt: now };
    if (opts.ownerName?.trim()) owner.name = tidyName(opts.ownerName);
    const demoSettings = seedState().settings;
    return {
      ...st,
      settings: {
        ...st.settings,
        trainingMode: false,
        showExampleHistory: false,
        ...(opts.restaurantName?.trim() ? { restaurantName: opts.restaurantName.trim() } : {}),
        tagline: st.settings.tagline === demoSettings.tagline ? '' : st.settings.tagline,
        address: opts.town?.trim() ? opts.town.trim() : st.settings.address === demoSettings.address ? '' : st.settings.address,
        phone: st.settings.phone === demoSettings.phone ? '' : st.settings.phone,
      },
      staff: [owner],
      menu: opts.keepMenu ? st.menu.map((m) => ({ ...m, available: true })) : [],
      addOns: opts.keepMenu ? st.addOns : [],
      components: opts.keepMenu ? st.components.map((c) => ({ ...c, available: true })) : [],
      stockItems: opts.keepMenu ? st.stockItems : [],
      stockMoves: [],
      orders: [],
      customers: [],
      credit: [],
      purchases: [],
      expenses: [],
      cancellations: [],
      staffLog: [],
      liveCarts: {},
      dayCounter: { date: todayISO(), lastSlip: 0 },
    };
  });
  writeSession(getState().staff[0].id);
  emit();
  return { ok: true };
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
  // A table bill may be partly paid (or not at all): only what was paid can be given back.
  const paidFor = order.table ? round2((order.table.shares ?? []).reduce((a, x) => a + x.amount, 0)) : total;
  const refundAmount = input.refund === 'none' ? 0 : round2(Math.max(0, paidFor - changeUsed));
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
    // Bought by the count unit (e.g. 3 kg of a "10 kg bag" item): keep the pack unit, store the cost per pack.
    const typed = l.unit.trim();
    const byCount = !!typed && typed.toLowerCase() === (item.countUnit ?? '').toLowerCase() && typed.toLowerCase() !== item.unit.toLowerCase();
    const perPackN = item.perPack && item.perPack > 0 ? item.perPack : 1;
    stock[idx] = byCount
      ? { ...item, lastUnitCost: round2((l.unitCost / cur.rate) * perPackN) }
      : { ...item, unit: typed || item.unit, lastUnitCost: round2(l.unitCost / cur.rate) };
    const unit = l.unit.trim() || item.unit;
    return { stockItemId: item.id, name: item.name, qty: l.qty, unit, unitCost: round2(l.unitCost), stockQty: purchaseToStock(item, l.qty, unit) };
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

/* ------------------------------------------------------------------- stock */

/** Stock levels for every item, recalculated only when sales, purchases or counts change. */
export function useStockLevels(): Map<string, StockLevel> {
  const stockItems = useStore((s) => s.stockItems);
  const stockMoves = useStore((s) => s.stockMoves);
  const orders = useStore((s) => s.orders);
  const purchases = useStore((s) => s.purchases);
  // Re-check once a minute so "used today" rolls over at midnight.
  const minute = Math.floor(Date.now() / 60000);
  return useMemo(() => stockLevels({ stockItems, stockMoves, orders, purchases }), [stockItems, stockMoves, orders, purchases, minute]);
}

/**
 * A stock take: what was really there. Each count becomes the new starting point for that item,
 * and keeps what the system expected so the difference (losses) can be seen later.
 */
export function recordStockCount(counts: { stockItemId: string; qty: number }[], by: string): { ok: true; n: number } | { ok: false; error: string } {
  const valid = counts.filter((c) => Number.isFinite(c.qty) && c.qty >= 0);
  if (!valid.length) return { ok: false, error: 'Type at least one amount counted.' };
  const at = new Date().toISOString();
  const levels = stockLevels(state);
  const moves: StockMove[] = valid.map((c) => {
    const lv = levels.get(c.stockItemId);
    return { id: uid('sm-'), stockItemId: c.stockItemId, kind: 'count', qty: Math.round(c.qty * 1000) / 1000, expected: lv && lv.status !== 'uncounted' ? lv.onHand : undefined, at, by };
  });
  set((st) => ({ ...st, stockMoves: [...st.stockMoves, ...moves] }));
  return { ok: true, n: moves.length };
}

/** Stock thrown away or used without a sale (spoiled, burnt, staff meal). */
export function recordWaste(stockItemId: string, qty: number, reason: string, by: string): { ok: true } | { ok: false; error: string } {
  if (!(qty > 0)) return { ok: false, error: 'Type how much.' };
  if (!reason.trim()) return { ok: false, error: 'Give a reason.' };
  const m: StockMove = { id: uid('sm-'), stockItemId, kind: 'waste', qty: Math.round(qty * 1000) / 1000, reason: reason.trim(), at: new Date().toISOString(), by };
  set((st) => ({ ...st, stockMoves: [...st.stockMoves, m] }));
  return { ok: true };
}

/** Add or change a stock item (how it is counted, when to warn, whether it hides meals). */
export function upsertStockItem(item: StockItem): { ok: true } | { ok: false; error: string } {
  const name = item.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Give the item a name' };
  if (!item.unit.trim()) return { ok: false, error: 'How is it bought? e.g. kg, 10 kg bag, crate of 24' };
  if (state.stockItems.some((x) => x.id !== item.id && x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `${name} is already in the list` };
  const next = { ...item, name, unit: item.unit.trim(), countUnit: item.countUnit?.trim() || undefined };
  set((st) => ({
    ...st,
    stockItems: st.stockItems.some((x) => x.id === item.id) ? st.stockItems.map((x) => (x.id === item.id ? next : x)) : [...st.stockItems, next],
  }));
  return { ok: true };
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
    lines: p.lines.map((l) => ({ ...l, qty: -l.qty, stockQty: l.stockQty !== undefined ? -l.stockQty : undefined })),
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

/** Anyone signed in can change their own PIN, by typing the current one first. */
export function changeMyPin(id: string, currentPin: string, pin: string): StaffResult {
  const me = state.staff.find((s) => s.id === id && canSignIn(s));
  if (!me) return { ok: false, error: 'Log in again first' };
  if (me.pin !== currentPin) return { ok: false, error: 'Your current PIN is not right' };
  if (pin === currentPin) return { ok: false, error: 'The new PIN is the same as the old one' };
  const bad = pinProblem(pin, state.staff, id);
  if (bad) return { ok: false, error: bad };
  const updated = { ...me, pin, pinChangedAt: new Date().toISOString() };
  set((st) => logStaff({ ...st, staff: st.staff.map((s) => (s.id === id ? updated : s)) }, id, id, 'pin_changed'));
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
