-- TechPlug POS — step 4: subscriptions paid by cash/EcoCash/bank and recorded in the console,
-- two-step login for the console, an admin log, and limits against spam orders.
-- Run once in the Supabase SQL Editor after 0001–0003 (paste all, Run). Safe to run again.

-- ------------------------------------------------------------------ 1. the console needs two-step login
-- A TechPlug admin only counts as an admin when they signed in with their code from an authenticator app
-- (Supabase marks such a login "aal2"). A stolen password alone opens nothing.
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
     and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$$;

-- What the console shows before two-step login is set up: is this login an admin at all, and is the code in?
create or replace function public.admin_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'admin', exists (select 1 from platform_admins where user_id = auth.uid()),
    'aal2', coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2');
$$;

-- Everything an admin changes is written down.
create table if not exists public.admin_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  admin_id   uuid default auth.uid(),
  action     text not null,
  restaurant uuid,
  detail     jsonb not null default '{}'::jsonb
);
alter table public.admin_log enable row level security;
drop policy if exists "admins read the log" on public.admin_log;
create policy "admins read the log" on public.admin_log for select using (is_platform_admin());
grant select on public.admin_log to authenticated;

-- ------------------------------------------------------------------ 2. TechPlug's own details (shown in the app)
-- WhatsApp number and how to pay; edited in the console, read by every till (no app update needed).
create table if not exists public.platform_settings (
  id   int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
drop policy if exists "everyone reads platform settings" on public.platform_settings;
create policy "everyone reads platform settings" on public.platform_settings for select using (true);
grant select on public.platform_settings to anon, authenticated;

create or replace function public.admin_set_platform(p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update platform_settings set data = coalesce(p_data, '{}'::jsonb), updated_at = now() where id = 1;
  insert into admin_log (action, detail) values ('platform_settings', p_data);
end $$;

-- ------------------------------------------------------------------ 3. subscriptions and payments
alter table public.restaurants add column if not exists paid_until timestamptz;

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,  -- the main restaurant of a group
  amount        numeric(12, 2) not null check (amount >= 0),
  currency      text not null default 'USD',
  method        text not null check (method in ('cash', 'ecocash', 'onemoney', 'innbucks', 'bank', 'card', 'other')),
  reference     text check (length(reference) <= 80),
  plan          text not null check (plan in ('restaurant', 'group', 'free')),
  months        int not null check (months between 0 and 36),
  paid_until    timestamptz,                 -- what the subscription runs to after this payment
  note          text check (length(note) <= 200),
  recorded_by   uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists payments_restaurant on public.payments(restaurant_id, created_at desc);
alter table public.payments enable row level security;
drop policy if exists "owners see their payments" on public.payments;
create policy "owners see their payments" on public.payments for select
  using (is_platform_admin() or exists (
    select 1 from members m join restaurants r on r.id = m.restaurant_id
    where m.user_id = auth.uid() and m.role in ('owner', 'manager') and coalesce(r.group_id, r.id) = payments.restaurant_id));
grant select on public.payments to authenticated;

-- Tills pause (and the public pages stop) 3 days after the trial ends or the paid time runs out, or when closed.
create or replace function public.restaurant_locked(r public.restaurants) returns boolean
language sql stable as $$
  select r.plan = 'closed'
      or (r.plan = 'trial' and r.trial_ends_at < now() - interval '3 days')
      or (r.plan in ('restaurant', 'group') and r.paid_until is not null and r.paid_until < now() - interval '3 days');
$$;

-- An admin records money received (cash, EcoCash, bank…). The plan is switched on for the whole group and the
-- paid time is extended from today, or from the current end if it has not run out yet.
create or replace function public.record_payment(p_restaurant uuid, p_amount numeric, p_method text, p_plan text, p_months int,
                                                 p_reference text default null, p_currency text default 'USD', p_note text default null)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare g uuid; cur timestamptz; nxt timestamptz;
begin
  if not is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(group_id, id), paid_until into g, cur from restaurants where id = p_restaurant;
  if g is null then raise exception 'restaurant not found' using errcode = 'P0001'; end if;
  select paid_until into cur from restaurants where id = g;
  nxt := case when p_plan = 'free' then null else greatest(coalesce(cur, now()), now()) + make_interval(months => p_months) end;
  insert into payments (restaurant_id, amount, currency, method, reference, plan, months, paid_until, note)
  values (g, p_amount, coalesce(p_currency, 'USD'), p_method, nullif(trim(p_reference), ''), p_plan, p_months, nxt, nullif(trim(p_note), ''));
  update restaurants set plan = p_plan, paid_until = nxt where id = g or group_id = g;
  insert into admin_log (action, restaurant, detail)
  values ('payment', g, jsonb_build_object('amount', p_amount, 'currency', p_currency, 'method', p_method, 'plan', p_plan, 'months', p_months, 'reference', p_reference, 'paid_until', nxt));
  return nxt;
end $$;

-- Plan changes and extra trial days, now written to the log.
create or replace function public.admin_set_plan(p_restaurant uuid, p_plan text, p_trial_days int default null)
returns void
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if not is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_plan not in ('trial', 'restaurant', 'group', 'free', 'closed') then raise exception 'unknown plan' using errcode = 'P0001'; end if;
  select coalesce(group_id, id) into g from restaurants where id = p_restaurant;
  update restaurants
     set plan = p_plan,
         trial_ends_at = case when p_trial_days is null then trial_ends_at else now() + make_interval(days => p_trial_days) end
   where id = p_restaurant or (group_id is not null and group_id = g);
  insert into admin_log (action, restaurant, detail) values ('set_plan', p_restaurant, jsonb_build_object('plan', p_plan, 'trial_days', p_trial_days));
end $$;

-- Delete a restaurant for good (its records, online orders and payments go with it). The name must be typed exactly.
create or replace function public.admin_delete_restaurant(p_restaurant uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = public as $$
declare r restaurants;
begin
  if not is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from restaurants where id = p_restaurant;
  if not found then raise exception 'restaurant not found' using errcode = 'P0001'; end if;
  if trim(p_confirm_name) <> r.name then raise exception 'The name does not match' using errcode = 'P0001'; end if;
  if exists (select 1 from restaurants where group_id = r.id and id <> r.id) then
    raise exception 'Delete its branches first' using errcode = 'P0001';
  end if;
  insert into admin_log (action, restaurant, detail) values ('delete_restaurant', r.id, jsonb_build_object('name', r.name, 'slug', r.slug));
  delete from restaurants where id = r.id;
end $$;

-- The owner console list, with the paid-until date.
drop function if exists public.console_restaurants();
create function public.console_restaurants()
returns table (id uuid, name text, slug text, town text, plan text, trial_ends_at timestamptz, created_at timestamptz,
               last_seen_at timestamptz, owner_email text, devices bigint, orders bigint, web_page boolean, qr_menu boolean,
               online_orders boolean, online_orders_count bigint, group_id uuid, group_name text, branches bigint,
               paid_until timestamptz, last_payment timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select r.id, r.name, r.slug, r.town, r.plan, r.trial_ends_at, r.created_at, r.last_seen_at,
         (select u.email::text from members m join auth.users u on u.id = m.user_id where m.restaurant_id = r.id and m.role = 'owner' limit 1),
         (select count(distinct x.device_id) from records x where x.restaurant_id = r.id and x.device_id is not null),
         (select count(*) from records x where x.restaurant_id = r.id and x.kind = 'orders' and not x.deleted),
         r.web_page, r.qr_menu, r.online_orders,
         (select count(*) from online_orders o where o.restaurant_id = r.id),
         r.group_id,
         (select g.name from restaurants g where g.id = r.group_id),
         (select count(*) from restaurants b where r.group_id = r.id and b.group_id = r.id),
         r.paid_until,
         (select max(p.created_at) from payments p where p.restaurant_id = coalesce(r.group_id, r.id))
  from restaurants r
  order by coalesce(r.group_id, r.id), r.group_id is distinct from r.id, r.created_at desc;
end $$;

-- Console numbers: money actually received this month, and how many are overdue.
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
    'paying',       (select count(*) from restaurants where plan in ('restaurant', 'group') and (group_id is null or group_id = id)),
    'monthlyIncome',(select coalesce(sum(case plan when 'restaurant' then 15 when 'group' then 35 else 0 end), 0) from restaurants where group_id is null or group_id = id),
    'paidThisMonth',(select coalesce(sum(amount), 0) from payments where created_at >= date_trunc('month', now()) and currency = 'USD'),
    'overdue',      (select count(*) from restaurants where (group_id is null or group_id = id) and plan in ('restaurant', 'group') and paid_until < now()),
    'perDay',       (select coalesce(jsonb_agg(d order by d->>'day'), '[]'::jsonb) from (
                       select jsonb_build_object('day', day::date, 'downloads', count(*) filter (where kind = 'download_click'), 'signups', count(*) filter (where kind = 'signup')) d
                       from (select date_trunc('day', created_at) as day, kind from app_events where created_at > now() - make_interval(days => p_days)) e group by day) x),
    'countries',    (select coalesce(jsonb_object_agg(country, c), '{}'::jsonb) from (select coalesce(country, '??') as country, count(*) c from restaurants group by 1) y)
  );
end $$;

-- ------------------------------------------------------------------ 4. limits against spam
-- Who is calling, as a scrambled key (the raw internet address is not stored).
create or replace function public.client_key() returns text
language sql stable as $$
  select md5('tp:' || coalesce(
    nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip',
    split_part(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ',', 1),
    ''));
$$;

alter table public.online_orders add column if not exists client_key text;
alter table public.app_events add column if not exists client_key text;

-- Website visits and download clicks: at most 30 an hour from one connection count.
create or replace function public.app_events_throttle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.client_key := client_key();
  if new.client_key <> md5('tp:') and (select count(*) from app_events where client_key = new.client_key and created_at > now() - interval '1 hour') >= 30 then
    return null;  -- quietly not counted
  end if;
  return new;
end $$;
drop trigger if exists app_events_throttle on public.app_events;
create trigger app_events_throttle before insert on public.app_events for each row execute function public.app_events_throttle();

-- Online orders: also at most 3 open orders from one connection in 10 minutes, and 40 new orders a restaurant in 10 minutes.
create or replace function public.place_online_order(p_slug text, p_name text, p_phone text, p_mode text, p_lines jsonb, p_table text default null, p_address text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r restaurants; menu jsonb; ln jsonb; item jsonb; priced jsonb := '[]'::jsonb; tot numeric := 0; qty int; unit numeric; n int; o online_orders; fee numeric := 0; ck text := client_key();
begin
  select * into r from restaurants where slug = lower(p_slug) and plan <> 'closed';
  if not found or not r.online_orders or restaurant_locked(r) then raise exception 'This restaurant is not taking online orders' using errcode = 'P0001'; end if;
  if not coalesce(r.last_seen_at > now() - interval '3 minutes', false) then raise exception 'The restaurant is offline right now — please order at the counter' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 40 then raise exception 'Order is empty' using errcode = 'P0001'; end if;
  if coalesce(p_mode, 'pickup') not in ('pickup', 'delivery', 'table') then raise exception 'Unknown order type' using errcode = 'P0001'; end if;
  if (select count(*) from online_orders where restaurant_id = r.id and phone = trim(p_phone) and status in ('new', 'accepted', 'ready', 'out')) >= 5 then
    raise exception 'Too many open orders for this phone number' using errcode = 'P0001';
  end if;
  if ck <> md5('tp:') and (select count(*) from online_orders where client_key = ck and status in ('new', 'accepted', 'ready', 'out') and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'Too many orders from this phone — please wait a few minutes' using errcode = 'P0001';
  end if;
  if (select count(*) from online_orders where restaurant_id = r.id and created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'The restaurant is very busy — please try again in a few minutes' using errcode = 'P0001';
  end if;
  select data into menu from records where restaurant_id = r.id and kind = 'public' and id = 'menu' and not deleted;
  if p_mode = 'delivery' then
    if not coalesce((menu->'delivery'->>'on')::boolean, false) then raise exception 'This restaurant does not deliver online orders' using errcode = 'P0001'; end if;
    if length(trim(coalesce(p_address, ''))) < 5 then raise exception 'Type the delivery address' using errcode = 'P0001'; end if;
    fee := greatest(0, coalesce((menu->'delivery'->>'fee')::numeric, 0));
  end if;
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
  insert into online_orders (restaurant_id, number, customer_name, phone, mode, table_name, address, lines, total, delivery_fee, client_key)
  values (r.id, n, trim(p_name), trim(p_phone), coalesce(p_mode, 'pickup'), left(p_table, 20),
          case when p_mode = 'delivery' then left(trim(p_address), 200) end, priced, round(tot + fee, 2), round(fee, 2), ck) returning * into o;
  return jsonb_build_object('number', o.number, 'token', o.public_token, 'total', o.total, 'deliveryFee', o.delivery_fee);
end $$;

-- ------------------------------------------------------------------ grants
grant execute on function public.admin_status(), public.admin_set_platform(jsonb),
                          public.record_payment(uuid, numeric, text, text, int, text, text, text),
                          public.admin_delete_restaurant(uuid, text), public.admin_set_plan(uuid, text, int),
                          public.console_restaurants(), public.console_overview(int) to authenticated;
grant execute on function public.place_online_order(text, text, text, text, jsonb, text, text) to anon, authenticated;
