-- GroundTruth — the handoff (spec §3, §11.1)
--
-- Fires a rich payload at the Zapier catch hook whenever a lead lands in the
-- pipeline at stage 'new_signal'. §11.1: the trigger firing and a real action
-- landing is the part that makes this build count — not the AI in the middle.
--
-- The payload is deliberately complete (email subject/body, shot list,
-- calendar title, coordinates) so the Zap needs no lookup steps.

create extension if not exists pg_net with schema extensions;

-- An unambiguous date + time for the calendar hold. The prose window is for
-- humans; Google Calendar needs real timestamps, not "Friday, July 31 —
-- sunny and...". start/end are chosen by the agent itself (see shoot-window
-- route) based on light and wind, not a fixed placeholder slot.
alter table drafts add column if not exists shoot_date_iso   date;
alter table drafts add column if not exists shoot_start_iso  timestamp;
alter table drafts add column if not exists shoot_end_iso    timestamp;
alter table drafts add column if not exists time_rationale   text;

-- ---------------------------------------------------------------------------
-- Config — the hook URL will drift if the Zap is rebuilt, so it is data (§11.4)
-- ---------------------------------------------------------------------------
create table if not exists app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table app_config enable row level security;
-- No public policy: this table is intentionally unreadable via the anon key.

-- Set this to your own Zapier catch-hook URL. Deliberately a placeholder in
-- version control: the hook URL is a credential — anyone holding it can POST
-- into the Zap and create drafts/events in the connected Google account.
--
-- Set the real value directly in the Supabase SQL editor, not in this file:
--   update app_config set value = '<your catch hook url>'
--    where key = 'zapier_catch_hook_url';
insert into app_config (key, value)
values ('zapier_catch_hook_url', 'REPLACE_ME')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------
create or replace function notify_zapier_new_signal() returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  hook_url text;
  payload  jsonb;
  l        leads%rowtype;
  d        drafts%rowtype;
begin
  if new.stage <> 'new_signal' then
    return new;
  end if;

  select value into hook_url from app_config where key = 'zapier_catch_hook_url';
  if hook_url is null or hook_url = '' then
    raise warning 'GroundTruth: no zapier_catch_hook_url configured; skipping webhook';
    return new;
  end if;

  select * into l from leads  where id = new.lead_id;
  select * into d from drafts where id = new.draft_id;

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
    'listing_agent',     coalesce(l.listing_agent, ''),
    'agent_email',       coalesce(l.agent_email, ''),
    'agent_phone',       coalesce(l.agent_phone, ''),
    'email_subject',     coalesce(d.outreach_subject, ''),
    'email_body',        coalesce(d.outreach_body, ''),
    'shoot_window_text', coalesce(d.best_shoot_window, ''),
    -- Chosen by the agent from actual light/wind, not a fixed placeholder slot.
    'shoot_date_iso',    coalesce(d.shoot_date_iso::text, ''),
    'shoot_start_iso',   coalesce(d.shoot_start_iso::text, ''),
    'shoot_end_iso',     coalesce(d.shoot_end_iso::text, ''),
    'time_rationale',    coalesce(d.time_rationale, ''),
    -- string_agg (an aggregate) cannot take row_number() (a window function)
    -- directly as an argument — compute the numbering in an inner subquery
    -- first, then aggregate over that in the outer one.
    'shot_list',         coalesce(
                           (select string_agg(numbered.rn::text || '. ' || numbered.shot, e'\n')
                            from (
                              select row_number() over () as rn, shot
                              from jsonb_array_elements_text(coalesce(d.shot_list, '[]'::jsonb)) as shot
                            ) numbered), ''),
    'calendar_title',    'Drone shoot (tentative) — ' || coalesce(l.address, 'property')
  );

  perform net.http_post(
    url     := hook_url,
    body    := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return new;
end;
$$;

drop trigger if exists pipeline_new_signal_webhook on pipeline;
create trigger pipeline_new_signal_webhook
  after insert on pipeline
  for each row execute function notify_zapier_new_signal();
