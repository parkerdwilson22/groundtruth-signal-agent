-- GroundTruth: remove em dashes from anything a recipient sees.
--
-- Em dashes read as machine-written, which undercuts a cold email that is
-- supposed to look like a working professional wrote it. The model is now
-- instructed never to produce them; this strips the ones the payload builder
-- was adding itself, in the calendar title and description.
--
-- Uses chr(8212) / chr(8211) rather than typing the literal em/en dash
-- characters into this file. An earlier version with the real characters
-- failed to apply; non-ASCII bytes can be mangled in transit through a
-- clipboard or editor, and a dash-removal script failing because of a dash
-- is a needless risk. chr() keeps this file pure ASCII.

create or replace function notify_zapier_new_signal() returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  hook_url  text;
  signature text;
  payload   jsonb;
  l         leads%rowtype;
  d         drafts%rowtype;
  shots     text;
  em        text := chr(8212);
  en        text := chr(8211);
begin
  if new.stage <> 'new_signal' then
    return new;
  end if;

  select value into hook_url  from app_config where key = 'zapier_catch_hook_url';
  select value into signature from app_config where key = 'email_signature';

  if hook_url is null or hook_url = '' then
    raise warning 'GroundTruth: no zapier_catch_hook_url configured; skipping webhook';
    return new;
  end if;

  select * into l from leads  where id = new.lead_id;
  select * into d from drafts where id = new.draft_id;

  select coalesce(
           string_agg(numbered.rn::text || '. ' || numbered.shot, e'\n'),
           ''
         )
    into shots
    from (
      select row_number() over () as rn, shot
      from jsonb_array_elements_text(coalesce(d.shot_list, '[]'::jsonb)) as shot
    ) numbered;

  payload := jsonb_build_object(
    'event',             'new_signal',
    'pipeline_id',       new.id,
    'stage',             new.stage,
    'address',           coalesce(l.address, ''),
    'city',              coalesce(l.city, ''),
    'state',             coalesce(l.state, ''),
    'lat',               l.lat,
    'lon',               l.lon,
    'price',             l.price,
    'contact_type',      coalesce(l.contact_type, ''),
    'contact_name',      coalesce(l.listing_agent, ''),
    'contact_source',    coalesce(l.contact_source, ''),
    'agent_email',       coalesce(l.agent_email, ''),
    'agent_phone',       coalesce(l.agent_phone, ''),
    -- Belt and braces: strip any dash the model slipped through anyway.
    'email_subject',     replace(replace(coalesce(d.outreach_subject, ''), em, ','), en, ','),
    'email_body',        replace(replace(coalesce(d.outreach_body, ''), em, ','), en, ',') ||
                         case when signature is null or signature = ''
                              then ''
                              else e'\n\n' || signature end,
    'shoot_window_text', replace(replace(coalesce(d.best_shoot_window, ''), em, ','), en, ','),
    'shoot_date_iso',    coalesce(d.shoot_date_iso::text, ''),
    'shoot_start_iso',   coalesce(d.shoot_start_iso::text, ''),
    'shoot_end_iso',     coalesce(d.shoot_end_iso::text, ''),
    'time_rationale',    replace(replace(coalesce(d.time_rationale, ''), em, ','), en, ','),
    'shot_list',         replace(replace(shots, em, ','), en, ','),
    'calendar_title',    'Drone shoot (tentative): ' || coalesce(l.address, 'property'),
    'calendar_description',
      'GroundTruth tentative aerial shoot' ||
      e'\n\nProperty: ' || coalesce(l.address, '') || ', ' || coalesce(l.city, '') ||
      e'\nWindow: '     || replace(replace(coalesce(d.best_shoot_window, ''), em, ','), en, ',') ||
      case when coalesce(d.time_rationale, '') = '' then ''
           else e'\nWhy this window: ' || replace(replace(d.time_rationale, em, ','), en, ',')
      end ||
      case when coalesce(l.listing_agent, '') = '' then ''
           else e'\nContact: ' || l.listing_agent ||
                case when coalesce(l.agent_email, '') = '' then ''
                     else ' <' || l.agent_email || '>' end
      end ||
      e'\n\nShot list:\n' || replace(replace(shots, em, ','), en, ',') ||
      e'\n\nTentative hold. Confirm with the contact before flying.'
  );

  perform net.http_post(
    url     := hook_url,
    body    := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return new;
end;
$$;
