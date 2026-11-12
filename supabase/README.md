# Online database (Supabase)

One database for every restaurant using TechPlug POS. Each restaurant's rows are separated by
row-level security: a restaurant's logins can only read and change that restaurant's data, customers
only see the published menu, and only TechPlug admins can open the owner console numbers.

## Set it up (owner, once — about 10 minutes)

1. Go to **supabase.com** → *Start your project* → sign in (GitHub or email).
2. **New project** → name `techplug-pos`, choose a strong database password (keep it in your password
   manager — never send it to anyone), region **South Africa (Cape Town)** if offered, otherwise the
   closest to your restaurants.
3. When it is ready: left menu **SQL Editor** → *New query* → paste everything from
   `migrations/0001_restaurants.sql` → **Run**. It should say *Success*.
4. **Authentication → Providers**: Email is on by default. (Phone / SMS login can be added later.)
5. **Project Settings → API**: you will see the **Project URL** and the **anon public** key.
   These two are meant to be public (they are built into the app); share them so they can be added
   to the app's settings. **Never share the `service_role` key or the database password.**
6. Make yourself an admin for the owner console: after you have signed up in the app, run in the SQL Editor:
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
