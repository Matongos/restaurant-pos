-- TechPlug POS — step 2: owner console, plan protection, online menu details.
-- Run once in the Supabase SQL Editor after 0001 (paste all, Run). Safe to run again.

-- 1. Restaurant owners may change their customer-facing details, but not their plan or trial date.
revoke update on public.restaurants from anon, authenticated;
grant update (name, town, web_page, qr_menu, online_orders, public_info) on public.restaurants to authenticated;

-- 2. TechPlug admins change a restaurant's plan or give more trial days.
create or replace function public.admin_set_plan(p_restaurant uuid, p_plan text, p_trial_days int default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_plan not in ('trial', 'restaurant', 'group', 'free', 'closed') then raise exception 'unknown plan' using errcode = 'P0001'; end if;
  update restaurants
     set plan = p_plan,
         trial_ends_at = case when p_trial_days is null then trial_ends_at else now() + make_interval(days => p_trial_days) end
   where id = p_restaurant;
end $$;

-- 3. Every restaurant for the owner console, with the owner's email and how busy it is.
create or replace function public.console_restaurants()
returns table (id uuid, name text, slug text, town text, plan text, trial_ends_at timestamptz, created_at timestamptz,
               last_seen_at timestamptz, owner_email text, devices bigint, orders bigint, web_page boolean, qr_menu boolean,
               online_orders boolean, online_orders_count bigint)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select r.id, r.name, r.slug, r.town, r.plan, r.trial_ends_at, r.created_at, r.last_seen_at,
         (select u.email::text from members m join auth.users u on u.id = m.user_id where m.restaurant_id = r.id and m.role = 'owner' limit 1),
         (select count(distinct x.device_id) from records x where x.restaurant_id = r.id and x.device_id is not null),
         (select count(*) from records x where x.restaurant_id = r.id and x.kind = 'orders' and not x.deleted),
         r.web_page, r.qr_menu, r.online_orders,
         (select count(*) from online_orders o where o.restaurant_id = r.id)
  from restaurants r
  order by r.created_at desc;
end $$;

-- 4. A device's own restaurant details (plan, trial, switches) — any member may read them (RLS already allows).

-- 5. The public menu also says which slug it is and whether ordering from a table is on.
create or replace function public.public_menu(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r restaurants; m records;
begin
  select * into r from restaurants where slug = lower(p_slug) and plan <> 'closed';
  if not found or not (r.web_page or r.qr_menu) then return null; end if;
  select * into m from records where restaurant_id = r.id and kind = 'public' and id = 'menu' and not deleted;
  return jsonb_build_object(
    'slug', r.slug, 'name', r.name, 'town', r.town, 'currency', r.currency, 'info', r.public_info,
    'webPage', r.web_page, 'qrMenu', r.qr_menu, 'onlineOrders', r.online_orders,
    'online', coalesce(r.last_seen_at > now() - interval '3 minutes', false),
    'updatedAt', m.updated_at,
    'categories', coalesce(m.data->'categories', '[]'::jsonb),
    'items', coalesce(m.data->'items', '[]'::jsonb),
    'addOns', coalesce(m.data->'addOns', '[]'::jsonb),
    'symbol', coalesce(m.data->>'symbol', '$'),
    'tagline', m.data->>'tagline', 'logo', m.data->>'logo', 'brandColor', m.data->>'brandColor');
end $$;

-- 6. Customers can cancel their own order while the restaurant has not accepted it yet.
create or replace function public.cancel_online_order(p_token uuid) returns boolean
language sql security definer set search_path = public as $$
  update online_orders set status = 'cancelled' where public_token = p_token and status = 'new' returning true;
$$;

grant execute on function public.admin_set_plan(uuid, text, int), public.console_restaurants() to authenticated;
grant execute on function public.public_menu(text), public.cancel_online_order(uuid) to anon, authenticated;
