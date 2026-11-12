-- Checks: restaurants are separated, customers only see the safe menu, prices come from the server.
\set ON_ERROR_STOP on
grant usage on schema public to anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant insert on public.app_events to anon;
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'a@x'), ('22222222-2222-2222-2222-222222222222', 'b@x'), ('99999999-9999-9999-9999-999999999999', 'me@x');
insert into public.platform_admins values ('99999999-9999-9999-9999-999999999999');

create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

-- Owner A creates Mama Rudo's; owner B creates Sunset Grill
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.create_restaurant('Mama Rudo''s Kitchen', 'mamarudos', 'Harare') as rid_a \gset
select public.push_records(:'rid_a', '[{"kind":"order","id":"o-1","data":{"total":13}},
  {"kind":"public","id":"menu","data":{"items":[{"id":"sb","name":"Sadza & Beef","price":4,"available":true,"addOnIds":["xm"]},{"id":"fish","name":"Sadza & Fish","price":5,"available":false}],
   "addOns":[{"id":"xm","name":"Extra meat","price":1.5,"available":true}],"categories":[]}}]'::jsonb, 'till-1') is not null as pushed;
update public.restaurants set web_page = true, qr_menu = true, online_orders = true where id = :'rid_a';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select public.create_restaurant('Sunset Grill', 'sunset-grill', 'Bulawayo') as rid_b \gset

-- B cannot see or change A's data
select count(*) = 0 as b_cannot_read_a from public.records where restaurant_id = :'rid_a';
select count(*) = 1 as b_sees_only_own_restaurant from public.restaurants;
do $$ begin
  perform public.push_records((select id from public.restaurants where slug = 'mamarudos' limit 1), '[]'::jsonb);
  raise exception 'should not get here';
exception when others then
  if sqlerrm like '%not a member%' or sqlerrm like '%null%' then raise notice 'ok: B blocked from pushing to A'; else raise; end if;
end $$;
update public.records set data = '{"total":0}' where restaurant_id = :'rid_a';  -- silently 0 rows
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select (data->>'total')::int = 13 as a_data_untouched from public.records where restaurant_id = :'rid_a' and id = 'o-1';
select count(*) = 2 as a_reads_own from public.records where restaurant_id = :'rid_a';

-- Customer (not logged in)
reset role; set role anon; select pg_temp.as_user('');
select (public.public_menu('mamarudos')->>'online')::boolean as menu_online, jsonb_array_length(public.public_menu('mamarudos')->'items') = 2 as two_items;
select public.public_menu('sunset-grill') is null as switched_off_restaurant_hidden;
do $$ begin perform 1 from public.records; raise exception 'anon read records'; exception when insufficient_privilege then raise notice 'ok: anon cannot read records'; end $$;
-- prices from the server: phone claims a free meal, server charges 2 x (4 + 1.50)
select public.place_online_order('mamarudos', 'Tatenda', '077 123 4567', 'pickup', '[{"itemId":"sb","qty":2,"unitPrice":0,"extras":["xm"]}]'::jsonb) as ord \gset
select (:'ord'::jsonb->>'total')::numeric = 11.00 as server_priced, (:'ord'::jsonb->>'number')::int = 1 as number_1;
select public.online_order_status((:'ord'::jsonb->>'token')::uuid)->>'status' = 'new' as status_page;
do $$ begin perform public.place_online_order('mamarudos', 'X', '0771111111', 'pickup', '[{"itemId":"fish","qty":1}]'::jsonb); raise exception 'sold out accepted';
exception when others then if sqlerrm like 'Sold out%' then raise notice 'ok: sold out refused'; else raise; end if; end $$;
select public.slug_available('mamarudos') = false as slug_taken, public.slug_available('new-place') as slug_free, public.slug_available('admin') = false as slug_reserved;
insert into public.app_events (kind, platform) values ('download_click', 'windows');

-- Owner A sees the online order; B does not; owner console only for admin
reset role; set role authenticated; select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select count(*) = 1 as a_sees_online_order from public.online_orders;
update public.online_orders set status = 'accepted', ready_minutes = 15;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select count(*) = 0 as b_no_online_orders from public.online_orders;
do $$ begin perform public.console_overview(); raise exception 'console open'; exception when insufficient_privilege then raise notice 'ok: console closed to restaurants'; end $$;
select pg_temp.as_user('99999999-9999-9999-9999-999999999999');
select (public.console_overview()->>'restaurants')::int = 2 as console_restaurants, (public.console_overview()->>'downloads')::int = 1 as console_downloads, (public.console_overview()->>'signups')::int = 2 as console_signups;
