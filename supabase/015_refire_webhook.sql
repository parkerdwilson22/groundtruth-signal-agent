-- GroundTruth — re-send an existing draft to Zapier, with no AI spend.
--
-- The webhook fires on INSERT into pipeline. That means iterating on how a
-- draft *looks* (spacing, signature, calendar layout) only requires
-- re-firing the trigger — the email text and contact are already stored, so
-- no model call is needed. Regenerating the *wording* is the only thing that
-- costs anything.
--
--   select refire_webhook('<lead uuid>');
--
-- Refuses to touch a lead a human has already moved (§3 governance): a
-- locked lead has been acted on, and re-sending its draft would put a stale
-- email back in the inbox.

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

  -- Delete + re-insert so the AFTER INSERT trigger fires again. Safe because
  -- the row is unlocked and we restore the same lead_id and draft_id.
  delete from pipeline where id = entry.id;
  insert into pipeline (lead_id, draft_id, stage)
  values (entry.lead_id, entry.draft_id, 'new_signal');

  return format('Re-sent draft for lead %s to Zapier.', p_lead_id);
end;
$$;

grant execute on function refire_webhook(uuid) to anon, authenticated;
