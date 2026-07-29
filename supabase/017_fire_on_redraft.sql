-- GroundTruth — fire the handoff when a draft is REPLACED, not only when a
-- pipeline row is first created.
--
-- The webhook fired on INSERT only. Re-running the agent on a lead already in
-- the pipeline takes the UPDATE path (attach the new draft_id), so the app
-- produced a fresh draft and nothing ever reached Gmail — silently. A handoff
-- that quietly does nothing is worse than one that fails loudly.
--
-- Guarded so it fires ONLY when the draft itself changed:
--   - a human moving a card (stage change) must not re-send outreach
--   - a locked lead is never re-sent (§3 governance)

drop trigger if exists pipeline_redraft_webhook on pipeline;

create trigger pipeline_redraft_webhook
  after update on pipeline
  for each row
  when (
    new.draft_id is distinct from old.draft_id
    and new.draft_id is not null
    and new.stage = 'new_signal'
    and not new.stage_locked
  )
  execute function notify_zapier_new_signal();

-- Also install refire_webhook() if it isn't present yet: re-sends an existing
-- draft with no model call, so email formatting can be iterated on for free.
create or replace function refire_webhook(p_lead_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  entry pipeline%rowtype;
begin
  select * into entry from pipeline where lead_id = p_lead_id;

  if entry.id is null then
    return format('No pipeline entry for lead %s', p_lead_id);
  end if;

  if entry.stage_locked then
    return format(
      'Refused: lead %s is locked at stage %s. Re-sending would push a stale draft.',
      p_lead_id, entry.stage
    );
  end if;

  delete from pipeline where id = entry.id;
  insert into pipeline (lead_id, draft_id, stage)
  values (entry.lead_id, entry.draft_id, 'new_signal');

  return format('Re-sent draft for lead %s to Zapier.', p_lead_id);
end;
$$;

grant execute on function refire_webhook(uuid) to anon, authenticated;
