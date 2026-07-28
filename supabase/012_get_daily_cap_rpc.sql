-- Narrow, single-purpose read of app_config — NOT a generic "get any config
-- key" function. That would let the public anon key read
-- zapier_catch_hook_url too (it's public-facing in the frontend bundle),
-- re-opening the exact leak app_config's missing RLS policy was preventing.
-- This function can only ever return the daily cap.
create or replace function get_daily_lead_cap() returns integer
language sql stable
security definer
set search_path = public
as $$
  select coalesce((select value from app_config where key = 'daily_lead_cap')::integer, 3);
$$;

grant execute on function get_daily_lead_cap() to anon, authenticated;
