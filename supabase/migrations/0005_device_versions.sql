-- 0005: which app version every device runs, for the TechPlug owner console.
-- Devices already report themselves as 'device' records (kind = 'device', id = the device's id, data = version,
-- Windows app version, platform, till number). Restaurant owners read their own through the normal rules;
-- this lets TechPlug admins see them for every restaurant.

create or replace function public.console_devices()
returns table (restaurant_id uuid, device_id text, data jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select r.restaurant_id, r.id, r.data, r.updated_at
  from records r
  where r.kind = 'device' and not r.deleted
  order by r.updated_at desc;
end $$;

revoke all on function public.console_devices() from public, anon;
grant execute on function public.console_devices() to authenticated;
