-- Checks for 0003: branches (limits, plan, sales summary only for the owner), delivery orders, ended trials.
-- Run after test_console.sql on the same database (it makes users a@x and me@x, and restaurant mamarudos).
\set ON_ERROR_STOP on
\i migrations/0003_branches_delivery_trial.sql
insert into auth.users values ('22222222-2222-2222-2222-222222222222', 'b@x');
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select id as rid from public.restaurants where slug = 'mamarudos' \gset

-- mamarudos is on the 'restaurant' plan after test_console: no branches on that plan
do $$ begin
  begin perform public.create_branch((select id from public.restaurants where slug = 'mamarudos'), 'Rudo Two', 'rudo-two'); raise exception 'FAIL branch on single plan';
  exception when others then if sqlerrm like 'Branches come with the Group plan%' then raise notice 'ok single plan: no branches'; else raise; end if; end;
end $$;
reset role;
update public.restaurants set plan = 'group' where slug = 'mamarudos';
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.create_branch(:'rid', 'Rudo Avondale', 'rudo-avondale', 'Harare') as b1 \gset
select public.create_branch(:'rid', 'Rudo Borrowdale', 'rudo-borrowdale') is not null as b2;
select public.create_branch(:'b1', 'Rudo Kadoma', 'rudo-kadoma') is not null as branch_of_branch_joins_group;
select public.create_branch(:'rid', 'Rudo Gweru', 'rudo-gweru') is not null as b4;
do $$ begin
  begin perform public.create_branch((select id from public.restaurants where slug = 'mamarudos'), 'Rudo Six', 'rudo-six'); raise exception 'FAIL sixth branch';
  exception when others then if sqlerrm like '%up to 5 branches%' then raise notice 'ok at most 5'; else raise; end if; end;
end $$;
select count(*) = 5 and bool_and(group_id = :'rid') and bool_and(plan = 'group') as group_of_five from public.restaurants where slug like 'rudo%' or slug = 'mamarudos';

-- sales summary per branch: today, week; training and cancelled left out
select public.push_records(:'b1', jsonb_build_array(
  jsonb_build_object('kind','orders','id','a','data',jsonb_build_object('total',10,'createdAt',now())),
  jsonb_build_object('kind','orders','id','b','data',jsonb_build_object('total',5,'createdAt',now() - interval '3 days')),
  jsonb_build_object('kind','orders','id','c','data',jsonb_build_object('total',99,'createdAt',now(),'training',true)),
  jsonb_build_object('kind','orders','id','d','data',jsonb_build_object('total',50,'createdAt',now(),'status','cancelled')),
  jsonb_build_object('kind','orders','id','e','data',jsonb_build_object('total',7,'createdAt',now() - interval '30 days'))), 'till-b1') is not null as pushed;
select orders_today = 1 and sales_today = 10 and orders_week = 2 and sales_week = 15 as summary_ok
  from public.group_summary(date_trunc('day', now()), now() - interval '7 days') where slug = 'rudo-avondale';
select count(*) = 5 as owner_sees_all_branches from public.group_summary(date_trunc('day', now()), now() - interval '7 days');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select count(*) = 0 as stranger_sees_no_branches from public.group_summary(date_trunc('day', now()), now() - interval '7 days');
select set_config('t.rid', :'rid', false) is not null as remembered;
do $$ begin
  begin perform public.create_branch(current_setting('t.rid')::uuid, 'Hijack', 'hijack'); raise exception 'FAIL stranger added branch';
  exception when insufficient_privilege then raise notice 'ok only the owner adds branches'; end;
end $$;

-- admin plan change follows the whole group; console shows the group
select pg_temp.as_user('99999999-9999-9999-9999-999999999999');
select public.admin_set_plan(:'rid', 'trial', 30);
select bool_and(plan = 'trial') as plan_follows_group from public.restaurants where group_id = :'rid';
select bool_and(group_name = 'Mama Rudo''s Kitchen') as console_shows_group from public.console_restaurants() where slug like 'rudo%';

-- delivery: only when offered, address needed, fee from the server
reset role;
update public.restaurants set online_orders = true, last_seen_at = now() where slug = 'rudo-avondale';
set role anon;
select pg_temp.as_user('');
do $$ begin
  begin perform public.place_online_order('rudo-avondale', 'Tino', '0771234567', 'delivery', '[{"itemId":"m1","qty":1}]'::jsonb, null, '12 Main St');
    raise exception 'FAIL delivery when not offered';
  exception when others then if sqlerrm like '%does not deliver%' then raise notice 'ok no delivery unless offered'; else raise; end if; end;
end $$;
reset role;
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.push_records(:'b1', '[{"kind":"public","id":"menu","data":{"items":[{"id":"m1","name":"Sadza","price":4,"available":true}],"delivery":{"on":true,"fee":1.5}}}]'::jsonb, 'till-b1') is not null as menu_published;
reset role;
set role anon;
select pg_temp.as_user('');
do $$ begin
  begin perform public.place_online_order('rudo-avondale', 'Tino', '0771234567', 'delivery', '[{"itemId":"m1","qty":1}]'::jsonb, null, '');
    raise exception 'FAIL delivery without address';
  exception when others then if sqlerrm like '%delivery address%' then raise notice 'ok address needed'; else raise; end if; end;
end $$;
select (public.place_online_order('rudo-avondale', 'Tino', '0771234567', 'delivery', '[{"itemId":"m1","qty":2}]'::jsonb, null, '12 Main St, Avondale')) as o \gset
select (:'o'::jsonb->>'total')::numeric = 9.5 and (:'o'::jsonb->>'deliveryFee')::numeric = 1.5 as delivery_fee_added;
select (public.online_order_status((:'o'::jsonb->>'token')::uuid)->>'address') = '12 Main St, Avondale' as status_shows_address;
reset role;
update public.online_orders set status = 'out' where delivery_fee > 0;
select count(*) = 1 as out_for_delivery_allowed from public.online_orders where status = 'out';

-- ended trial: public pages stop
update public.restaurants set web_page = true, trial_ends_at = now() - interval '10 days' where slug = 'rudo-avondale';
set role anon;
select public.public_menu('rudo-avondale') is null as ended_trial_hides_menu;
do $$ begin
  begin perform public.place_online_order('rudo-avondale', 'Tino', '0779999999', 'pickup', '[{"itemId":"m1","qty":1}]'::jsonb);
    raise exception 'FAIL order on ended trial';
  exception when others then if sqlerrm like '%not taking online orders%' then raise notice 'ok ended trial takes no orders'; else raise; end if; end;
end $$;
reset role;
update public.restaurants set trial_ends_at = now() - interval '1 day' where slug = 'rudo-avondale';
set role anon;
select public.public_menu('rudo-avondale') is not null as grace_days_still_open;
reset role;
