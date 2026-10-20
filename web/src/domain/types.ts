/**
 * Core domain model.
 *
 * Design rules (see the system specification):
 * - Order types, currencies, payment methods and roles are data, not code.
 * - Every order keeps a status history with timestamps, so kitchen-time
 *   reports work even before a kitchen display exists.
 * - Every record carries a branchId so multi-branch can be switched on later.
 * - All money is stored in the BASE currency (minor units avoided: we round to cents).
 */

export type ID = string;

export type Role = 'super_admin' | 'manager' | 'cashier' | 'kitchen' | 'attendant';

export interface Staff {
  id: ID;
  name: string;
  pin: string;
  role: Role;
  active: boolean;
}

export interface Currency {
  code: string; // e.g. USD, ZiG, ZAR
  name: string;
  symbol: string;
  /** How many units of this currency equal 1 unit of the base currency. */
  rate: number;
  enabled: boolean;
  /** Quick-cash buttons shown at the till for this currency. */
  quickCash: number[];
}

export interface PaymentMethod {
  id: ID;
  name: string; // Cash, EcoCash, InnBucks, Swipe ...
  isCash: boolean;
  requiresReference: boolean;
  enabled: boolean;
}

export interface OrderType {
  id: ID; // 'eat_in' | 'take_away' | 'delivery' ... but kept open
  name: string; // shown at the till
  ticketLabel: string; // big label printed on the kitchen ticket
  packaging: string; // e.g. "Bronze plate", "Plastic container"
  enabled: boolean;
}

export interface Category {
  id: ID;
  name: string;
  color: string;
  sort: number;
}

/** A part a meal is made of (Beef, Rice, Sadza). Switching one off hides every meal that uses it. */
export interface Component {
  id: ID;
  name: string;
  available: boolean;
  changedAt?: string;
  changedBy?: ID;
}

export interface MenuItem {
  id: ID;
  name: string;
  categoryId: ID;
  /** Price in base currency. */
  price: number;
  /** Data URL of the uploaded photo (compressed). */
  photo?: string;
  /** Fallback picture when there is no photo yet. */
  emoji: string;
  componentIds: ID[];
  available: boolean;
  isDrink: boolean;
  favourite: boolean;
  sort: number;
}

export interface OrderLine {
  id: ID;
  itemId: ID;
  name: string;
  qty: number;
  unitPrice: number;
  note?: string;
}

export interface Payment {
  methodId: ID;
  currency: string;
  /** Amount tendered in that currency. */
  amount: number;
  /** Same amount converted to base currency. */
  baseAmount: number;
  reference?: string;
}

export type OrderStatus = 'in_kitchen' | 'ready' | 'served' | 'cancelled';

export interface StatusEvent {
  status: OrderStatus | 'placed';
  at: string;
  by?: ID;
}

export type NumberMode = 'card' | 'slip' | 'both';

export interface Order {
  id: ID;
  branchId: ID;
  tillId: ID;
  /** The number on the physical card and/or the printed slip. */
  number: number;
  numberMode: NumberMode;
  orderTypeId: ID;
  lines: OrderLine[];
  total: number;
  payments: Payment[];
  /** Change handed back, in base currency. */
  changeGiven: number;
  changeCurrency: string;
  /** Customer the order is linked to (when they used or left change). */
  customerId?: ID;
  status: OrderStatus;
  history: StatusEvent[];
  cashierId: ID;
  createdAt: string;
  /** Set when this is a drink/extra added to an existing order number. */
  parentOrderId?: ID;
  training: boolean;
}

/**
 * A regular customer. Change left with the restaurant is kept as a running
 * balance on the customer, so it can be collected or spent on food any day.
 */
export interface Customer {
  id: ID;
  branchId: ID;
  name: string;
  phone?: string;
  /** Helps tell people with the same name apart: "Mbare", "nurse", "red cap". */
  note?: string;
  createdAt: string;
  lastSeenAt: string;
}

export type CreditKind = 'change_left' | 'used_for_food' | 'paid_out';

/**
 * One movement on a customer's change balance (base currency).
 * change_left is positive; used_for_food and paid_out are negative.
 * Balance = sum of amounts. No entry is ever edited, so the history is a full audit trail.
 */
export interface CreditEntry {
  id: ID;
  branchId: ID;
  customerId: ID;
  kind: CreditKind;
  amount: number;
  /** Voucher code printed when change is left. */
  code?: string;
  /** Currency the customer expects the change in (informational). */
  currency?: string;
  orderId?: ID;
  orderNumber?: number;
  at: string;
  by: ID;
}

/** Payment method id used when a customer pays with their change balance. */
export const CREDIT_METHOD = 'change_credit';

export interface Settings {
  branchId: ID;
  restaurantName: string;
  tagline: string;
  logo?: string;
  brandColor: string;
  address: string;
  phone: string;
  receiptFooter: string;
  baseCurrency: string;
  numberMode: NumberMode;
  cardFrom: number;
  cardTo: number;
  /** Slip numbers restart each day from 1. */
  slipResetDaily: boolean;
  autoPrintKitchen: boolean;
  /** Order card turns amber after this many minutes. */
  warnAfterMinutes: number;
  /** Order counts as late after this many minutes (default 5). */
  lateAfterMinutes: number;
  trainingMode: boolean;
}

/** What the customer display shows while the cashier is entering an order. */
export interface LiveCart {
  tillId: ID;
  orderTypeId: ID;
  lines: OrderLine[];
  total: number;
  paid?: number;
  change?: number;
  changeCurrency?: string;
  /** Change kept for the customer on their balance. */
  kept?: number;
  customerName?: string;
  message?: string;
  updatedAt: string;
}

export interface DayCounter {
  date: string; // YYYY-MM-DD
  lastSlip: number;
}

export interface AppState {
  version: number;
  settings: Settings;
  staff: Staff[];
  currencies: Currency[];
  paymentMethods: PaymentMethod[];
  orderTypes: OrderType[];
  categories: Category[];
  components: Component[];
  menu: MenuItem[];
  orders: Order[];
  customers: Customer[];
  credit: CreditEntry[];
  liveCarts: Record<ID, LiveCart>;
  dayCounter: DayCounter;
}
