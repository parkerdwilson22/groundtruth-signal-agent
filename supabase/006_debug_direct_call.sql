-- Temporary diagnostic. Calls net.http_post directly (no trigger involved) to
-- isolate whether pg_net itself works on this project, or whether the
-- trigger is the problem.
create or replace function debug_direct_webhook_test()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  hook_url text;
  req_id   bigint;
begin
  select value into hook_url from app_config where key = 'zapier_catch_hook_url';
  select net.http_post(
    url     := hook_url,
    body    := jsonb_build_object('event', 'direct_debug_test', 'source', 'debug_direct_webhook_test'),
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into req_id;
  return req_id;
end;
$$;

grant execute on function debug_direct_webhook_test() to anon, authenticated;

-- Also: is the pipeline trigger actually registered on the table?
create or replace function debug_list_pipeline_triggers()
returns table (trigger_name text, event_manipulation text, action_timing text)
language sql
security definer
set search_path = public
as $$
  select trigger_name, event_manipulation, action_timing
  from information_schema.triggers
  where event_object_table = 'pipeline';
$$;

grant execute on function debug_list_pipeline_triggers() to anon, authenticated;
