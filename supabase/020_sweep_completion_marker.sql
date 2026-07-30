-- GroundTruth: don't let the sweep-completion bookkeeping row count as a
-- declined lead.
--
-- The sweep now writes one unconditional row per invocation (step
-- 'sweep-complete') so a real, unattended run that finds zero new permits
-- is still visible, instead of looking identical to the cron never firing.
-- That marker uses run_status 'no_signal' with no lead_id attached, since
-- it isn't a judgment about any property. latest_sweep_batch() must exclude
-- it from the "declined" count, or every batch's summary is off by one.

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
    count(*) filter (where r.run_status = 'no_signal' and r.step <> 'sweep-complete'),
    count(*) filter (where r.run_status = 'error')
  from agent_runs r
  join newest n on n.batch_id = r.batch_id
  group by r.batch_id;
$$;

grant execute on function latest_sweep_batch() to anon, authenticated;
