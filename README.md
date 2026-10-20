# Restaurant POS

Point-of-sale system for a pay-first, counter-service restaurant: the customer pays, the cashier enters the order, the kitchen gets a ticket, and the food is brought to the customer by order number (physical card or printed slip).

- **System specification:** https://claude.ai/code/artifact/a61d0239-cf91-4792-b386-4d5b34de9561
- **Status:** clickable prototype (v0.1). Data is kept in the browser; the local server comes next.

## What the prototype does

| Screen | Who | What |
| --- | --- | --- |
| Login | Everyone | 4-digit PIN; each role sees only its screens |
| New Order | Cashier | Photo tiles (sold-out meals hidden), Eat In / Take Away, notes, total in every currency |
| Payment | Cashier | Cash / EcoCash / InnBucks / Swipe, any currency, split payments, change in any currency, **keep change on the customer's balance** or **pay from it**, card number check |
| Order sent | Cashier | Big number to hand over, kitchen ticket, customer slip and change voucher previews, print |
| Customer Display | Second monitor | Items as they are entered, total, paid, change, logo when idle |
| Active Orders | Cashier, attendant | Clock per order ticking every second, amber then red **LATE** (default 5 min, set in Settings), mark served (card is freed), **add a drink to an existing number**, reprint |
| Kitchen Display | Kitchen | Live clocks, late warning, tick done, recall |
| Today's Menu | Kitchen, manager | Switch an ingredient (e.g. Beef) sold out and every meal with it disappears from the till |
| Customer Change | Cashier, manager | One running change balance per customer: kept, used for food, paid out — with full history. Name suggestions while typing; customers with the same name are told apart by phone or a note |
| Reports | Manager, owner | Sales, average wait, late orders, kitchen and hand-over time, wait by hour and by meal, slowest orders, customer change, payments, best sellers, cashiers |
| Settings | Owner | Logo, name, colour, receipt text, card/slip mode and range, currencies and rates, menu with photos and ingredients, kitchen timers |

Demo PINs: Owner `1234` · Manager `2222` · Cashier `1111` · Kitchen `3333` · Attendant `4444`.

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
