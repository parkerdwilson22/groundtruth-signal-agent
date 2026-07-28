-- GroundTruth — webhook diagnostics
--
-- Temporary. Exposes pg_net's internal request/response log through a
-- callable function so we can see whether the trigger actually fired and
-- what Zapier's endpoint said back, without needing direct psql access.
-- Safe to drop once the webhook is confirmed working end to end.

create or replace function debug_webhook_log()
returns table (
  request_id  bigint,
  created     timestamptz,
  status_code integer,
  content     text,
  error_msg   text
)
language sql
security definer
set search_path = public, extensions, net
as $$
  select
    r.id,
    r.created,
    r.status_code,
    left(r.content, 500),
    r.error_msg
  from net._http_response r
  order by r.created desc
  limit 10;
$$;

grant execute on function debug_webhook_log() to anon, authenticated;

-- Sanity check: is pg_net actually installed, and where?
create or replace function debug_pg_net_status()
returns table (extname text, extnamespace_name text)
language sql
security definer
set search_path = public
as $$
  select e.extname, n.nspname
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_net';
$$;

grant execute on function debug_pg_net_status() to anon, authenticated;
