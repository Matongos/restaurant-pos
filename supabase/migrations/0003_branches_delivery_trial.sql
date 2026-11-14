-- TechPlug POS — step 3: branches (the $35 plan), delivery for online orders, ending trials.
-- Run once in the Supabase SQL Editor after 0001 and 0002 (paste all, Run). Safe to run again.

-- ------------------------------------------------------------------ 1. branches
-- A group is the main restaurant plus up to 4 more branches (5 in all). Every restaurant of a group has
-- group_id = the main restaurant's id. The plan and trial follow the main restaurant.
alter table public.restaurants add column if not exists group_id uuid references public.restaurants(id) on delete set null;
create index if not exists restaurants_group on public.restaurants(group_id);

-- Is the restaurant's trial over (3 days' grace) or closed? Then the tills lock and the public pages stop.
create or replace function public.restaurant_locked(r public.restaurants) returns boolean
language sql immutable as $$
  select r.plan = 'closed' or (r.plan = 'trial' and r.trial_ends_at < now() - interval '3 days');
$$;

-- The owner adds a branch. It becomes part of the main restaurant's group and gets the same plan and trial.
create or replace function public.create_branch(p_main uuid, p_name text, p_slug text, p_town text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare m restaurants; rid uuid; n int;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into m from restaurants where id = p_main;
  if not found then raise exception 'restaurant not found' using errcode = 'P0001'; end if;
  if not exists (select 1 from members where restaurant_id = p_main and user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the owner can add a branch' using errcode = '42501';
  end if;
  -- a branch of a branch belongs to the same group
  if m.group_id is not null and m.group_id <> m.id then select * into m from restaurants where id = m.group_id; end if;
  if m.plan not in ('trial', 'group', 'free') then
    raise exception 'Branches come with the Group plan ($35 a month for up to 5 branches). Ask TechPlug to switch your plan.' using errcode = 'P0001';
  end if;
  select count(*) into n from restaurants where id = m.id or group_id = m.id;
  if n >= 5 then raise exception 'The Group plan has up to 5 branches' using errcode = 'P0001'; end if;
  update restaurants set group_id = m.id where id = m.id and group_id is null;
  insert into restaurants (name, slug, town, country, currency, plan, trial_ends_at, group_id)
  values (trim(p_name), lower(trim(p_slug)), p_town, m.country, m.currency, m.plan, m.trial_ends_at, m.id) returning id into rid;
  insert into members (restaurant_id, user_id, role) values (rid, auth.uid(), 'owner');
  return rid;
end $$;

-- Sales of every branch the signed-in owner belongs to, worked out on the server (no need to download
-- each branch's orders). Today and the last 7 days, without training orders or cancelled ones.
create or replace function public.group_summary(p_today timestamptz, p_week timestamptz)
returns table (id uuid, name text, slug text, town text, last_seen_at timestamptz, is_main boolean,
               orders_today bigint, sales_today numeric, orders_week bigint, sales_week numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  return query
  select r.id, r.name, r.slug, r.town, r.last_seen_at, coalesce(r.group_id = r.id, false),
         count(*) filter (where (x.data->>'createdAt')::timestamptz >= p_today),
         coalesce(sum((x.data->>'total')::numeric) filter (where (x.data->>'createdAt')::timestamptz >= p_today), 0),
         count(x.id),
         coalesce(sum((x.data->>'total')::numeric), 0)
  from restaurants r
  join members mb on mb.restaurant_id = r.id and mb.user_id = auth.uid() and mb.role in ('owner', 'manager')
  left join records x on x.restaurant_id = r.id and x.kind = 'orders' and not x.deleted
        and (x.data->>'createdAt')::timestamptz >= p_week
        and coalesce((x.data->>'training')::boolean, false) = false
        and coalesce(x.data->>'status', '') <> 'cancelled'
  group by r.id
  order by coalesce(r.group_id = r.id, false) desc, r.created_at;
end $$;

-- TechPlug admins: a plan change on the main restaurant applies to all its branches.
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
end $$;

-- The owner console also shows which group (main restaurant) a branch belongs to.
drop function if exists public.console_restaurants();
create function public.console_restaurants()
returns table (id uuid, name text, slug text, town text, plan text, trial_ends_at timestamptz, created_at timestamptz,
               last_seen_at timestamptz, owner_email text, devices bigint, orders bigint, web_page boolean, qr_menu boolean,
               online_orders boolean, online_orders_count bigint, group_id uuid, group_name text, branches bigint)
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
         (select count(*) from restaurants b where r.group_id = r.id and b.group_id = r.id)
  from restaurants r
  order by coalesce(r.group_id, r.id), r.group_id is distinct from r.id, r.created_at desc;
end $$;

-- ------------------------------------------------------------------ 2. delivery for online orders
alter table public.online_orders add column if not exists delivery_fee numeric(12, 2) not null default 0;
alter table public.online_orders drop constraint if exists online_orders_status_check;
alter table public.online_orders add constraint online_orders_status_check
  check (status in ('new', 'accepted', 'declined', 'ready', 'out', 'collected', 'cancelled'));

-- Customers order; delivery only when the restaurant offers it (published with the menu as
-- delivery: {on, fee, area}), with an address, and the delivery fee from the server.
create or replace function public.place_online_order(p_slug text, p_name text, p_phone text, p_mode text, p_lines jsonb, p_table text default null, p_address text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r restaurants; menu jsonb; ln jsonb; item jsonb; priced jsonb := '[]'::jsonb; tot numeric := 0; qty int; unit numeric; n int; o online_orders; fee numeric := 0;
begin
  select * into r from restaurants where slug = lower(p_slug) and plan <> 'closed';
  if not found or not r.online_orders or restaurant_locked(r) then raise exception 'This restaurant is not taking online orders' using errcode = 'P0001'; end if;
  if not coalesce(r.last_seen_at > now() - interval '3 minutes', false) then raise exception 'The restaurant is offline right now — please order at the counter' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 40 then raise exception 'Order is empty' using errcode = 'P0001'; end if;
  if coalesce(p_mode, 'pickup') not in ('pickup', 'delivery', 'table') then raise exception 'Unknown order type' using errcode = 'P0001'; end if;
  if (select count(*) from online_orders where restaurant_id = r.id and phone = trim(p_phone) and status in ('new', 'accepted', 'ready', 'out')) >= 5 then
    raise exception 'Too many open orders for this phone number' using errcode = 'P0001';
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
  insert into online_orders (restaurant_id, number, customer_name, phone, mode, table_name, address, lines, total, delivery_fee)
  values (r.id, n, trim(p_name), trim(p_phone), coalesce(p_mode, 'pickup'), left(p_table, 20),
          case when p_mode = 'delivery' then left(trim(p_address), 200) end, priced, round(tot + fee, 2), round(fee, 2)) returning * into o;
  return jsonb_build_object('number', o.number, 'token', o.public_token, 'total', o.total, 'deliveryFee', o.delivery_fee);
end $$;

create or replace function public.online_order_status(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', o.number, 'status', o.status, 'readyMinutes', o.ready_minutes, 'total', o.total,
                            'lines', o.lines, 'mode', o.mode, 'address', o.address, 'deliveryFee', o.delivery_fee,
                            'restaurant', r.name, 'createdAt', o.created_at, 'updatedAt', o.updated_at)
  from online_orders o join restaurants r on r.id = o.restaurant_id where o.public_token = p_token;
$$;

-- ------------------------------------------------------------------ 3. ended trials: the public pages stop too
create or replace function public.public_menu(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r restaurants; m records;
begin
  select * into r from restaurants where slug = lower(p_slug) and plan <> 'closed';
  if not found or not (r.web_page or r.qr_menu) or restaurant_locked(r) then return null; end if;
  select * into m from records where restaurant_id = r.id and kind = 'public' and id = 'menu' and not deleted;
  return jsonb_build_object(
    'slug', r.slug, 'name', r.name, 'town', r.town, 'currency', r.currency, 'info', r.public_info,
    'webPage', r.web_page, 'qrMenu', r.qr_menu, 'onlineOrders', r.online_orders,
    'online', coalesce(r.last_seen_at > now() - interval '3 minutes', false),
    'updatedAt', m.updated_at,
    'categories', coalesce(m.data->'categories', '[]'::jsonb),
    'items', coalesce(m.data->'items', '[]'::jsonb),
    'addOns', coalesce(m.data->'addOns', '[]'::jsonb),
    'delivery', coalesce(m.data->'delivery', '{"on": false}'::jsonb),
    'symbol', coalesce(m.data->>'symbol', '$'),
    'tagline', m.data->>'tagline', 'logo', m.data->>'logo', 'brandColor', m.data->>'brandColor');
end $$;

-- ------------------------------------------------------------------ grants
grant execute on function public.create_branch(uuid, text, text, text), public.group_summary(timestamptz, timestamptz),
                          public.admin_set_plan(uuid, text, int), public.console_restaurants() to authenticated;
grant execute on function public.public_menu(text), public.online_order_status(uuid),
                          public.place_online_order(text, text, text, text, jsonb, text, text) to anon, authenticated;
