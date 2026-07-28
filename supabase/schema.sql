-- GroundTruth — Real Estate Signal Agent
-- Schema per spec Section 5, with the Section 3 / Section 10 governance rule
-- ("trust human input by default") enforced at the database layer.
--
-- Run this in the Supabase SQL editor:
--   Dashboard -> SQL Editor -> New query -> paste -> Run

-- ---------------------------------------------------------------------------
-- Actor convention
-- ---------------------------------------------------------------------------
-- FAIL-SAFE DEFAULT: anything that does not explicitly identify itself is
-- treated as the *agent* (the restricted role). Humans identify themselves by
-- calling set_stage(), which sets `app.actor = 'human'` for the transaction.
--
-- This direction matters. PostgREST cannot set session variables, so a write
-- arriving over the REST API is always unidentified — if the default were
-- 'human', every agent write would silently receive full privileges and the
-- guard below would be dead code. Defaulting to 'agent' means a failure to
-- identify costs you privileges rather than granting them.

create or replace function current_actor() returns text
language sql stable
as $$
  select coalesce(nullif(current_setting('app.actor', true), ''), 'agent');
$$;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table if not exists leads (
  id             uuid primary key default gen_random_uuid(),
  address        text        not null,
  city           text        not null,
  state          text,
  lat            double precision,
  lon            double precision,
  type           text,
  price          numeric(12,2),
  days_on_market integer     default 0,
  photo_count    integer     default 0,
  notes          text,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- signals — one row per agent run; history is kept, never overwritten
-- ---------------------------------------------------------------------------
create table if not exists signals (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid        not null references leads(id) on delete cascade,
  signal      boolean     not null,
  signal_type text,
  confidence  numeric(4,3) check (confidence >= 0 and confidence <= 1),
  reasoning   text,
  created_at  timestamptz not null default now()
);

create index if not exists signals_lead_id_idx on signals(lead_id);

-- ---------------------------------------------------------------------------
-- drafts — shot list + outreach copy produced by the third AI call
-- ---------------------------------------------------------------------------
create table if not exists drafts (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid        not null references leads(id) on delete cascade,
  signal_id         uuid        references signals(id) on delete set null,
  shot_list         jsonb       not null default '[]'::jsonb,
  outreach_subject  text,
  outreach_body     text,
  best_shoot_window text,
  created_at        timestamptz not null default now()
);

create index if not exists drafts_lead_id_idx on drafts(lead_id);

-- ---------------------------------------------------------------------------
-- pipeline — one row per lead. This is the table Zapier's webhook watches.
-- ---------------------------------------------------------------------------
do $$ begin
  create type pipeline_stage as enum ('new_signal', 'contacted', 'scheduled', 'completed');
exception
  when duplicate_object then null;
end $$;

create table if not exists pipeline (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid           not null unique references leads(id) on delete cascade,
  draft_id     uuid           references drafts(id) on delete set null,
  stage        pipeline_stage not null default 'new_signal',
  -- Set true the moment a human changes the stage. Once true, the agent can
  -- never move this lead backward or re-trigger outreach on it. See spec
  -- Section 3 (governance rule) and Section 10 principle 3.
  stage_locked boolean        not null default false,
  updated_at   timestamptz    not null default now()
);

create index if not exists pipeline_stage_idx on pipeline(stage);

-- ---------------------------------------------------------------------------
-- Governance triggers — the enforcement of "never overwrite a human's action"
-- ---------------------------------------------------------------------------

-- 1. A human changing the stage locks the row automatically.
-- 2. The agent may never modify stage on a locked row.
-- 3. The agent may never move a lead backward through the pipeline.
create or replace function pipeline_guard() returns trigger
language plpgsql
as $$
declare
  actor        text := current_actor();
  stage_order  constant text[] := array['new_signal', 'contacted', 'scheduled', 'completed'];
  old_rank     integer := array_position(stage_order, old.stage::text);
  new_rank     integer := array_position(stage_order, new.stage::text);
begin
  new.updated_at := now();

  if new.stage is distinct from old.stage then
    if actor = 'agent' then
      -- Rule: the human's last word wins, always.
      if old.stage_locked then
        raise exception
          'GroundTruth governance: lead % has stage_locked = true; the agent may not change stage from % to %.',
          old.lead_id, old.stage, new.stage
          using errcode = 'check_violation';
      end if;

      -- Rule: the agent never moves a lead backward.
      if new_rank < old_rank then
        raise exception
          'GroundTruth governance: the agent may not move lead % backward from % to %.',
          old.lead_id, old.stage, new.stage
          using errcode = 'check_violation';
      end if;
    else
      -- A human moved this lead. Lock it from here on.
      new.stage_locked := true;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists pipeline_guard_trigger on pipeline;
create trigger pipeline_guard_trigger
  before update on pipeline
  for each row execute function pipeline_guard();

-- The human path. This is the ONLY way to move a lead's stage by hand; it is
-- what marks the transaction as a human action so the trigger locks the row.
-- The UI calls it via supabase.rpc('set_stage', {...}).
create or replace function set_stage(p_lead_id uuid, p_stage pipeline_stage)
returns pipeline
language plpgsql
security definer
set search_path = public
as $$
declare
  result pipeline;
begin
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
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Single-user internal tool (spec Section 1: no signup, no billing). RLS is
-- enabled with permissive policies so the publishable/anon key works, while
-- leaving the door open to tighten to authenticated-only later.
alter table leads    enable row level security;
alter table signals  enable row level security;
alter table drafts   enable row level security;
alter table pipeline enable row level security;

do $$
declare t text;
begin
  foreach t in array array['leads', 'signals', 'drafts', 'pipeline'] loop
    execute format('drop policy if exists %I on %I', t || '_all_access', t);
    execute format(
      'create policy %I on %I for all using (true) with check (true)',
      t || '_all_access', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Seed data — the four demo properties from the reference prototype (Section 6)
-- ---------------------------------------------------------------------------
insert into leads (address, city, state, lat, lon, type, price, days_on_market, photo_count, notes)
select * from (values
  ('4210 Steele Creek Rd', 'Charlotte', 'NC', 35.1495, -80.9673,
   'New construction', 612000::numeric, 0, 0,
   'CO issued 3 weeks ago, not yet listed with photos.'),
  ('812 Providence Rd', 'Weddington', 'NC', 35.0526, -80.7423,
   'FSBO / 2.4 acres', 895000::numeric, 6, 8,
   'For-sale-by-owner, acreage lot, phone-camera photos only.'),
  ('1560 Ballantyne Commons Pkwy', 'Charlotte', 'NC', 35.0527, -80.8460,
   'Price drop', 449000::numeric, 62, 4,
   'Price cut 4% last week, thin photo set, sitting stale.'),
  ('305 Lake Wylie Dr', 'Lake Wylie', 'SC', 35.1012, -81.0654,
   'New construction / waterfront', 1150000::numeric, 1, 0,
   'Lakefront lot, CO issued yesterday, builder has no listing media yet.')
) as seed(address, city, state, lat, lon, type, price, days_on_market, photo_count, notes)
where not exists (select 1 from leads);
