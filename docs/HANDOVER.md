# TechPlug POS — technical handover

As of 14 November 2026. Written for the TechPlug team taking over development.
The restaurant-facing guide (how to use the system) is separate.

TechPlug POS is a restaurant point-of-sale: till, kitchen screen, tables, change in several currencies,
stock, books, staff PINs, a free public web page with QR menu and online orders per restaurant, branches,
subscriptions, and an owner console for TechPlug. It is **one React web app** that runs in the browser,
installs as an app on phones/tablets, and is wrapped as a Windows app. It works **offline first** and
syncs to **Supabase** (PostgreSQL) when online.

## 1. Where everything lives

| What | Where | Notes |
| --- | --- | --- |
| Source code | GitHub `Matongos/restaurant-pos` (branch `main`) | Everything below is in this one repository |
| Web app (tills, public pages, console) | https://pos.techplug.co.zw (Vercel project `web`) | Also https://web-delta-five-slu2k38rxm.vercel.app — the Windows app and early tills use this address; both serve the same deployment |
| Product website | https://pos.techplug.co.zw/site/ (shown to first-time visitors of the bare address) | Source `web/public/site/`; also published to GitHub Pages by `.github/workflows/site.yml` |
| Owner console | https://pos.techplug.co.zw/console | TechPlug admins only, password + authenticator code |
| Restaurant pages | https://pos.techplug.co.zw/<web-address> (`?t=T4` for a table) | Rewritten by `web/vercel.json`, turned into `#/r/<slug>` in `web/src/main.tsx` |
| Database, logins | Supabase project `lrgeumaidmfmkszfdqjm`, region Frankfurt (eu-central-1) | URL and publishable key in `web/src/cloudConfig.ts` (public by design) |
| DNS for pos.techplug.co.zw | cPanel at njiwacloud (techplug.co.zw zone) | CNAME `pos` → Vercel (`…vercel-dns-017.com`) |
| Windows installer | GitHub Releases, built by `.github/workflows/desktop.yml` on tags `desktop-v*` | Tauri shell that opens the web app |
| Email (sign-up confirmation, reset) | Not set up yet — plan: Resend SMTP in Supabase | See `supabase/README.md` |

**Accounts to hand over** (owner today: Panashe Matongo): GitHub repo admin, Vercel team/project, Supabase
organisation (owner), cPanel for techplug.co.zw, the console admin login (row in `platform_admins`), and later
Resend and any payment/SMS provider. Turn on two-step login on every one of them. **Never commit** the
Supabase `service_role`/secret key, database password, or provider API keys.

## 2. Architecture

```
 ┌──────────── restaurant ────────────┐            ┌──────────── Supabase (Frankfurt) ───────────┐
 │ Till (browser / installed / Windows)│  HTTPS     │ Auth (email+password, TOTP for admins)      │
 │  React app ─ store ─ IndexedDB      │◀─────────▶ │ PostgREST + RPC functions (security definer)│
 │  outbox → push_records every ~1 s   │  sync      │ Postgres: restaurants, members, records,    │
 │  pull changes every 8 s             │            │   online_orders, payments, platform_settings,│
 │ Kitchen / phone / customer screen   │            │   admin_log, app_events  (row-level security)│
 └─────────────────────────────────────┘            └──────────────────────────────────────────────┘
        ▲                                                     ▲                      ▲
        │ same app, other routes                              │ public_menu()        │ console_*() (admin, aal2)
 ┌──────┴──────────────┐                     ┌────────────────┴───────┐      ┌───────┴────────────┐
 │ Vercel: one static   │  serves ───────────▶│ Customer phone:         │      │ TechPlug console    │
 │ build (Vite)         │                     │ pos.techplug.co.zw/name │      │ /console            │
 └──────────────────────┘                     └─────────────────────────┘      └─────────────────────┘
```

- **No server code of our own.** Vercel serves static files. All server logic is SQL in
  `supabase/migrations/*.sql`: tables, row-level security (RLS) and `security definer` functions.
- **Offline first.** The whole restaurant state lives in memory and in IndexedDB on each device
  (`web/src/store/disk.ts`). Selling never waits for the network.
- **One app, many screens.** Hash routes (`#/till`, `#/kitchen`, `#/r/<slug>`, `#/console`…) in `web/src/App.tsx`.
- **Customers never read restaurant data.** They only call `public_menu()`, `place_online_order()`,
  `online_order_status()`, `cancel_online_order()`. Prices are re-computed on the server.

## 3. Repository map

| Path | What is in it |
| --- | --- |
| `web/src/main.tsx` | Start-up: website redirect for first visitors, short links, PWA, `initStore()`, sync, render |
| `web/src/App.tsx` | Routes, permissions per route, login gate, paused-till screen |
| `web/src/store/store.ts` | **All state and actions** (`placeOrder`, `cancelOrder`, `acceptOnlineOrder`, staff, stock…). Screens only call these |
| `web/src/store/disk.ts` | IndexedDB persistence, write queue, cross-window updates (BroadcastChannel) |
| `web/src/store/pinGuard.ts` | PIN lockout after wrong tries |
| `web/src/domain/` | Pure rules: `types.ts` (data model), `rules.ts` (roles, permissions, PINs), `money.ts`, `stock.ts`, `tables.ts`, `analytics.ts`, `pinhash.ts` |
| `web/src/cloud/api.ts` | Fetch client for Supabase Auth/PostgREST (no SDK): sign-up/in, refresh, MFA, rpc/select/patch |
| `web/src/cloud/sync.ts` | Device ↔ cloud sync (outbox, pull, link, download, archiving, branch copy) |
| `web/src/cloud/online.ts` | Restaurant info (plan, trial, paid-until), public menu publishing, online orders, sales lock |
| `web/src/cloud/platform.ts` | TechPlug details (WhatsApp, how to pay) from `platform_settings` |
| `web/src/screens/` | One file per screen (Till = Sell, Analytics = Reports, Accounts = Books, Console, PublicPages, Setup…) |
| `web/src/components/` | Dialogs and settings panels (CloudAccount, WebsiteSettings, PlanPayments, MyAccount, Backup…) |
| `web/src/print/tickets.ts` | Slip, kitchen ticket and bill layouts |
| `web/src/data/seed.ts` | Demo/sample restaurant (menu, staff, stock); `exampleHistory.ts` = example sales for training |
| `web/public/site/` | Product website (static HTML/CSS/JS) |
| `web/public/sw.js`, `pwa.ts` | Service worker (offline app shell) and install prompts |
| `web/src-tauri/`, `web/desktop-shell/` | Windows app (Tauri) — opens the hosted app |
| `web/vercel.json` | Build settings, cache headers, short-link rewrite |
| `supabase/migrations/` | Database, in order: 0001 core, 0002 console/online, 0003 branches/delivery/trial, 0004 payments/security |
| `supabase/tests/` | SQL tests run on plain PostgreSQL with `stub_supabase.sql` |
| `tests/` | Browser tests (Playwright) and `cloud-mock.cjs`, a stand-in for Supabase |

## 4. Data model

**On the device** (`AppState` in `domain/types.ts`, schema `version` 11, migrations in `store.ts › migrate()`):
lists `staff, currencies, paymentMethods, orderTypes, categories, components, menu, addOns, orders,
customers, credit, stockItems, stockMoves, purchases, expenses, cancellations, staffLog` and single objects
`settings, dayCounter`. Records are **never edited away**: a cancellation, a reversing credit entry or a stock
move corrects a mistake, so totals can always be traced.

**In Supabase:**

| Table | Purpose | Who can read |
| --- | --- | --- |
| `restaurants` | name, slug, plan, trial_ends_at, paid_until, group_id (branches), public switches, public_info, last_seen_at | members; owners may update only public columns |
| `members` | login ↔ restaurant, role owner/manager/device | the login itself |
| `records` | every device list item as one row: `(restaurant_id, kind, id) → data jsonb`, `deleted`, `device_id`, server `updated_at` | members of that restaurant |
| `online_orders` | customer orders (server-priced), status new → accepted → ready → out → collected | members; customers via token functions |
| `payments` | subscription payments recorded by TechPlug | owners of that group, admins |
| `platform_settings` | TechPlug WhatsApp, how to pay, prices | everyone (read), admins (write) |
| `admin_log` | every admin action | admins |
| `app_events` | website visits, download clicks, first opens, sign-ups | admins |
| `platform_admins` | TechPlug console logins | — |

Key functions: `create_restaurant`, `slug_available`, `push_records`, `public_menu`, `place_online_order`,
`online_order_status`, `cancel_online_order`, `create_branch`, `group_summary`, `restaurant_locked`,
`record_payment`, `admin_set_plan`, `admin_set_platform`, `admin_delete_restaurant`, `admin_status`,
`console_overview`, `console_restaurants`, `is_member`, `is_owner`, `is_platform_admin` (requires `aal2`).

## 5. How sync works (`web/src/cloud/sync.ts`)

1. Every local change goes through `set()` in the store. A change hook diffs old/new state **by object
   identity** and puts `kind\u0001id` keys in an **outbox** (kept in localStorage).
2. About a second later the leader window sends them with `push_records()` in parcels of ~700 KB.
3. Every 8 s (and when the app comes to the front) it fetches rows with `updated_at` newer than its cursor
   minus 15 s, and applies them with `applyRemote()` (not re-sent). Last write wins; a change still in this
   device's outbox beats an older remote one; the device's own echoes are skipped.
4. Only one window per device syncs (Web Locks leader election); other windows of the same device get
   changes through IndexedDB + BroadcastChannel.
5. Each push doubles as a heartbeat (`last_seen_at`); the QR menu is "live" if a device was seen within 3 min.
6. A newly connected device downloads set-up data in full and the **last 6 months** of history (more if a
   stock item has not been counted since); "Load older sales" fetches the rest.
7. Slip numbers: each device has a till number (localStorage); till n uses numbers from (n−1)×500+1.

## 6. Main flows

- **Sale:** `Till.tsx` → `placeOrder()` (numbering, stock used, customer change, credit entries) →
  `OrderDoneDialog` / print → outbox → cloud.
- **Online order:** customer page `PublicPages.tsx` → `place_online_order()` → till polls `online_orders`
  (`pollOrders`) → alert → `acceptRemote()` (conditional PATCH so only one till wins) → local order as a
  table tab `WEB n` → kitchen tick → `followLocalOrders()` sets ready/out/collected on the server.
- **Public menu:** the till builds it (`publicMenuFrom`: only sellable items, sold-out flags, delivery fee)
  and publishes it as record `public/menu` when its hash changes.
- **Plans:** `restaurant_locked()` on the server (public pages stop) and `lockReason()` on the till
  (`setSalesLock` blocks `placeOrder`, `sendTableRound`, `acceptOnlineOrder`). Grace = 3 days.
- **Payments:** console `record_payment()` → plan + `paid_until` for the whole group → till re-reads its
  info (every 5 min; every sync tick while locked) and unlocks.
- **Console security:** password sign-in, then TOTP enrol/verify (`/auth/v1/factors`), JWT `aal2`; the
  database's `is_platform_admin()` requires `aal2`; idle sign-out 30 min.
- **PINs:** stored as `h1:` + stretched SHA-256 (`pinhash.ts`); plain PINs arriving from anywhere are
  scrambled (`scramblePins`). Lockout in `pinGuard.ts`.

## 7. Working on it

**Run locally**

```
cd web
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm run build
```

On `localhost` the app can talk to the Supabase stand-in instead of the real database:
`node tests/cloud-mock.cjs` (port 54321) and in the browser console
`localStorage.setItem('restaurant-pos.cloud-url', 'http://localhost:54321')`.

**Tests**

- Browser tests (Playwright, app served on `http://localhost:8765/` with the short-link rewrite, mock on
  54321): `node tests/regression.cjs`, `offline`, `tables`, `staff`, `stock`, `sync`, `online`, `account`,
  `features`. Reset the mock between cloud tests with `GET /__reset`. Tests read data through
  `window.__pos` (only exposed on localhost).
- SQL tests on a scratch PostgreSQL: load `stub_supabase.sql` (skip its role line if roles exist), then
  `0001`, then `\i tests/test_console.sql`, `test_branches.sql`, `test_payments.sql` (they apply 0002–0004).
  `test_security.sql` is for 0001 alone.

**Deploy**

- Push to `main` → Vercel builds `web` (`npm run build:deploy`) and deploys both addresses in ~1 minute.
  Tills show a "new version" bar and reload.
- Database changes: add `supabase/migrations/000N_<name>.sql` (idempotent: `create or replace`,
  `if not exists`), test it, then run it once in the Supabase SQL Editor. **The app must keep working
  before the migration is run** (see how `online.ts` falls back when `group_id`/`paid_until` is missing).
- Windows app: tag `desktop-vX.Y.Z` → GitHub Action builds the installer and attaches it to a release.
  Only needed when the Tauri shell changes; app updates come from the web deployment.

**Conventions**

- Screens call store actions only; business rules go in `domain/`, not in screens.
- Plain, short words in the UI, written for a busy cashier. No jargon.
- Records are permanent; corrections are new records.
- Every feature gets a browser test; every database change gets an SQL test.
- Commit author: the developer; keep commits small with a clear message.

## 8. Known limits and technical debt

| Item | Impact | Suggested fix |
| --- | --- | --- |
| Tills sign in with the owner's account | A stolen till's token has owner rights | Device logins (`members.role = 'device'`, anonymous sign-in + owner approval); keep "Secure password change" on meanwhile |
| Plan lock only on connected tills | An unconnected till can sell for free | Require the online account after the trial |
| Last-write-wins sync per record | Two tills editing the same menu item at once: last wins | Fine for now; field-level merge if needed |
| Polling (8 s) instead of realtime | Up to 8 s delay between tills, more requests | Supabase Realtime on `records`/`online_orders` (tables are already in the publication) |
| Printing through the browser dialog | One extra click; no cash drawer kick | ESC/POS printing in the Tauri app |
| Sample menu has no photos | Owners add their own | Add photos under `web/public/samples/` and reference them in `seed.ts` |
| Email confirmation off until Resend is set up | Anyone can sign up with an unverified email | Set up Resend SMTP, turn on Confirm email (wizard already supports it) |
| Free Supabase plan has no backups | Data loss risk | Supabase Pro ($25/month) |
| No "forgot owner PIN" on the till | A restaurant with one owner needs TechPlug's help | Add "Forgot owner PIN?" on the PIN screen: account password → new owner PIN (`setStaffPin` as that owner) |
| Large `store.ts` (~1,800 lines) | Harder to navigate | Split by area (orders, staff, stock, online) keeping the same exports |

## 9. How to extend it — ideas and where they plug in

| Feature | How it would fit |
| --- | --- |
| **WhatsApp ordering bot** | A small server function (Supabase Edge Function or Vercel Function) receives WhatsApp Business API webhooks (Meta Cloud API or a provider such as Twilio/360dialog). It reads the menu with `public_menu(slug)`, builds the cart in the chat, and places the order with `place_online_order(...)` — the same path as the web page, so the till, kitchen and status updates already work. Send "ready"/"on the way" messages by watching `online_orders.status` (database webhook or a scheduled function). Store the bot's per-restaurant number in `restaurants.public_info`. |
| **Online subscription payments (Paynow: EcoCash/card)** | An Edge Function creates the Paynow transaction and receives its result URL; on success it calls the same logic as `record_payment()` (move it into a non-admin internal function called with the service role). Add a "Pay now" button in Settings → Plan & payments. |
| **SMS when an order is ready** | Same trigger as the WhatsApp status messages, sending through an SMS provider (e.g. Africa's Talking). |
| **Device logins** | See section 8. |
| **Barcode scanning** | USB scanners type the code + Enter: add `barcode` to `MenuItem`, a hidden input on the Sell screen that matches it. |
| **Loyalty / customer accounts** | `customers` already exists (for kept change); add points to `credit` entries. |
| **Languages (Shona, Ndebele)** | Move UI strings into a dictionary per language; the UI text is already short and plain. |
| **Owner mobile app** | Not needed as a separate app: the PWA works; add push notifications through the service worker. |
| **More reports / exports** | `domain/analytics.ts` holds the calculations; add CSV export of Books and Reports. |

## 10. Runbooks

- **Make someone a console admin:** SQL Editor →
  `insert into platform_admins (user_id) select id from auth.users where email = 'name@example.com';`
  They set up their authenticator on first sign-in.
- **Reset a restaurant owner's password:** SQL Editor →
  `update auth.users set encrypted_password = extensions.crypt('NEW-PASSWORD', extensions.gen_salt('bf')) where email = 'owner@example.com';`
  then clear the query. Their tills stay connected.
- **Admin lost their phone (authenticator):** Supabase → Authentication → Users → the user → delete their
  MFA factor; they enrol again at next console sign-in.
- **Record a payment / give days / close / delete a restaurant:** owner console (all logged in `admin_log`).
- **Owner forgot their PIN:** a second owner can change it under Staff (managers cannot change an owner's
  PIN). With a single owner there is no self-service reset yet — see "Forgot owner PIN" in section 8.
- **Rotate keys:** Supabase → Project Settings → API Keys. The publishable key is in `web/src/cloudConfig.ts`
  and `web/public/site/site.js`; rotating it needs a commit and deploy.
- **Restore a restaurant:** Supabase Pro daily backups (point-in-time with the add-on); owners can also
  keep their downloaded backup file (Settings → Backup).

## 11. Documents in this repository

- `README.md` — feature list per screen.
- `supabase/README.md` — setting up Supabase, email (Resend), security notes, sync summary.
- `docs/ARCHITECTURE.md` — the original design principles (some of its "planned" parts were replaced by the cloud design described here).
- `docs/HANDOVER.md` — this document.

Designed PDF versions with diagrams and screenshots: `docs/TechPlug-POS-Technical-Handover.pdf` and
`docs/TechPlug-POS-Restaurant-Guide.pdf` (for restaurants). Diagram sources (Graphviz) are in `docs/diagrams/`
— render with `dot -Tsvg name.dot -o name.svg`.
