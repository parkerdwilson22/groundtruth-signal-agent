-- GroundTruth — spec compliance (spec v2, Sections 5 + 11)
--
-- 1. agent_runs      — "found nothing" must never look like "something broke" (§11.3)
-- 2. signal_types    — reference values live as queryable data, not prompt constants (§11.4)
-- 3. lead enrichment — columns for the county sweep + AI enrichment (§12 Rhythm)
--
-- Run in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- 1. agent_runs
-- ---------------------------------------------------------------------------
do $$ begin
  create type agent_run_status as enum ('signal_found', 'no_signal', 'error');
exception when duplicate_object then null;
end $$;

create table if not exists agent_runs (
  id           uuid             primary key default gen_random_uuid(),
  lead_id      uuid             references leads(id) on delete cascade,
  run_status   agent_run_status not null,
  -- Which step the run reached / failed at, for debugging without guesswork.
  step         text,
  error_detail text,
  created_at   timestamptz      not null default now()
);

create index if not exists agent_runs_lead_id_idx on agent_runs(lead_id);
create index if not exists agent_runs_created_idx on agent_runs(created_at desc);

-- ---------------------------------------------------------------------------
-- 2. signal_types — queryable, editable, not hardcoded in a prompt
-- ---------------------------------------------------------------------------
create table if not exists signal_types (
  code        text        primary key,
  label       text        not null,
  description text        not null,
  active      boolean     not null default true,
  sort_order  integer     not null default 100,
  created_at  timestamptz not null default now()
);

insert into signal_types (code, label, description, sort_order) values
  ('new_construction_no_media',
   'New construction, no listing media',
   'Certificate of occupancy or permit completion just landed, but no marketing photos exist yet.',
   10),
  ('fsbo_amateur_photos',
   'FSBO with amateur photos',
   'For-sale-by-owner listing carrying only phone-camera photos and no professional media.',
   20),
  ('stale_price_drop_thin_photos',
   'Stale listing, price drop, thin photo set',
   'Listing has sat on market, taken a price cut, and is running a weak photo set.',
   30),
  ('acreage_waterfront_aerial',
   'Acreage or waterfront that needs aerial',
   'Lot size, shoreline, or land features that simply cannot be shown from the ground.',
   40)
on conflict (code) do update
  set label       = excluded.label,
      description = excluded.description,
      sort_order  = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 3. Lead provenance + enrichment (for the county sweep)
-- ---------------------------------------------------------------------------
alter table leads add column if not exists source          text default 'manual';
alter table leads add column if not exists source_ref      text;
alter table leads add column if not exists source_detail   jsonb;
alter table leads add column if not exists listing_agent   text;
alter table leads add column if not exists agent_email     text;
alter table leads add column if not exists agent_phone     text;
-- 'pending' | 'enriched' | 'insufficient_data' — never silently blank (§11.9)
alter table leads add column if not exists enrichment_status text default 'pending';
alter table leads add column if not exists enrichment_notes  text;
alter table leads add column if not exists enriched_at       timestamptz;

-- One row per county permit; prevents the sweep re-adding the same property.
create unique index if not exists leads_source_ref_idx
  on leads(source, source_ref) where source_ref is not null;

-- ---------------------------------------------------------------------------
-- RLS for the new tables
-- ---------------------------------------------------------------------------
alter table agent_runs   enable row level security;
alter table signal_types enable row level security;

do $$
declare t text;
begin
  foreach t in array array['agent_runs', 'signal_types'] loop
    execute format('drop policy if exists %I on %I', t || '_all_access', t);
    execute format(
      'create policy %I on %I for all using (true) with check (true)',
      t || '_all_access', t
    );
  end loop;
end $$;
