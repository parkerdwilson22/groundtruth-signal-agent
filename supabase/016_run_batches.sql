-- GroundTruth — group agent_runs into identifiable batches.
--
-- The "last sweep" panel originally inferred a batch by time proximity,
-- which is fragile: any manual run or backfill near the same time gets
-- swept in, and the panel then reports numbers that never happened. A run
-- either belongs to a sweep or it doesn't — that is a fact worth storing,
-- not guessing.

alter table agent_runs add column if not exists batch_id uuid;
create index if not exists agent_runs_batch_idx on agent_runs(batch_id, created_at desc);

-- Backfill the one sweep that has already happened (2026-07-28 16:49–16:51 UTC):
-- its three drafted leads, plus the six that were capped by that same run.
do $$
declare
  b uuid := gen_random_uuid();
begin
  update agent_runs
     set batch_id = b
   where batch_id is null
     and (
       (step = 'sweep-draft' and created_at between '2026-07-28 16:45:00+00'
                                               and '2026-07-28 16:55:00+00')
       or (run_status = 'capped' and step = 'signal')
     );
end $$;

-- Returns the most recent sweep batch only. Manual single-lead runs have no
-- batch_id and are correctly excluded.
create or replace function latest_sweep_batch()
returns table (
  batch        uuid,
  started_at   timestamptz,
  ended_at     timestamptz,
  drafted      bigint,
  capped       bigint,
  no_signal    bigint,
  errors       bigint
)
language sql stable
as $$
  with newest as (
    select batch_id
    from agent_runs
    where batch_id is not null
    order by created_at desc
    limit 1
  )
  select
    r.batch_id,
    min(r.created_at),
    max(r.created_at),
    count(*) filter (where r.run_status = 'signal_found'),
    count(*) filter (where r.run_status = 'capped'),
    count(*) filter (where r.run_status = 'no_signal'),
    count(*) filter (where r.run_status = 'error')
  from agent_runs r
  join newest n on n.batch_id = r.batch_id
  group by r.batch_id;
$$;

grant execute on function latest_sweep_batch() to anon, authenticated;
