-- GroundTruth — remove temporary debug scaffolding used to chase down the
-- shot_list aggregation bug and the timezone-offset bug. No longer needed.

drop function if exists debug_webhook_log();
drop function if exists debug_pg_net_status();
drop function if exists debug_direct_webhook_test();
drop function if exists debug_list_pipeline_triggers();
drop function if exists debug_test_trigger_fire();
drop function if exists debug_verify_shotlist_agg();
