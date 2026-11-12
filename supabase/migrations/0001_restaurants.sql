-- TechPlug POS — online database (Supabase / PostgreSQL)
-- One database for every restaurant. Each row belongs to one restaurant and the database itself
-- (row-level security) refuses to show or change another restaurant's rows.
--
-- How the app uses it:
--   * The owner signs up (email or phone) and creates a restaurant -> create_restaurant().
--   * Each till / phone / tablet signs in once as a member of that restaurant; staff then use their
--     PINs inside the app, as today.
--   * Everything the app keeps (menu, orders, payments, stock, books, settings…) is stored as records:
--     one row per item, newest version wins. Devices send their changes and fetch others' changes
--     since they last looked, and get live updates while online.
--   * Customers (QR menu, restaurant web page, online orders) never see records: they go through
--     public_menu() and place_online_order(), which only return or accept what is safe.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ restaurants and who belongs
create table public.restaurants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 2 and 80),
  slug          text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  town          text,
  country       text default 'ZW',
  currency      text default 'USD',
  plan          text not null default 'trial' check (plan in ('trial', 'restaurant', 'group', 'free', 'closed')),
  trial_ends_at timestamptz not null default now() + interval '30 days',
  -- customer-facing features, switched on in Settings -> Online & website
  web_page      boolean not null default false,
  qr_menu       boolean not null default false,
  online_orders boolean not null default false,
  public_info   jsonb not null default '{}'::jsonb,  -- hours, address, phone, WhatsApp, logo, colours
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create table public.members (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'device' check (role in ('owner', 'manager', 'device')),
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index members_user on public.members(user_id);

-- People who run TechPlug itself (your owner console).
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function public.is_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where restaurant_id = rid and user_id = auth.uid());
$$;
create or replace function public.is_owner(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where restaurant_id = rid and user_id = auth.uid() and role in ('owner', 'manager'));
$$;
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- ------------------------------------------------------------------ the restaurant's data
-- kind: 'order', 'menuItem', 'staff', 'settings', 'purchase', 'expense', 'stockMove', … (the app's collections)
create table public.records (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kind          text not null check (length(kind) between 1 and 40),
  id            text not null check (length(id) between 1 and 80),
  data          jsonb not null,
  deleted       boolean not null default false,
  device_id     text,
  updated_at    timestamptz not null default clock_timestamp(),
  updated_by    uuid default auth.uid(),
  primary key (restaurant_id, kind, id)
);
create index records_changes on public.records(restaurant_id, updated_at);

-- The server sets the time, so devices with wrong clocks cannot jump ahead of everyone else.
create or replace function public.records_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- Devices send many changes at once. Returns the server time to use for the next "changes since".
create or replace function public.push_records(rid uuid, items jsonb, device text default null)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  if not is_member(rid) then raise exception 'not a member of this restaurant' using errcode = '42501'; end if;
  for it in select * from jsonb_array_elements(items) loop
    insert into records (restaurant_id, kind, id, data, deleted, device_id)
    values (rid, it->>'kind', it->>'id', coalesce(it->'data', '{}'::jsonb), coalesce((it->>'deleted')::boolean, false), device)
    on conflict (restaurant_id, kind, id) do update
      set data = excluded.data, deleted = excluded.deleted, device_id = excluded.device_id;
  end loop;
  update restaurants set last_seen_at = now() where id = rid;
  return clock_timestamp();
end $$;

-- ------------------------------------------------------------------ online orders from customers
create table public.online_orders (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  number        int not null,
  customer_name text not null check (length(trim(customer_name)) between 1 and 60),
  phone         text not null check (phone ~ '^[0-9+ ()-]{7,20}$'),
  mode          text not null default 'pickup' check (mode in ('pickup', 'delivery', 'table')),
  table_name    text,
  address       text,
  lines         jsonb not null,          -- [{itemId, name, qty, unitPrice, extras, without, note}] priced by the server
  total         numeric(12, 2) not null check (total >= 0),
  status        text not null default 'new' check (status in ('new', 'accepted', 'declined', 'ready', 'collected', 'cancelled')),
  ready_minutes int,
  public_token  uuid not null default gen_random_uuid(),   -- lets the customer follow their own order only
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index online_orders_live on public.online_orders(restaurant_id, status, created_at);
create or replace function public.online_orders_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger online_orders_touch before update on public.online_orders for each row execute function public.online_orders_touch();

-- ------------------------------------------------------------------ downloads and app opens (owner console)
create table public.app_events (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('site_visit', 'download_click', 'first_open', 'web_install', 'signup')),
  platform   text check (length(platform) <= 20),
  source     text check (length(source) <= 40),
  country    text check (length(country) <= 2),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ row-level security
alter table public.restaurants     enable row level security;
alter table public.members         enable row level security;
alter table public.platform_admins enable row level security;
alter table public.records         enable row level security;
alter table public.online_orders   enable row level security;
alter table public.app_events      enable row level security;

create policy "members see their restaurant" on public.restaurants for select using (is_member(id) or is_platform_admin());
create policy "owners edit their restaurant" on public.restaurants for update using (is_owner(id)) with check (is_owner(id));
create policy "admins edit restaurants"      on public.restaurants for update using (is_platform_admin());

create policy "members see members"   on public.members for select using (is_member(restaurant_id) or is_platform_admin());
create policy "owners add members"    on public.members for insert with check (is_owner(restaurant_id));
create policy "owners remove members" on public.members for delete using (is_owner(restaurant_id) and user_id <> auth.uid());

create policy "admins see admins" on public.platform_admins for select using (is_platform_admin());

create policy "members read records"   on public.records for select using (is_member(restaurant_id));
create policy "members add records"    on public.records for insert with check (is_member(restaurant_id));
create policy "members change records" on public.records for update using (is_member(restaurant_id)) with check (is_member(restaurant_id));
-- (no delete: records are marked deleted, never removed, like the rest of the system)

create policy "members see online orders"    on public.online_orders for select using (is_member(restaurant_id));
create policy "members update online orders" on public.online_orders for update using (is_member(restaurant_id)) with check (is_member(restaurant_id));

create policy "anyone can log an event" on public.app_events for insert with check (true);
create policy "admins read events"      on public.app_events for select using (is_platform_admin());

-- ------------------------------------------------------------------ actions
-- Owner creates a restaurant right after signing up; they become its owner.
create or replace function public.create_restaurant(p_name text, p_slug text, p_town text default null, p_country text default 'ZW', p_currency text default 'USD')
returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into restaurants (name, slug, town, country, currency) values (trim(p_name), lower(trim(p_slug)), p_town, p_country, p_currency) returning id into rid;
  insert into members (restaurant_id, user_id, role) values (rid, auth.uid(), 'owner');
  insert into app_events (kind, country) values ('signup', p_country);
  return rid;
end $$;

-- Is a web address free? (for the sign-up form)
create or replace function public.slug_available(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select lower(trim(p_slug)) ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'
     and not exists (select 1 from restaurants where slug = lower(trim(p_slug)))
     and lower(trim(p_slug)) not in ('www', 'app', 'api', 'admin', 'console', 'site', 'help', 'mail', 'techplug');
$$;

-- Today's menu for the QR code and the restaurant's web page. Only when switched on; only safe fields.
-- The till publishes it as the record kind='public', id='menu' whenever the menu or "sold out" changes:
--   { categories: [{id,name,sort}], items: [{id,name,price,categoryId,emoji,photo,available,addOnIds}], addOns: [{id,name,price,available}] }
-- (the till works out "available" with all its rules: sold-out parts, stock, add-ons).
-- "online" is false when no device of the restaurant has been in touch for 3 minutes.
create or replace function public.public_menu(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r restaurants; m records;
begin
  select * into r from restaurants where slug = lower(p_slug) and plan <> 'closed';
  if not found or not (r.web_page or r.qr_menu) then return null; end if;
  select * into m from records where restaurant_id = r.id and kind = 'public' and id = 'menu' and not deleted;
  return jsonb_build_object(
    'name', r.name, 'town', r.town, 'currency', r.currency, 'info', r.public_info,
    'webPage', r.web_page, 'qrMenu', r.qr_menu, 'onlineOrders', r.online_orders,
    'online', coalesce(r.last_seen_at > now() - interval '3 minutes', false),
    'updatedAt', m.updated_at,
    'categories', coalesce(m.data->'categories', '[]'::jsonb),
    'items', coalesce(m.data->'items', '[]'::jsonb),
    'addOns', coalesce(m.data->'addOns', '[]'::jsonb));
end $$;

-- A customer places an order. Prices come from the published menu on the server, never from the phone.
-- Returns the order number and a private token for the status page.
create or replace function public.place_online_order(p_slug text, p_name text, p_phone text, p_mode text, p_lines jsonb, p_table text default null, p_address text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r restaurants; menu jsonb; ln jsonb; item jsonb; priced jsonb := '[]'::jsonb; tot numeric := 0; qty int; unit numeric; n int; o online_orders;
begin
  select * into r from restaurants where slug = lower(p_slug) and plan <> 'closed';
  if not found or not r.online_orders then raise exception 'This restaurant is not taking online orders' using errcode = 'P0001'; end if;
  if not coalesce(r.last_seen_at > now() - interval '3 minutes', false) then raise exception 'The restaurant is offline right now — please order at the counter' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 40 then raise exception 'Order is empty' using errcode = 'P0001'; end if;
  if coalesce(p_mode, 'pickup') not in ('pickup', 'delivery', 'table') then raise exception 'Unknown order type' using errcode = 'P0001'; end if;
  -- no more than 5 open orders per phone number at a time (stops pranks)
  if (select count(*) from online_orders where restaurant_id = r.id and phone = trim(p_phone) and status in ('new', 'accepted')) >= 5 then
    raise exception 'Too many open orders for this phone number' using errcode = 'P0001';
  end if;
  select data into menu from records where restaurant_id = r.id and kind = 'public' and id = 'menu' and not deleted;
  for ln in select * from jsonb_array_elements(p_lines) loop
    select x into item from jsonb_array_elements(coalesce(menu->'items', '[]'::jsonb)) x where x->>'id' = ln->>'itemId';
    if item is null or not coalesce((item->>'available')::boolean, false) then raise exception 'Sold out: %', coalesce(item->>'name', 'an item') using errcode = 'P0001'; end if;
    qty := greatest(1, least(20, coalesce((ln->>'qty')::int, 1)));
    unit := (item->>'price')::numeric + coalesce((
      select sum((a->>'price')::numeric) from jsonb_array_elements(coalesce(menu->'addOns', '[]'::jsonb)) a
      where coalesce((a->>'available')::boolean, true)
        and a->>'id' in (select jsonb_array_elements_text(coalesce(ln->'extras', '[]'::jsonb)))
        and a->>'id' in (select jsonb_array_elements_text(coalesce(item->'addOnIds', '[]'::jsonb)))), 0);
    priced := priced || jsonb_build_array(jsonb_build_object('itemId', item->>'id', 'name', item->>'name', 'qty', qty, 'unitPrice', unit,
                'extras', coalesce(ln->'extras', '[]'::jsonb), 'without', coalesce(ln->'without', '[]'::jsonb), 'note', left(coalesce(ln->>'note', ''), 120)));
    tot := tot + qty * unit;
  end loop;
  select coalesce(max(number), 0) + 1 into n from online_orders where restaurant_id = r.id and created_at > date_trunc('day', now());
  insert into online_orders (restaurant_id, number, customer_name, phone, mode, table_name, address, lines, total)
  values (r.id, n, trim(p_name), trim(p_phone), coalesce(p_mode, 'pickup'), left(p_table, 20), left(p_address, 200), priced, round(tot, 2)) returning * into o;
  return jsonb_build_object('number', o.number, 'token', o.public_token, 'total', o.total);
end $$;

-- The customer's status page (only with their private token).
create or replace function public.online_order_status(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', o.number, 'status', o.status, 'readyMinutes', o.ready_minutes, 'total', o.total,
                            'lines', o.lines, 'mode', o.mode, 'restaurant', r.name, 'createdAt', o.created_at, 'updatedAt', o.updated_at)
  from online_orders o join restaurants r on r.id = o.restaurant_id where o.public_token = p_token;
$$;

-- ------------------------------------------------------------------ owner console numbers
create or replace function public.console_overview(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'visits',       (select count(*) from app_events where kind = 'site_visit' and created_at > now() - make_interval(days => p_days)),
    'downloads',    (select count(*) from app_events where kind = 'download_click' and created_at > now() - make_interval(days => p_days)),
    'firstOpens',   (select count(*) from app_events where kind = 'first_open' and created_at > now() - make_interval(days => p_days)),
    'signups',      (select count(*) from restaurants where created_at > now() - make_interval(days => p_days)),
    'restaurants',  (select count(*) from restaurants where plan <> 'closed'),
    'activeWeek',   (select count(*) from restaurants where last_seen_at > now() - interval '7 days'),
    'paying',       (select count(*) from restaurants where plan in ('restaurant', 'group')),
    'monthlyIncome',(select coalesce(sum(case plan when 'restaurant' then 15 when 'group' then 35 else 0 end), 0) from restaurants),
    'perDay',       (select coalesce(jsonb_agg(d order by d->>'day'), '[]'::jsonb) from (
                       select jsonb_build_object('day', day::date, 'downloads', count(*) filter (where kind = 'download_click'), 'signups', count(*) filter (where kind = 'signup')) d
                       from (select date_trunc('day', created_at) as day, kind from app_events where created_at > now() - make_interval(days => p_days)) e group by day) x),
    'countries',    (select coalesce(jsonb_object_agg(country, c), '{}'::jsonb) from (select coalesce(country, '??') as country, count(*) c from restaurants group by 1) y)
  );
end $$;

-- ------------------------------------------------------------------ live updates
-- Devices listen for changed records and new online orders of their own restaurant (RLS applies).
alter publication supabase_realtime add table public.records;
alter publication supabase_realtime add table public.online_orders;

grant execute on function public.public_menu(text), public.place_online_order(text, text, text, text, jsonb, text, text),
                          public.online_order_status(uuid), public.slug_available(text) to anon, authenticated;
grant execute on function public.create_restaurant(text, text, text, text, text), public.push_records(uuid, jsonb, text),
                          public.console_overview(int) to authenticated;
