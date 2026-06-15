-- Family-level free-text context + a readable title on uploaded reference
-- patents. Two independent additions:
--
--   inventor_geyser.project_families.context
--     A free-text "what these projects are about" note the inventor can edit
--     after creation. Distinct from `description` (a short label) — `context`
--     is injected into the AI helper's FAMILY CONTEXT block so every sibling
--     in the family is drafted with this background in view.
--
--   inventor_geyser.project_family_context_files.title
--     A human-readable title for an uploaded reference patent, so it isn't
--     identified only by its raw filename (e.g. "US1234567.pdf").
--
-- All fields optional. Existing rows continue to work unchanged.
-- Idempotent; additive only; safe to re-run.

ALTER TABLE inventor_geyser.project_families
  ADD COLUMN IF NOT EXISTS context text;

ALTER TABLE inventor_geyser.project_family_context_files
  ADD COLUMN IF NOT EXISTS title text;
