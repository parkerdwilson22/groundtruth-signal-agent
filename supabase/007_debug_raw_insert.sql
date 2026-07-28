-- Temporary diagnostic. Does a raw SQL insert into pipeline (bypassing
-- PostgREST/the API entirely) fire the trigger? Isolates whether the problem
-- is the trigger itself or something specific to how the app inserts rows.
create or replace function debug_test_trigger_fire()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  test_lead_id  uuid;
  test_draft_id uuid;
  new_pipeline_id uuid;
begin
  select id into test_lead_id from leads limit 1;

  insert into drafts (lead_id, shot_list, outreach_subject, outreach_body, best_shoot_window)
  values (test_lead_id, '["debug shot"]'::jsonb, 'debug subject', 'debug body', 'debug window')
  returning id into test_draft_id;

  delete from pipeline where lead_id = test_lead_id;

  insert into pipeline (lead_id, draft_id, stage)
  values (test_lead_id, test_draft_id, 'new_signal')
  returning id into new_pipeline_id;

  return new_pipeline_id;
end;
$$;

grant execute on function debug_test_trigger_fire() to anon, authenticated;
