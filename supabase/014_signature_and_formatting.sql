-- GroundTruth — email signature + properly formatted Zapier payload
--
-- The signature is real business contact information, supplied by Parker
-- verbatim. It lives in app_config (not in a prompt) specifically so the
-- model can never generate or alter it — a model-invented phone number or
-- website on a real cold email would be the worst possible failure (§11.9).
-- Editable here without a redeploy (§11.4).

insert into app_config (key, value) values
  ('email_signature',
   E'Parker Wilson\nSmoove Visuals LLC\nCell: 202-302-9250\nWeb: www.smoovevisuals.com\nEmail: parker.wilson@smoovevisuals.com')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Lead columns renamed conceptually: contact may be a builder OR an agent.
alter table leads add column if not exists contact_type   text;
alter table leads add column if not exists contact_source text;

-- ---------------------------------------------------------------------------
-- Rebuild the webhook payload with real email formatting
-- ---------------------------------------------------------------------------
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
    'email_subject',     coalesce(d.outreach_subject, ''),
    -- Body + blank line + signature. The model writes the body only; the
    -- signature is appended from config so contact details are never generated.
    'email_body',        coalesce(d.outreach_body, '') ||
                         case when signature is null or signature = ''
                              then ''
                              else e'\n\n' || signature end,
    'shoot_window_text', coalesce(d.best_shoot_window, ''),
    'shoot_date_iso',    coalesce(d.shoot_date_iso::text, ''),
    'shoot_start_iso',   coalesce(d.shoot_start_iso::text, ''),
    'shoot_end_iso',     coalesce(d.shoot_end_iso::text, ''),
    'time_rationale',    coalesce(d.time_rationale, ''),
    'shot_list',         shots,
    'calendar_title',    'Drone shoot (tentative) — ' || coalesce(l.address, 'property'),
    -- Pre-formatted, readable calendar body so the Zap maps one clean field.
    'calendar_description',
      'GroundTruth — tentative aerial shoot' ||
      e'\n\nProperty: '  || coalesce(l.address, '') || ', ' || coalesce(l.city, '') ||
      e'\nWindow: '      || coalesce(d.best_shoot_window, '') ||
      case when coalesce(d.time_rationale, '') = '' then ''
           else e'\nWhy this window: ' || d.time_rationale end ||
      case when coalesce(l.listing_agent, '') = '' then ''
           else e'\nContact: ' || l.listing_agent ||
                case when coalesce(l.agent_email, '') = '' then ''
                     else ' <' || l.agent_email || '>' end end ||
      e'\n\nShot list:\n' || shots ||
      e'\n\nTentative hold — confirm with the contact before flying.'
  );

  perform net.http_post(
    url     := hook_url,
    body    := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return new;
end;
$$;
