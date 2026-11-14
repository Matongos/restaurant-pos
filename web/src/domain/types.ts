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
  /** false = suspended: cannot log in until reactivated. */
  active: boolean;
  phone?: string;
  createdAt?: string;
  pinChangedAt?: string;
  /**
   * Removed staff are never erased: past sales, cancellations and purchases still
   * show their name. They disappear from the staff list and can never log in.
   */
  deletedAt?: string;
}

export type StaffAction = 'added' | 'edited' | 'pin_changed' | 'suspended' | 'reactivated' | 'deleted';

/** Who changed which staff account, and when. Append-only. */
export interface StaffEvent {
  id: ID;
  at: string;
  by: ID;
  staffId: ID;
  action: StaffAction;
  detail?: string;
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
  /** Hidden categories get no button on the till; their meals still show in search and Favourites. */
  hidden?: boolean;
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
  /**
   * The parts of componentIds the meal "comes with" that a customer may say no to (e.g. coslo, covo).
   * If one of these runs out the meal stays on sale; the order is marked "no coslo" instead.
   */
  optionalIds?: ID[];
  available: boolean;
  isDrink: boolean;
  favourite: boolean;
  sort: number;
  /** What one portion costs to make (base currency), for profit per meal. Optional. */
  costPerPlate?: number;
  /** Add-ons the customer can ask for with this meal (extra meat +$1.50, extra gravy free ...). */
  addOnIds?: ID[];
  /** Stock one plate uses (0.2 kg beef, 0.18 kg mealie meal). Taken off stock with every sale. */
  recipe?: RecipeLine[];
}

/**
 * Something added to a meal on request, priced per plate (0 = free), e.g. Extra meat +$1.50, Extra gravy.
 * Kept in one list so a price changes everywhere at once; each meal says which ones it offers.
 */
export interface AddOn {
  id: ID;
  name: string;
  /** Price per plate in base currency. 0 = free. */
  price: number;
  /** What it costs to make (base currency), for profit per meal. Optional. */
  cost?: number;
  /** Switched off on the Sold out screen when it runs out. */
  available: boolean;
  sort: number;
  /** Stock one portion uses (extra meat: 0.1 kg beef). */
  recipe?: RecipeLine[];
}

/** An add-on as it was sold: name and price are copied, so later menu changes don't rewrite old sales. */
export interface LineExtra {
  id: ID;
  name: string;
  price: number;
  cost?: number;
}

export interface OrderLine {
  id: ID;
  itemId: ID;
  name: string;
  qty: number;
  unitPrice: number;
  note?: string;
  /** "Comes with" parts left out, by name, e.g. ["Coslo"]. Printed as NO COSLO on the kitchen ticket. */
  without?: string[];
  /**
   * Add-ons on every plate of this line, e.g. [Extra meat]. Printed as + EXTRA MEAT.
   * unitPrice already includes them (meal price + add-ons), so every total stays a simple qty × unitPrice.
   */
  extras?: LineExtra[];
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
  /** 'out_for_delivery' is logged when a rider leaves with a delivery order (its status stays open until delivered). */
  status: OrderStatus | 'placed' | 'out_for_delivery';
  at: string;
  by?: ID;
  /** Set when the system closed the order (its card was handed out again). */
  auto?: boolean;
}

export type NumberMode = 'card' | 'slip' | 'both';

export interface Order {
  id: ID;
  branchId: ID;
  tillId: ID;
  /** Which till numbered this sale (1, 2, 3…). Each till gives out its own slip numbers: till 2 from 501, till 3 from 1001. */
  tillNo?: number;
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
  /** Generated example history (demo only). */
  example?: boolean;
  /** Set when the sale was cancelled. The order itself is never deleted. */
  cancellationId?: ID;
  /** Delivery orders only: where it goes and the fee (already included in total). */
  delivery?: DeliveryInfo;
  /** Stock this order used, worked out when it was sold (count units by stock item). */
  stockUsed?: Record<ID, number>;
  /**
   * Table service: this order is one round sent to the kitchen for a table. Round 1 holds the bill
   * (tab); later rounds point to it with parentOrderId. Money paid for the table is kept on round 1.
   */
  table?: TableInfo;
  /** Ordered by the customer on the restaurant's web page / QR menu, paid at the counter. Kept on round 1 (a bill like a table's). */
  online?: OnlineOrderInfo;
}

export interface OnlineOrderInfo {
  /** The online order's id in the online account. */
  id: string;
  number: number;
  name: string;
  phone: string;
  mode: 'pickup' | 'delivery' | 'table';
  table?: string;
  readyMinutes?: number;
  /** Delivery: where to, the fee (part of the total), and when the rider left. */
  address?: string;
  deliveryFee?: number;
  outAt?: string;
  rider?: string;
}

/** A dining table set up in Settings → How you serve. */
export interface DiningTable {
  id: ID;
  name: string; // "T4", "Veranda 2"
  area?: string;
  seats?: number;
}

export type ServiceMode = 'counter' | 'tables' | 'both';

/** One person's (or one group's) part of a table bill, once paid. */
export interface TabShare {
  id: ID;
  label: string; // "Person 2", "Tendai"
  amount: number; // base currency, what this share settled
  at: string;
  by: ID;
}

export interface TableInfo {
  tableId: ID;
  name: string;
  round: number;
  /** The rest is only on round 1 (the bill). */
  guests?: number;
  waiterId?: ID;
  status?: 'open' | 'billed' | 'paid';
  billedAt?: string;
  paidAt?: string;
  /** Service charge added to the bill (base currency), included in round 1's total. */
  serviceCharge?: number;
  shares?: TabShare[];
  /** How the bill is being split, so a half-paid split survives closing the screen. */
  split?: { mode: 'one' | 'equal' | 'item' | 'amount'; people: number; names?: string[]; assign?: Record<string, number> };
}

/** Where a delivery goes. The fee is in base currency and is part of the order total. */
export interface DeliveryInfo {
  name: string;
  phone: string;
  /** Street, house number, landmarks: whatever the rider needs. */
  address: string;
  /** The delivery area chosen (sets the fee), e.g. "Town centre". */
  areaId?: ID;
  areaName?: string;
  fee: number;
  /** For the rider, e.g. "Call at the gate". */
  note?: string;
  /** Set when the rider leaves with it. */
  outAt?: string;
  outBy?: ID;
  rider?: string;
}

/** A delivery area and its fee, set by the owner (Settings → Delivery). */
export interface DeliveryArea {
  id: ID;
  name: string;
  fee: number;
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

export type CreditKind = 'change_left' | 'used_for_food' | 'paid_out' | 'cancel_adjust' | 'refund';

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

export type PrintWhen = 'on_pay' | 'on_next' | 'button';

export interface Settings {
  branchId: ID;
  /** Show the Favourites button on the till (default on). */
  showFavourites?: boolean;
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
  /** @deprecated replaced by printWhen; kept so older saved data still loads. */
  autoPrintKitchen?: boolean;
  /**
   * When tickets print after a payment (default 'on_pay'):
   * on_pay = straight away; on_next = when the cashier presses "Print & next customer";
   * button = only when someone presses Print.
   */
  printWhen?: PrintWhen;
  /** Print a kitchen ticket (default on). Off = the kitchen works from the kitchen screen only. */
  printKitchenTicket?: boolean;
  /** Print a change slip when a customer leaves change (default on). */
  printChangeSlip?: boolean;
  /** Go back to Sell by itself this many seconds after an order (0 = wait for the cashier). */
  autoNextSeconds?: number;
  /** Order card turns amber after this many minutes. */
  warnAfterMinutes: number;
  /** Order counts as late after this many minutes (default 5). */
  lateAfterMinutes: number;
  trainingMode: boolean;
  /** Show generated example history (demo). It is never saved. */
  showExampleHistory: boolean;
  /** Named parts of the day used by analytics, e.g. Breakfast 6–10. `to` is the hour it ends (exclusive). */
  mealPeriods: MealPeriod[];
  /** How many customers one server can handle in an hour (for staffing advice). */
  customersPerStaffHour: number;
  /** Delivery areas with their fee. The cashier can still type a different fee for an address. */
  deliveryAreas?: DeliveryArea[];
  /** Delivery for online orders (web page / QR menu): a flat fee and where you deliver. */
  onlineDelivery?: { on: boolean; fee: number; area?: string };
  /** Counter (pay first, the default), tables (pay at the end) or both. */
  serviceMode?: ServiceMode;
  tables?: DiningTable[];
  /** Ask how many guests when a table is opened. Default on. */
  askGuests?: boolean;
  /** Service charge on table bills, percent (0 = none). */
  serviceChargePct?: number;
}

export interface MealPeriod {
  id: ID;
  name: string;
  from: number;
  to: number;
}

/** What the customer display shows while the cashier is entering an order. */
export interface LiveCart {
  tillId: ID;
  orderTypeId: ID;
  lines: OrderLine[];
  /** Includes the delivery fee, if any. */
  total: number;
  deliveryFee?: number;
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

/* ------------------------------------------------------------------ accounting
 * Every record below is permanent. A mistake is corrected with a reversing record
 * (reversesId), never by editing or deleting, so the books always add up.
 */

export type PaidFrom = 'cash_drawer' | 'bank' | 'mobile_money' | 'owner';

export interface StockItem {
  id: ID;
  name: string;
  /** How it is bought, e.g. "10 kg bag", "crate of 24", "kg". */
  unit: string; // kg, bag, crate, litre, each
  /** Cost of one `unit` (base currency), from the last purchase. */
  lastUnitCost?: number;
  /** Count it and take it off with every sale. */
  track?: boolean;
  /** What it is counted in, e.g. "kg", "bottle", "egg". Defaults to `unit`. */
  countUnit?: string;
  /** How many count units one purchase unit holds: a "10 kg bag" holds 10 kg. Default 1. */
  perPack?: number;
  /** Warn when the amount left drops to this (count units). */
  lowAt?: number;
  /** When none is left, hide the meals that need it from the till. */
  hideWhenOut?: boolean;
  /** Packaging: used once for every Take Away or Delivery plate (e.g. containers). */
  perPackedPlate?: number;
}

/** How much of a stock item one plate (or one add-on) uses, in the item's count unit. */
export interface RecipeLine {
  stockItemId: ID;
  qty: number;
}

/**
 * A stock movement other than a sale or purchase. Never edited or deleted:
 * a count sets the amount (what was really there); waste takes some off.
 */
export interface StockMove {
  id: ID;
  stockItemId: ID;
  kind: 'count' | 'waste';
  /** count: the amount counted. waste: the amount thrown away (positive). Count units. */
  qty: number;
  /** count: what the system expected just before, so the difference can be shown. */
  expected?: number;
  reason?: string;
  at: string;
  by: ID;
}

export interface PurchaseLine {
  stockItemId: ID;
  name: string;
  qty: number;
  unit: string;
  /** Cost per unit in the purchase currency. */
  unitCost: number;
  /** What this adds to stock, in the item's count unit (e.g. 2 bags × 10 kg = 20). */
  stockQty?: number;
}

export interface Purchase {
  id: ID;
  branchId: ID;
  date: string; // YYYY-MM-DD the goods were bought
  supplier: string;
  lines: PurchaseLine[];
  currency: string;
  total: number; // in purchase currency
  baseTotal: number; // in base currency
  paidFrom: PaidFrom;
  note?: string;
  at: string; // when recorded
  by: ID;
  /** This record cancels another one (amounts are negative). */
  reversesId?: ID;
  reason?: string;
  example?: boolean;
}

export interface Expense {
  id: ID;
  branchId: ID;
  date: string;
  category: string; // Wages, Rent, Electricity, Gas, Transport, Repairs, Other
  description: string;
  currency: string;
  amount: number;
  baseAmount: number;
  paidFrom: PaidFrom;
  at: string;
  by: ID;
  reversesId?: ID;
  reason?: string;
  example?: boolean;
}

export type RefundMethod = 'cash' | 'to_change' | 'none';

/** A cancelled sale. The order stays on record; this explains what happened and who approved it. */
export interface Cancellation {
  id: ID;
  branchId: ID;
  orderId: ID;
  orderNumber: number;
  orderTotal: number;
  reason: string;
  refund: RefundMethod;
  /** Money handed back (base currency). */
  refundAmount: number;
  requestedBy: ID;
  approvedBy: ID;
  at: string;
  example?: boolean;
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
  addOns: AddOn[];
  orders: Order[];
  customers: Customer[];
  credit: CreditEntry[];
  stockItems: StockItem[];
  stockMoves: StockMove[];
  purchases: Purchase[];
  expenses: Expense[];
  cancellations: Cancellation[];
  staffLog: StaffEvent[];
  liveCarts: Record<ID, LiveCart>;
  dayCounter: DayCounter;
}
