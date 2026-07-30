-- GroundTruth: record how many permits each owner has filed.
--
-- Classifying a permit owner as a business or a private individual was a
-- pattern match on the name alone ("LLC", "HOMES", "BUILDERS"), which cannot
-- tell a one-man builder filing under his own name from a homeowner who built
-- their own house. Filing history can: someone who builds for a living files
-- repeatedly, a homeowner files once.
--
-- Stored per lead so the classification is inspectable rather than implicit,
-- and so the UI can show the evidence next to the conclusion.
--
-- Nullable on purpose: null means "not yet counted", which is different from
-- 0 and must not be displayed as though the owner filed nothing.

alter table leads add column if not exists owner_permit_count integer;

comment on column leads.owner_permit_count is
  'Permits filed by this owner of record in the county feed lookback window. '
  '1 suggests a homeowner building their own house; 2+ suggests a builder. '
  'Null means not yet counted.';
