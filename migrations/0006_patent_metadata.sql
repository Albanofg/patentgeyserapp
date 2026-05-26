-- Patent metadata: fields a portfolio holder expects on every patent record,
-- whether it's a project being drafted in Patent Geyser or a prior patent
-- uploaded as a reference file. Applied to BOTH:
--   inventor_geyser.projects                        (the inventor's own work)
--   inventor_geyser.project_family_context_files    (uploaded prior patents)
--
-- All fields are optional. Existing rows continue to work unchanged.
-- Idempotent; additive only; safe to re-run.

-- Projects
ALTER TABLE inventor_geyser.projects
  ADD COLUMN IF NOT EXISTS inventor_names      text[],
  ADD COLUMN IF NOT EXISTS filed_date          date,
  ADD COLUMN IF NOT EXISTS status              text,
  ADD COLUMN IF NOT EXISTS application_number  text,
  ADD COLUMN IF NOT EXISTS publication_number  text,
  ADD COLUMN IF NOT EXISTS assignee            text,
  ADD COLUMN IF NOT EXISTS jurisdiction        text,
  ADD COLUMN IF NOT EXISTS patent_type         text,
  ADD COLUMN IF NOT EXISTS external_url        text,
  ADD COLUMN IF NOT EXISTS notes               text;

-- Context (reference) files
ALTER TABLE inventor_geyser.project_family_context_files
  ADD COLUMN IF NOT EXISTS inventor_names      text[],
  ADD COLUMN IF NOT EXISTS filed_date          date,
  ADD COLUMN IF NOT EXISTS status              text,
  ADD COLUMN IF NOT EXISTS application_number  text,
  ADD COLUMN IF NOT EXISTS publication_number  text,
  ADD COLUMN IF NOT EXISTS assignee            text,
  ADD COLUMN IF NOT EXISTS jurisdiction        text,
  ADD COLUMN IF NOT EXISTS patent_type         text,
  ADD COLUMN IF NOT EXISTS external_url        text,
  ADD COLUMN IF NOT EXISTS notes               text;
