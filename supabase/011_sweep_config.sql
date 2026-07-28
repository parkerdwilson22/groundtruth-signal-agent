-- GroundTruth — county sweep configuration
--
-- daily_lead_cap lives as data (§11.4), same pattern as signal_types — change
-- it from 3 to 5 with one UPDATE, no redeploy.
--
-- 'capped' is a new agent_run outcome, distinct from 'no_signal'. A lead that
-- showed a real signal but lost out to the daily cap is a different honest
-- outcome from one the agent judged weak — collapsing them together would
-- violate the same §11.3 rule the agent_runs table exists to uphold.

insert into app_config (key, value)
values ('daily_lead_cap', '3')
on conflict (key) do update set value = excluded.value, updated_at = now();

alter type agent_run_status add value if not exists 'capped';
