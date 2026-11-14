-- Checks for 0004: the console needs two-step login, payments extend the plan for the whole group,
-- owners see only their own payments, overdue restaurants pause, deleting needs the exact name.
-- Run after test_console.sql and test_branches.sql on the same database.
\set ON_ERROR_STOP on
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
grant execute on function auth.jwt() to anon, authenticated;
\i migrations/0004_payments_security.sql
create function pg_temp.as_admin(aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
  perform set_config('request.jwt.claims', json_build_object('sub', '99999999-9999-9999-9999-999999999999', 'aal', aal)::text, false);
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal1"}', false);
end $$;
select id as rid from public.restaurants where slug = 'mamarudos' \gset
select id as b1 from public.restaurants where slug = 'rudo-avondale' \gset
set role authenticated;

-- password only (aal1): no console
select pg_temp.as_admin('aal1');
select (public.admin_status()->>'admin')::boolean and not (public.admin_status()->>'aal2')::boolean as admin_without_code;
do $$ begin
  begin perform public.console_restaurants(); raise exception 'FAIL console without code'; exception when insufficient_privilege then raise notice 'ok console needs the code'; end;
  begin perform public.record_payment((select id from public.restaurants where slug = 'mamarudos'), 35, 'cash', 'group', 1); raise exception 'FAIL payment without code';
  exception when insufficient_privilege then raise notice 'ok payments need the code'; end;
end $$;

-- with the code (aal2)
select pg_temp.as_admin('aal2');
select count(*) >= 5 as console_with_code from public.console_restaurants();
select public.record_payment(:'b1', 35, 'ecocash', 'group', 1, 'MP261114.1234') is not null as paid;
select bool_and(plan = 'group') and bool_and(paid_until > now() + interval '27 days') as whole_group_paid
  from public.restaurants where group_id = :'rid';
select public.record_payment(:'rid', 70, 'cash', 'group', 2) as until2 \gset
select :'until2'::timestamptz > now() + interval '85 days' as extends_from_current_end;
select count(*) = 2 and bool_and(restaurant_id = :'rid') as payments_on_main from public.payments;
select count(*) >= 2 as admin_log_written from public.admin_log where action = 'payment';
select public.admin_set_platform('{"whatsapp":"263771234567","payInstructions":"EcoCash merchant 12345"}');
select pg_temp.as_owner();
select data->>'whatsapp' = '263771234567' as owner_reads_platform_settings from public.platform_settings;
select count(*) = 2 as owner_sees_own_payments from public.payments;
do $$ begin
  begin perform public.admin_set_platform('{}'); raise exception 'FAIL owner edited platform'; exception when insufficient_privilege then raise notice 'ok platform settings admin-only'; end;
  begin insert into public.payments (restaurant_id, amount, method, plan, months) values ((select id from public.restaurants where slug = 'mamarudos'), 1, 'cash', 'group', 12);
    raise exception 'FAIL owner recorded own payment'; exception when insufficient_privilege then raise notice 'ok owners cannot add payments'; end;
end $$;
reset role;
insert into auth.users values ('33333333-3333-3333-3333-333333333333', 'c@x');
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false) is not null as as_stranger;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false) is not null as claims;
select count(*) = 0 as stranger_sees_no_payments from public.payments;
reset role;

-- overdue: paid time over by more than 3 days → paused (public menu gone); within 3 days still open
update public.restaurants set web_page = true, paid_until = now() - interval '5 days' where slug = 'rudo-avondale';
set role anon;
select public.public_menu('rudo-avondale') is null as overdue_pauses;
reset role;
update public.restaurants set paid_until = now() - interval '1 day' where slug = 'rudo-avondale';
set role anon;
select public.public_menu('rudo-avondale') is not null as overdue_grace;
reset role;

-- delete needs the exact name and no branches left
set role authenticated;
select pg_temp.as_admin('aal2');
do $$ begin
  begin perform public.admin_delete_restaurant((select id from public.restaurants where slug = 'rudo-gweru'), 'wrong name'); raise exception 'FAIL deleted with wrong name';
  exception when others then if sqlerrm like '%does not match%' then raise notice 'ok name must match'; else raise; end if; end;
  begin perform public.admin_delete_restaurant((select id from public.restaurants where slug = 'mamarudos'), 'Mama Rudo''s Kitchen'); raise exception 'FAIL deleted main with branches';
  exception when others then if sqlerrm like '%branches first%' then raise notice 'ok branches first'; else raise; end if; end;
end $$;
select public.admin_delete_restaurant((select id from public.restaurants where slug = 'rudo-gweru'), 'Rudo Gweru');
select not exists (select 1 from public.restaurants where slug = 'rudo-gweru') as deleted;
reset role;
select count(*) = 1 as delete_logged from public.admin_log where action = 'delete_restaurant';

-- spam: one connection, many orders
update public.restaurants set online_orders = true, last_seen_at = now(), paid_until = now() + interval '20 days' where slug = 'rudo-avondale';
set role anon;
select set_config('request.headers', '{"cf-connecting-ip":"41.1.2.3"}', false) is not null as from_one_phone;
select public.place_online_order('rudo-avondale', 'A', '0771000001', 'pickup', '[{"itemId":"m1","qty":1}]'::jsonb) is not null as o1;
select public.place_online_order('rudo-avondale', 'B', '0771000002', 'pickup', '[{"itemId":"m1","qty":1}]'::jsonb) is not null as o2;
select public.place_online_order('rudo-avondale', 'C', '0771000003', 'pickup', '[{"itemId":"m1","qty":1}]'::jsonb) is not null as o3;
do $$ begin
  begin perform public.place_online_order('rudo-avondale', 'D', '0771000004', 'pickup', '[{"itemId":"m1","qty":1}]'::jsonb); raise exception 'FAIL fourth order from one connection';
  exception when others then if sqlerrm like 'Too many orders from this phone%' then raise notice 'ok one connection limited'; else raise; end if; end;
end $$;
select set_config('request.headers', '{"cf-connecting-ip":"41.9.9.9"}', false) is not null as other_phone;
select public.place_online_order('rudo-avondale', 'E', '0771000005', 'pickup', '[{"itemId":"m1","qty":1}]'::jsonb) is not null as other_connection_ok;
select set_config('request.headers', '', false) is not null as cleared;
reset role;
