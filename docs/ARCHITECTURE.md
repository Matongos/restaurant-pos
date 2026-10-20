# Architecture

## Principles

1. **Local first.** Sales, printing and serving never depend on the internet. A local server runs on the main till PC; every device connects to it over the restaurant's Wi-Fi.
2. **One codebase.** The same React app is the till, kitchen display, customer display, phone screens and back office.
3. **Screens are views of one order feed.** Adding a screen (Now Serving TV, menu board) does not change the core.
4. **Data, not code.** Order types, currencies, payment methods, roles and printers are records in the database.
5. **Times recorded from day one.** Every order keeps a status history (placed, in kitchen, ready, served) for kitchen-speed reports.
6. **Permanent records.** Sales, purchases, expenses and customer-change movements are never edited or deleted. A cancellation or a reversing record corrects a mistake, so every total can be traced.
7. **Branch-ready.** Every record carries `branchId`; with one restaurant it is invisible.

## Layers

```
screens (React)  ──calls──▶  store actions  ──▶  backend
                                                  ├─ prototype: browser storage (now)
                                                  └─ local server: REST + WebSocket (next)
domain/ (pure TypeScript rules, shared by the app and the server)
```

Screens only call the actions in `web/src/store/store.ts`. Swapping the prototype storage for the server client keeps every screen unchanged.

## Planned components

| Part | Technology | Notes |
| --- | --- | --- |
| Local server | Node.js + SQLite (PostgreSQL optional) | Orders, menu, payments, change owed, shifts; WebSocket feed |
| Desktop till | Tauri (or Electron) wrapping the web app | Direct ESC/POS printing, cash drawer, second-screen window, auto-start |
| Phones / tablets | Installable web app (PWA) | Today's Menu, attendant, kitchen tablet |
| Cloud (optional) | Same server code, hosted | Owner reports from anywhere, backups, multi-branch |

## Printing

The prototype prints through the browser dialog. The desktop app sends ESC/POS commands directly to 80 mm thermal printers (USB or network), so the kitchen ticket prints the moment an order is confirmed, without a dialog. Ticket layouts live in `web/src/print/tickets.ts`.

## Next steps (Phase 1)

1. Local server with the domain rules moved to a shared package.
2. Shift open/close with cash count per currency (expected vs counted).
3. Manager PIN for voids, refunds, discounts; audit log.
4. Expenses.
5. Desktop wrapper with direct printing and cash drawer.
6. Installer and setup guide for the restaurant PC.
