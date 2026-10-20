import type { AppState } from '../domain/types';
import { todayISO } from '../domain/rules';

/**
 * Demo data so the prototype can be clicked through immediately.
 * Exchange rates are EXAMPLES only — the manager sets real rates in Settings.
 */
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

export const DEFAULT_MEAL_PERIODS = [
  { id: 'breakfast', name: 'Breakfast', from: 6, to: 11 },
  { id: 'lunch', name: 'Lunch', from: 11, to: 16 },
  { id: 'supper', name: 'Supper', from: 16, to: 22 },
];

/** Fresh demo state. Example history is added by the store at load time (never saved). */
export function seedState(): AppState {
  return baseState();
}

function baseState(): AppState {
  const comp = (id: string, name: string) => ({ id, name, available: true });
  const item = (
    id: string,
    name: string,
    categoryId: string,
    price: number,
    emoji: string,
    componentIds: string[],
    extra: Partial<{ isDrink: boolean; favourite: boolean }> = {},
  ) => ({
    id,
    name,
    categoryId,
    price,
    emoji,
    componentIds,
    available: true,
    isDrink: extra.isDrink ?? false,
    favourite: extra.favourite ?? false,
    sort: 0,
  });

  return {
    version: 4,
    settings: {
      branchId: 'main',
      restaurantName: 'Training Restaurant',
      tagline: 'Good food, fast',
      brandColor: '#1f6f43',
      address: '1 Example Street, Harare',
      phone: '+263 77 000 0000',
      receiptFooter: 'Thank you! Keep your card until your food arrives.',
      baseCurrency: 'USD',
      numberMode: 'card',
      cardFrom: 1,
      cardTo: 60,
      slipResetDaily: true,
      autoPrintKitchen: false,
      warnAfterMinutes: 3,
      lateAfterMinutes: 5,
      trainingMode: true,
      showExampleHistory: true,
      mealPeriods: DEFAULT_MEAL_PERIODS,
      customersPerStaffHour: 12,
    },
    staff: [
      { id: 'u-owner', name: 'Owner', pin: '1234', role: 'super_admin', active: true },
      { id: 'u-manager', name: 'Tendai (Manager)', pin: '2222', role: 'manager', active: true },
      { id: 'u-cashier', name: 'Rudo (Cashier)', pin: '1111', role: 'cashier', active: true },
      { id: 'u-kitchen', name: 'Kitchen', pin: '3333', role: 'kitchen', active: true },
      { id: 'u-attendant', name: 'Tafara (Attendant)', pin: '4444', role: 'attendant', active: true },
    ],
    currencies: [
      { code: 'USD', name: 'US Dollar', symbol: '$', rate: 1, enabled: true, quickCash: [1, 2, 5, 10, 20] },
      { code: 'ZiG', name: 'Zimbabwe Gold', symbol: 'ZiG', rate: 27, enabled: true, quickCash: [20, 50, 100, 200] },
      { code: 'ZAR', name: 'SA Rand', symbol: 'R', rate: 18, enabled: true, quickCash: [10, 20, 50, 100] },
    ],
    paymentMethods: [
      { id: 'cash', name: 'Cash', isCash: true, requiresReference: false, enabled: true },
      { id: 'ecocash', name: 'EcoCash', isCash: false, requiresReference: true, enabled: true },
      { id: 'innbucks', name: 'InnBucks', isCash: false, requiresReference: true, enabled: true },
      { id: 'swipe', name: 'Swipe', isCash: false, requiresReference: false, enabled: true },
    ],
    orderTypes: [
      { id: 'eat_in', name: 'Eat In', ticketLabel: 'EAT IN', packaging: 'Bronze plate', enabled: true },
      { id: 'take_away', name: 'Take Away', ticketLabel: 'TAKE AWAY', packaging: 'Plastic container', enabled: true },
      { id: 'delivery', name: 'Delivery', ticketLabel: 'DELIVERY', packaging: 'Plastic container + bag', enabled: false },
    ],
    categories: [
      { id: 'meals', name: 'Meals', color: '#c2410c', sort: 1 },
      { id: 'breakfast', name: 'Breakfast', color: '#ca8a04', sort: 2 },
      { id: 'sides', name: 'Sides', color: '#15803d', sort: 3 },
      { id: 'drinks', name: 'Drinks', color: '#0369a1', sort: 4 },
    ],
    components: [
      comp('sadza', 'Sadza'),
      comp('rice', 'Rice'),
      comp('chips', 'Chips'),
      comp('beef', 'Beef'),
      comp('chicken', 'Chicken'),
      comp('oxtail', 'Oxtail'),
      comp('fish', 'Fish'),
      comp('beans', 'Beans'),
      comp('greens', 'Greens (covo)'),
      comp('eggs', 'Eggs'),
      comp('bread', 'Bread'),
    ],
    menu: [
      item('m-sadza-beef', 'Sadza & Beef', 'meals', 4, '🥩', ['sadza', 'beef', 'greens'], { favourite: true }),
      item('m-sadza-chicken', 'Sadza & Chicken', 'meals', 4, '🍗', ['sadza', 'chicken', 'greens'], { favourite: true }),
      item('m-rice-beef', 'Rice & Beef', 'meals', 4, '🍛', ['rice', 'beef'], { favourite: true }),
      item('m-rice-chicken', 'Rice & Chicken', 'meals', 4, '🍚', ['rice', 'chicken'], { favourite: true }),
      item('m-sadza-oxtail', 'Sadza & Oxtail', 'meals', 6, '🍲', ['sadza', 'oxtail', 'greens']),
      item('m-sadza-fish', 'Sadza & Fish', 'meals', 5, '🐟', ['sadza', 'fish', 'greens']),
      item('m-chips-chicken', 'Chips & Chicken', 'meals', 4.5, '🍟', ['chips', 'chicken'], { favourite: true }),
      item('m-sadza-beans', 'Sadza & Beans', 'meals', 3, '🫘', ['sadza', 'beans', 'greens']),
      item('b-full', 'Eggs, Sausage & Bread', 'breakfast', 3, '🍳', ['eggs', 'bread']),
      item('b-tea-bread', 'Tea & Bread', 'breakfast', 1, '🥖', ['bread']),
      item('s-sadza', 'Extra Sadza', 'sides', 0.5, '⚪', ['sadza']),
      item('s-rice', 'Extra Rice', 'sides', 0.5, '🍚', ['rice']),
      item('s-chips', 'Chips', 'sides', 1.5, '🍟', ['chips']),
      item('s-slaw', 'Coleslaw', 'sides', 0.5, '🥗', []),
      item('d-water', 'Water 500ml', 'drinks', 1, '💧', [], { isDrink: true, favourite: true }),
      item('d-soda', 'Soft Drink 500ml', 'drinks', 1, '🥤', [], { isDrink: true, favourite: true }),
      item('d-mazoe', 'Mazoe (glass)', 'drinks', 0.5, '🧃', [], { isDrink: true }),
      item('d-maheu', 'Maheu', 'drinks', 1, '🥛', [], { isDrink: true }),
      item('d-tea', 'Tea', 'drinks', 0.5, '☕', [], { isDrink: true }),
    ],
    orders: [],
    // Example customers (to show how same names are told apart). Remove with Settings → Demo data.
    customers: [
      { id: 'cu-anashe-1', branchId: 'main', name: 'Anashe Moyo', phone: '0772 111 222', note: 'Mbare', createdAt: daysAgo(3), lastSeenAt: daysAgo(1) },
      { id: 'cu-anashe-2', branchId: 'main', name: 'Anashe', note: 'Works at the bank', createdAt: daysAgo(10), lastSeenAt: daysAgo(10) },
      { id: 'cu-tendai', branchId: 'main', name: 'Tendai Ncube', phone: '0713 555 010', createdAt: daysAgo(2), lastSeenAt: daysAgo(2) },
    ],
    credit: [
      { id: 'cr-1', branchId: 'main', customerId: 'cu-anashe-1', kind: 'change_left', amount: 1, code: 'K7QX2', currency: 'USD', orderNumber: 12, at: daysAgo(1), by: 'u-cashier' },
      { id: 'cr-2', branchId: 'main', customerId: 'cu-tendai', kind: 'change_left', amount: 6, code: 'P3MZA', currency: 'USD', orderNumber: 4, at: daysAgo(2), by: 'u-cashier' },
    ],
    liveCarts: {},
    dayCounter: { date: todayISO(), lastSlip: 0 },
  };
}
