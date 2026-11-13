-- Checks for 0002: owners cannot change their plan; the console is admin-only and lists restaurants.
\set ON_ERROR_STOP on
grant usage on schema public to anon, authenticated;
grant select, insert on all tables in schema public to authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'a@x'), ('99999999-9999-9999-9999-999999999999', 'me@x');
insert into public.platform_admins values ('99999999-9999-9999-9999-999999999999');
\i migrations/0002_console_and_online.sql
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.create_restaurant('Mama Rudo''s Kitchen', 'mamarudos', 'Harare') as rid \gset
select public.push_records(:'rid', '[{"kind":"orders","id":"o-1","data":{}},{"kind":"public","id":"menu","data":{"items":[],"symbol":"$"}}]'::jsonb, 'till-1') is not null as pushed;
update public.restaurants set web_page = true, public_info = '{"phone":"077"}' where id = :'rid';
select web_page and public_info->>'phone' = '077' as owner_can_edit_page from public.restaurants where id = :'rid';
do $$ begin
  begin update public.restaurants set plan = 'restaurant'; raise exception 'FAIL owner changed plan'; exception when insufficient_privilege then raise notice 'ok owner cannot change plan'; end;
  begin update public.restaurants set trial_ends_at = now() + interval '9 years'; raise exception 'FAIL owner extended trial'; exception when insufficient_privilege then raise notice 'ok owner cannot extend trial'; end;
  begin perform public.console_restaurants(); raise exception 'FAIL owner saw console'; exception when insufficient_privilege then raise notice 'ok console admin-only'; end;
  begin perform public.admin_set_plan((select id from public.restaurants limit 1), 'free'); raise exception 'FAIL owner set plan'; exception when insufficient_privilege then raise notice 'ok admin_set_plan admin-only'; end;
end $$;
select (public.public_menu('mamarudos')->>'slug') = 'mamarudos' and (public.public_menu('mamarudos')->>'symbol') = '$' as public_menu_ok;
select pg_temp.as_user('99999999-9999-9999-9999-999999999999');
select count(*) = 1 and bool_and(owner_email = 'a@x') and bool_and(orders = 1) and bool_and(devices = 1) as console_lists from public.console_restaurants();
select public.admin_set_plan(:'rid', 'restaurant', 14);
select plan = 'restaurant' and trial_ends_at > now() + interval '13 days' as admin_set_plan_ok from public.restaurants where id = :'rid';
reset role;
