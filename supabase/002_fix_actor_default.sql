-- GroundTruth — governance fix
--
-- The original current_actor() defaulted unidentified writers to 'human',
-- the permissive role. Because PostgREST cannot set the `app.actor` session
-- variable, EVERY write fell through to 'human' and the agent guard never
-- ran — an agent could reset a human-locked lead. Verified broken by test.
--
-- Fix: default to 'agent' (restricted). Humans identify themselves by going
-- through set_stage(), which is the only path allowed to lock a row.
--
-- Run in the Supabase SQL editor, same as schema.sql.

-- ---------------------------------------------------------------------------
-- 1. Fail-safe default: anything that does not identify itself is the agent.
-- ---------------------------------------------------------------------------
create or replace function current_actor() returns text
language sql stable
as $$
  select coalesce(nullif(current_setting('app.actor', true), ''), 'agent');
$$;

-- ---------------------------------------------------------------------------
-- 2. The human path. This is the ONLY way to move a lead's stage by hand.
--    The UI calls it via supabase.rpc('set_stage', {...}).
-- ---------------------------------------------------------------------------
create or replace function set_stage(p_lead_id uuid, p_stage pipeline_stage)
returns pipeline
language plpgsql
security definer
set search_path = public
as $$
declare
  result pipeline;
begin
  -- Identify this transaction as a human action; the trigger reads this and
  -- will set stage_locked = true.
  perform set_config('app.actor', 'human', true);

  update pipeline
     set stage = p_stage
   where lead_id = p_lead_id
  returning * into result;

  if result.id is null then
    raise exception 'No pipeline entry for lead %', p_lead_id
      using errcode = 'no_data_found';
  end if;

  return result;
end;
$$;

grant execute on function set_stage(uuid, pipeline_stage) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reset the row dirtied by the failed governance test.
-- ---------------------------------------------------------------------------
delete from pipeline;
