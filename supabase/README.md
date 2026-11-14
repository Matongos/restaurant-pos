# Online database (Supabase)

One database for every restaurant using TechPlug POS. Each restaurant's rows are separated by
row-level security: a restaurant's logins can only read and change that restaurant's data, customers
only see the published menu, and only TechPlug admins can open the owner console numbers.

## Set it up (owner, once — about 10 minutes)

1. Go to **supabase.com** → *Start your project* → sign in (GitHub or email).
2. **New project** → name `techplug-pos`, choose a strong database password (keep it in your password
   manager — never send it to anyone), region **Central EU (Frankfurt)** or
   **West Europe (London)** — Supabase has no African region, and these are the closest to
   Southern Africa.
3. When it is ready: left menu **SQL Editor** → *New query* → paste everything from
   `migrations/0001_restaurants.sql` → **Run**. It should say *Success*.
4. **Authentication → Sign In / Providers → Email**: turn **Confirm email** *off* for now and Save.
   (Supabase's built-in email only sends to your own team's addresses, so restaurant owners would never
   get the confirmation email. Turn it back on once a mail service such as Resend is set up under
   **Authentication → Emails → SMTP settings** — that also makes "Forgot password" work for everyone.)
5. **Authentication → URL Configuration**: *Site URL* = the app's address (`https://pos.techplug.co.zw`),
   and under *Redirect URLs* add `https://pos.techplug.co.zw` and `https://web-delta-five-slu2k38rxm.vercel.app`
   (the Windows app and tills set up before the move still use the vercel.app address).
   Email links (confirm, new password) then come back to the app.
6. **Project Settings → API Keys**: you will see the **Project URL** and the **publishable** key.
   These two are meant to be public (they are built into the app); share them so they can be added
   to the app's settings. **Never share the `service_role` key or the database password.**
7. **SQL Editor → New query**: paste everything from `migrations/0002_console_and_online.sql` → **Run**
   (owner console, plan protection, extra menu details for the restaurant page).
8. Make yourself an admin for the owner console: after you have signed up in the app, run in the SQL Editor:
   `insert into platform_admins (user_id) select id from auth.users where email = 'your@email';`

## What is in it

| Table / function | What it is for |
|---|---|
| `restaurants` | One row per restaurant: name, web address (slug), plan, trial end, web page / QR menu / online orders switches |
| `members` | Which logins belong to which restaurant (owner, manager, device) |
| `records` | Everything the app keeps (orders, menu, stock, books, settings…), one row per item, newest version wins |
| `push_records()` | A device sends its changes in one go |
| `online_orders` | Orders customers place from the web page / QR menu |
| `public_menu()` | Today's menu for customers — only what the till published, only when switched on |
| `place_online_order()` | Customer orders; prices are taken from the server's menu, sold-out items refused, 5 open orders per phone max |
| `online_order_status()` | The customer's status page (private link) |
| `app_events`, `console_overview()` | Website visits, downloads, first opens, sign-ups → the owner console |

## Tests

`tests/test_security.sql` runs on plain PostgreSQL with `tests/stub_supabase.sql` standing in for
Supabase's login system. It checks that restaurants cannot see each other, customers cannot read
records, prices come from the server, sold-out meals are refused and the console is admin-only.

## How the app syncs

`web/src/cloud/` — `api.ts` (sign-up, sign-in, calls; plain `fetch`) and `sync.ts`:

- Every change is saved on the device first; changed items go into an outbox and are sent with
  `push_records()` a second later, or when the internet comes back.
- Every 8 seconds (and when the app comes back to the front) the device fetches records changed since it
  last looked. A change still waiting in this device's outbox is kept over an older one from the internet.
- The first device of a restaurant uploads everything; each further device signs in with the same
  email and downloads the restaurant's data (replacing its own). Staff keep using their PINs.
- `tests/cloud-mock.cjs` is a small stand-in for Supabase; `tests/sync.cjs` tests two tills selling,
  going offline and catching up against it.

Slip numbers: each till gives out its own range (till 1 from 1, till 2 from 501, till 3 from 1001…), so two
tills never print the same number. A device that connects picks a free till number (Settings → Numbers).
