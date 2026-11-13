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
| Add-ons | Cashier, manager | Priced extras per plate, e.g. **Extra meat +$1.50**, **Fried egg +$0.50**, **Extra gravy (free)**. Tap **+ Extra** on an order line and pick one; with several plates it asks *how many?* and splits the line. The price is added to the plate, printed as **+ EXTRA MEAT** on the kitchen ticket, shown on the kitchen screen and the customer display. Managed in Menu → Add-ons (name, price, cost, which meals offer it); one can be marked finished on Sold out. Reports → Money lists add-ons sold; profit per meal includes their cost |
| Delivery | Cashier, attendant, manager | Switch on in Settings → Delivery (owner or manager), with delivery areas and fees (e.g. Within 2 km $1). At the till tap **Delivery**: customer name, phone, area (sets the fee, or type another), address and a note for the rider; regular customers are suggested from earlier deliveries. The fee is shown and added to the total (and on the customer display). Paid first like every order; a **delivery slip** prints for the bag (who, where, phone, items, PAID). In Orders: **Out for delivery** (pick or type the rider) → **Delivered**; an *Out for delivery* tab lists what is on the road. Reports → Money shows deliveries and fees by area |
| Stock | Kitchen, manager, owner | Counted stock, worked out from permanent records: last **stock take** + purchases (Books) − waste − what every sale used. Each meal (and add-on) has its **stock used per plate** (e.g. Sadza & Beef: 0.18 kg mealie meal, 0.2 kg beef); take-away and delivery plates also use a container. Shows what is left, used today, how many days it lasts, low and out warnings (badge on the Stock button) and stock value. When a counted item runs out it can hide the meals that need it from the till. **Stock take** shows expected vs counted and keeps the difference; **Record waste** with a reason. Cancelled sales give their stock back. Kitchen can count and record waste; managers and owners also set how each item is counted |
| Tables | Attendant (waiter), cashier, manager | **Switched off by default.** The owner picks *How you serve* in Settings: **Counter only** (pay first, numbered card — unchanged), **Tables only**, or **Both** (tables for eating in, counter for Take Away and Delivery), sets up the tables (name, area, seats; add 10 at once) and the rules (ask for guests, service charge %). The **Tables** screen shows every table: dashed = free, blue = ordering/eating, green = food ready, amber = bill printed, with guests, minutes seated, waiter and amount. Tap a free table → guests → order → **Send to kitchen** (no payment); more rounds can be sent later. The kitchen sees **T4 · ROUND 2**. **Served** when food goes out. **Bill** prints the bill and pays it as one bill, **split equally**, **by item** (tap who had what) or **by amount** — each share on the normal payment screen (any currency, change, EcoCash). The table frees when fully paid. Cancelling an open table needs a manager PIN. Waiters start on Tables; cashiers on Sell |
| Online account | Owner | **Settings → Online account.** The first till creates the restaurant's account (name, web address `name.techplugpos.com`, email, password) and sends its menu, staff, sales and books online. Other tills, phones and tablets sign in with the same email and download the restaurant's data. From then on every device stays in step (changes go out within a second or two, others' changes arrive within about 8 seconds). Selling never waits for the internet: offline changes wait in an outbox and go out when the connection is back. The top bar shows *Online*, *Syncing*, *Offline* or *Not syncing* |
| Website, QR menu, online orders | Owner (settings), cashier (orders) | **Settings → Website & QR menu** (needs the online account): switch on the restaurant's **web page**, the **QR menu** and **online orders (pick-up)**, optionally **ordering from the table**; add phone, WhatsApp, address and hours; copy the link and **print QR posters** (one for the counter, one per table). Customers open `…/#/r/<web address>`: today's menu with sold-out meals marked, live only while a till is online. They order with name and phone; prices are set by the server. The till rings and shows **Online orders**: accept with a ready time (10–45 min) or decline. Accepted orders go to the kitchen as **WEB 3**; the customer's page shows Accepted → Ready → Collected as the kitchen and counter work. Payment is at the counter on the normal payment screen |
| New restaurant / connect | Owner | The login screen of a new device offers **New restaurant? Set it up** (restaurant, owner name and PIN, email and password — starts empty, sample menu optional, no demo staff or sales) and **Connect to my restaurant** (sign in, download the restaurant's data) |
| Owner console | TechPlug admin | `…/#/console`: Windows downloads (GitHub), website visits and download clicks, devices opened, sign-ups, restaurants (owner email, plan, trial days left, last seen, devices, sales, online features), paying restaurants and monthly income; change a plan or give 30 more trial days |
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
