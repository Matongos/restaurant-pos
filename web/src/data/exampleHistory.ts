import type { MenuItem, Order } from '../domain/types';
import { round2 } from '../domain/money';

/**
 * 30 days of EXAMPLE orders so the reports and graphs show something on day one.
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

export function exampleHistory(menu: MenuItem[], days = 30, now = new Date()): Order[] {
  const rand = rng(20261020);
  const meals = menu.filter((m) => m.categoryId === 'meals');
  const breakfast = menu.filter((m) => m.categoryId === 'breakfast');
  const drinks = menu.filter((m) => m.isDrink);
  const cashiers = ['u-cashier', 'u-manager'];
  const out: Order[] = [];
  let seq = 0;

  for (let d = days; d >= 1; d--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const factor = DAY_FACTOR[day.getDay()];
    let card = 1;
    for (const [hStr, w] of Object.entries(HOUR_WEIGHT)) {
      const hour = Number(hStr);
      const count = Math.round(w * factor * (0.75 + rand() * 0.5));
      for (let k = 0; k < count; k++) {
        const placed = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, Math.floor(rand() * 60), Math.floor(rand() * 60));
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
