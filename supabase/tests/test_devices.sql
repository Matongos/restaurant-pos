-- Run after test_payments.sql's auth.jwt() stand-in (or Supabase). Checks: devices report their version; owners see their own devices; only TechPlug admins see all.
\set ON_ERROR_STOP on
grant usage on schema public to anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'a@x'), ('22222222-2222-2222-2222-222222222222', 'b@x'), ('99999999-9999-9999-9999-999999999999', 'me@x');
insert into public.platform_admins values ('99999999-9999-9999-9999-999999999999');
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.create_restaurant('Mama Rudo''s Kitchen', 'mamarudos', 'Harare') as rid_a \gset
select public.push_records(:'rid_a', '[{"kind":"device","id":"dev-1","data":{"build":"2026.11.16-abc1234","desktop":"1.1.1","platform":"Windows app","tillNo":1}}]'::jsonb, 'dev-1') is not null as reported;
select count(*) = 1 as owner_sees_own_device from public.records where restaurant_id = :'rid_a' and kind = 'device';
do $$ begin perform public.console_devices(); raise exception 'owner saw all devices'; exception when insufficient_privilege then raise notice 'ok: owner cannot list every restaurant''s devices'; end $$;

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select count(*) = 0 as other_owner_sees_nothing from public.records where kind = 'device';

select pg_temp.as_user('99999999-9999-9999-9999-999999999999');
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","aal":"aal2"}', false);
select count(*) = 1 and bool_and(data->>'build' = '2026.11.16-abc1234') as admin_sees_versions from public.console_devices();
