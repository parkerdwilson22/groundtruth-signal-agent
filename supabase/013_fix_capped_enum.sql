-- The 'capped' enum value did not commit when added alongside other
-- statements — Postgres won't make a new enum value usable inside the same
-- transaction block that adds it. Run this ON ITS OWN, as the only statement
-- in the editor.
--
-- Verify afterwards with 014.

alter type agent_run_status add value if not exists 'capped';
