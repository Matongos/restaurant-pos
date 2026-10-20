import type { Cancellation, Expense, MenuItem, Order, Purchase, StockItem } from '../domain/types';
import { round2 } from '../domain/money';

/**
 * 120 days of EXAMPLE orders so the reports and graphs show something on day one.
 * Every example order is marked `training` and `example`, so it is kept out of
 * real reports (untick "Include training orders") and can be removed in
 * Settings → Demo data. Nothing here is real restaurant data.
 */

// Simple repeatable random numbers, so the example looks the same every time.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Customers per hour on a normal weekday: breakfast, lunch and supper rushes.
const HOUR_WEIGHT: Record<number, number> = {
  6: 1, 7: 4, 8: 5, 9: 3, 10: 2, 11: 3, 12: 8, 13: 9, 14: 5, 15: 2, 16: 3, 17: 5, 18: 6, 19: 4, 20: 2,
};
// Sunday quieter, Friday and Saturday busier.
const DAY_FACTOR = [0.7, 1, 0.95, 1, 1.05, 1.25, 1.35];

export function exampleHistory(menu: MenuItem[], days = 120, now = new Date()): Order[] {
  const rand = rng(20261020);
  const meals = menu.filter((m) => m.categoryId === 'meals');
  const breakfast = menu.filter((m) => m.categoryId === 'breakfast');
  const drinks = menu.filter((m) => m.isDrink);
  const cashiers = ['u-cashier', 'u-manager'];
  const out: Order[] = [];
  let seq = 0;

  // Includes today up to 15 minutes ago, so "Today" can be compared with yesterday.
  const cutoff = now.getTime() - 15 * 60000;
  for (let d = days; d >= 0; d--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const factor = DAY_FACTOR[day.getDay()];
    let card = 1;
    for (const [hStr, w] of Object.entries(HOUR_WEIGHT)) {
      const hour = Number(hStr);
      const count = Math.round(w * factor * (0.75 + rand() * 0.5));
      for (let k = 0; k < count; k++) {
        const placed = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, Math.floor(rand() * 60), Math.floor(rand() * 60));
        if (placed.getTime() > cutoff) continue;
        const morning = hour < 10;
        const pool = morning && breakfast.length ? breakfast : meals;
        const main = pool[Math.floor(rand() * pool.length)];
        const lines = [{ id: `ex-l${seq}-1`, itemId: main.id, name: main.name, qty: rand() < 0.12 ? 2 : 1, unitPrice: main.price }];
        if (rand() < 0.45 && drinks.length) {
          const dr = drinks[Math.floor(rand() * drinks.length)];
          lines.push({ id: `ex-l${seq}-2`, itemId: dr.id, name: dr.name, qty: 1, unitPrice: dr.price });
        }
        const total = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
        const takeAway = rand() < (morning ? 0.6 : 0.38);
        // Rush hours are slower in the kitchen.
        const rush = w >= 8 ? 2 : w >= 5 ? 0.8 : 0;
        const kitchenMin = 1.5 + rand() * 2.2 + rush * rand();
        const handMin = 0.3 + rand() * 1.1;
        const ready = new Date(placed.getTime() + kitchenMin * 60000);
        const served = new Date(ready.getTime() + handMin * 60000);
        const ecocash = rand() < 0.2;
        const paid = ecocash ? total : rand() < 0.75 ? Math.ceil(total) + (rand() < 0.3 ? 5 : 0) : total;
        const cashierId = cashiers[rand() < 0.8 ? 0 : 1];
        out.push({
          id: `ex-o${seq++}`,
          branchId: 'main',
          tillId: 'till-1',
          number: card,
          numberMode: 'card',
          orderTypeId: takeAway ? 'take_away' : 'eat_in',
          lines,
          total,
          payments: [
            ecocash
              ? { methodId: 'ecocash', currency: 'USD', amount: total, baseAmount: total, reference: 'EXAMPLE' }
              : { methodId: 'cash', currency: 'USD', amount: paid, baseAmount: paid },
          ],
          changeGiven: round2(Math.max(0, paid - total)),
          changeCurrency: 'USD',
          status: 'served',
          history: [
            { status: 'placed', at: placed.toISOString(), by: cashierId },
            { status: 'in_kitchen', at: placed.toISOString(), by: cashierId },
            { status: 'ready', at: ready.toISOString(), by: 'u-kitchen' },
            { status: 'served', at: served.toISOString(), by: 'u-attendant' },
          ],
          cashierId,
          createdAt: placed.toISOString(),
          training: true,
          example: true,
        });
        card = card >= 60 ? 1 : card + 1;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ accounting examples */


const REASONS = ['Customer changed their mind', 'Wrong item entered', 'Meal ran out', 'Entered twice'];

/** About 1 in 70 example sales was cancelled (with a refund), so the cancellation log has history. */
export function exampleCancellations(orders: Order[]): { orders: Order[]; cancellations: Cancellation[] } {
  const rand = rng(777);
  const cancellations: Cancellation[] = [];
  const out = orders.map((o) => {
    if (!o.example || rand() > 0.014) return o;
    const placed = Date.parse(o.createdAt);
    const c: Cancellation = {
      id: `ex-c${cancellations.length}`,
      branchId: o.branchId,
      orderId: o.id,
      orderNumber: o.number,
      orderTotal: o.total,
      reason: REASONS[Math.floor(rand() * REASONS.length)],
      refund: 'cash',
      refundAmount: o.total,
      requestedBy: o.cashierId,
      approvedBy: 'u-manager',
      at: new Date(placed + 2 * 60000).toISOString(),
      example: true,
    };
    cancellations.push(c);
    return {
      ...o,
      status: 'cancelled' as const,
      cancellationId: c.id,
      history: [o.history[0], o.history[1], { status: 'cancelled' as const, at: c.at, by: 'u-manager' }],
    };
  });
  return { orders: out, cancellations };
}

/**
 * Example purchases (twice a week) and running costs, sized like a small busy restaurant:
 * food and drink about 35–40% of sales, wages weekly, rent and electricity monthly.
 */
export function exampleBooks(stock: StockItem[], days = 120, now = new Date()): { purchases: Purchase[]; expenses: Expense[] } {
  const rand = rng(4242);
  const byId = new Map(stock.map((s) => [s.id, s]));
  const purchases: Purchase[] = [];
  const expenses: Expense[] = [];
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const buy = (id: string, qty: number) => {
    const s = byId.get(id)!;
    const unitCost = Math.round((s.lastUnitCost ?? 1) * (0.92 + rand() * 0.16) * 100) / 100;
    return { stockItemId: id, name: s.name, qty, unit: s.unit, unitCost };
  };
  const add = (d: Date, supplier: string, lines: ReturnType<typeof buy>[], paidFrom: Purchase['paidFrom']) => {
    const total = Math.round(lines.reduce((t, l) => t + l.qty * l.unitCost, 0) * 100) / 100;
    purchases.push({
      id: `ex-p${purchases.length}`, branchId: 'main', date: iso(d), supplier, lines, currency: 'USD', total, baseTotal: total,
      paidFrom, at: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6, 30).toISOString(), by: 'u-manager', example: true,
    });
  };
  const spend = (d: Date, category: string, description: string, amount: number, paidFrom: Expense['paidFrom']) =>
    expenses.push({
      id: `ex-e${expenses.length}`, branchId: 'main', date: iso(d), category, description, currency: 'USD', amount, baseAmount: amount,
      paidFrom, at: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17).toISOString(), by: 'u-manager', example: true,
    });

  for (let k = days; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - k);
    if (d.getTime() > now.getTime()) continue;
    const wd = d.getDay();
    if (wd === 1 || wd === 4) {
      const q = (n: number) => Math.max(1, Math.round(n * (0.85 + rand() * 0.3)));
      add(d, 'Mbare Musika', [buy('st-veg', 1), buy('st-potato', q(3)), buy('st-beans', q(3))], 'cash_drawer');
      add(d, 'Butchery', [buy('st-beef', q(15)), buy('st-chicken', q(18)), buy('st-oxtail', q(3)), buy('st-fish', q(4))], 'cash_drawer');
      add(d, 'Wholesaler', [buy('st-mealie', q(4)), buy('st-rice', q(2)), buy('st-oil', q(3)), buy('st-eggs', q(2)), buy('st-bread', q(8))], 'bank');
      add(d, 'Drinks depot', [buy('st-soda', q(2)), buy('st-water', q(2)), buy('st-maheu', 1), buy('st-mazoe', 1)], 'cash_drawer');
      if (wd === 1) add(d, 'Packaging shop', [buy('st-containers', q(4))], 'cash_drawer');
    }
    if (wd === 5) spend(d, 'Wages', 'Weekly wages (4 staff)', 360, 'cash_drawer');
    if (wd === 2 || wd === 5) spend(d, 'Gas', 'LP gas refill', 38, 'cash_drawer');
    if (wd === 3) spend(d, 'Transport', 'Market transport', 15, 'cash_drawer');
    if (d.getDate() === 1) {
      spend(d, 'Rent', 'Monthly rent', 650, 'bank');
      spend(d, 'Electricity', 'ZESA tokens', 110, 'mobile_money');
    }
    if (d.getDate() === 15) spend(d, 'Repairs', 'Stove and plumbing', Math.round(30 + rand() * 60), 'cash_drawer');
  }
  return { purchases, expenses };
}
