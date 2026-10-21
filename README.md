# Restaurant POS

Point-of-sale system for a pay-first, counter-service restaurant: the customer pays, the cashier enters the order, the kitchen gets a ticket, and the food is brought to the customer by order number (physical card or printed slip).

- **System specification:** https://claude.ai/code/artifact/a61d0239-cf91-4792-b386-4d5b34de9561
- **Status:** clickable prototype (v0.1). Data is kept in the browser; the local server comes next.

## What the prototype does

| Screen | Who | What |
| --- | --- | --- |
| Login | Everyone | 4-digit PIN; each role sees only its screens |
| Sell | Cashier | Photo tiles (sold-out meals hidden), Eat In / Take Away, notes, total in every currency. On phones the order stays docked under the meals, so every tap is visible; categories wrap so all show, search is one tap |
| Payment | Cashier | Type the amount received and see at once: **SHORT**, **NO CHANGE** or **GIVE CHANGE**. Cash / EcoCash / InnBucks / Swipe / **Their change**, any currency, split payments. Keeping change and the customer's name happen in the change panel. The confirm button says what is missing |
| Order sent | Cashier | Big number to hand over and what printed. **Printing is a setting** (manager or owner): print straight away on payment (default), one "Print & next customer" button, or only when Print is pressed; kitchen ticket and change slip can each be switched off; optional auto return to Sell after 3/5/10 s (any touch stops it) |
| Customer Display | Second monitor | Items as they are entered, total, paid, change, logo when idle |
| Active Orders | Cashier, attendant | Clock per order ticking every second, amber then red **LATE** (default 5 min, set in Settings), mark served (card is freed), **add a drink to an existing number**, reprint |
| Kitchen Display | Kitchen | Live clocks, late warning, tick done, recall |
| Today's Menu | Kitchen, manager | Switch an ingredient (e.g. Beef) sold out and every meal with it disappears from the till. A side the meal only *comes with* (coslo, covo) doesn't hide the meal: orders are marked "no coslo" instead |
| Comes with | Cashier | Meals list what they come with (Rice & Beef: coslo). One tap on the order line turns **Coslo** into **No coslo** (with several plates on the line it asks *how many?* and splits the line, e.g. 4 × with greens + 1 × no greens), printed bold on the kitchen ticket and kitchen screen. Set per meal in Menu: each ingredient is *not used*, *main part* or *comes with*; new ingredients can be added there |
| Collect change | Cashier | Button on the till: find the customer by name, phone, note or slip code and hand over their change in two taps |
| Customer Change | Cashier, manager | One running change balance per customer: kept, used for food, paid out — with full history. Name suggestions while typing; customers with the same name are told apart by phone or a note |
| Menu & categories | Manager, owner | Change meal photos (camera or file), names, prices and ingredients. **Categories**: add, rename, recolour, reorder, switch off (meals stay findable by search) or delete (meals are moved to another category). Favourites button can be switched off |
| Accounts | Manager, owner | **Profit and loss** (sales − cancelled − food & stock bought − expenses), cash-drawer movement, money in vs out chart, profit per meal (cost per plate). **Purchases** with supplier, items, quantities and unit costs (names and last prices suggested). **Expenses** by category. **Sales journal** of every sale. **Cancellations** log. Nothing is ever deleted: mistakes are corrected with a visible reversal |
| Cancel a sale | Cashier asks, manager approves | Reason, money back (cash or to the customer's change), manager or owner PIN. The sale stays in the records marked cancelled; customer change used on it is put back |
| Analytics | Manager, owner | X-style overview: metric cards with change vs the previous period (same time of day), trend chart hourly / daily / weekly / monthly over Today, 7, 28 or 90 days. **Busy times & staff**: weekday × hour heat map, Breakfast / Lunch / Supper, staff needed per hour. **What sells when**: pick Sadza, Drinks or any meal to see its rush and a "ready by" time; preparation plan for every ingredient. Serving speed and money |
| Staff | Manager, owner | **Add, edit, suspend, remove** people and **change PINs**. Managers look after cashiers, kitchen and attendants; only the owner can add or change managers and owners. Nobody can change their own role or suspend/remove themselves, and there is always at least one owner. PINs are 4 digits, unique, not four of the same digit. Suspending signs the person out on every till at once. Removed staff keep their name on past sales and records. Every change is logged with who made it |
| Settings | Owner (managers: Numbers & printing, Serving times) | Logo, name, colour, receipt text, card/slip mode and range, **payment methods on/off**, currencies and rates, menu with photos, late time, parts of the day, staff capacity |

Demo PINs: Owner `1234` · Manager `2222` · Cashier `1111` · Kitchen `3333` · Attendant `4444`.

## Put it online (Vercel)

1. On [vercel.com](https://vercel.com) choose **Add New → Project** and import `Matongos/restaurant-pos`.
2. Set **Root Directory** to `web` (everything else is read from `web/vercel.json`).
3. Press **Deploy**. Every push to `main` updates the site by itself.

Each phone or computer keeps its own demo data in its browser until the shared database is added.

## Run it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd web
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173).

- **Customer display:** on the home screen tap *Customer Display*; drag the new window to the second monitor and press F11.
- **Phones on the same Wi-Fi:** `npm run dev` also prints a *Network* address (e.g. http://192.168.1.20:5173). Open it on a phone for Today's Menu.
  In the prototype each device keeps its own data; sharing between devices arrives with the local server.
- **Start again with clean demo data:** Settings → Demo data → Reset.
- **Example history:** 120 days of generated example orders (marked as training, never saved) so Analytics shows something. Switch it off in Settings → Demo data.

## Project layout

```
web/                 React + TypeScript app (every screen, all devices)
  src/domain/        Types and business rules (no UI) — order numbers, availability, money
  src/store/         Data access. Prototype: browser storage. Next: local server client
  src/print/         Kitchen ticket, customer slip and change voucher layouts (80 mm)
  src/screens/       One file per screen
docs/                Architecture and roadmap notes
```

## Roadmap

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the specification. Next milestone: local server (Node + SQLite) with a live order feed, so tills, kitchen, phones and the customer display share one set of data and keep working with no internet.
