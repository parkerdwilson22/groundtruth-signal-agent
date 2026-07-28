-- GroundTruth — fix the 1-hour-off calendar hold
--
-- shoot_start_iso/shoot_end_iso were `timestamp` (no timezone) columns, and
-- the app was writing bare local time with no offset. Zapier/Google Calendar
-- had to guess the zone and guessed wrong. The app now computes an explicit
-- UTC offset (America/New_York, correctly handling EDT/EST) — these columns
-- must switch to `text` so Postgres doesn't silently strip that offset back
-- off on write.

alter table drafts alter column shoot_start_iso type text using shoot_start_iso::text;
alter table drafts alter column shoot_end_iso   type text using shoot_end_iso::text;
