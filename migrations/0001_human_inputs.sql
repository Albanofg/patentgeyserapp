-- Human-input ledger — verbatim user typing captured across modules 0–4b
-- so downstream steps (Pannu pre-fill, future flows) can draft answers
-- from the user's own words instead of asking them to retype.
--
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS inventor_geyser.human_inputs (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      VARCHAR NOT NULL REFERENCES inventor_geyser.projects(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  source_ref_id   TEXT,
  prompt_text     TEXT,
  answer_text     TEXT NOT NULL,
  tags            TEXT[] NOT NULL DEFAULT '{}'::text[],
  concept_id      TEXT,
  char_count      INTEGER NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Lookup indexes. The ledger reads are always project-scoped, often
-- concept-scoped or tag-filtered.
CREATE INDEX IF NOT EXISTS human_inputs_project_idx
  ON inventor_geyser.human_inputs (project_id);

CREATE INDEX IF NOT EXISTS human_inputs_project_concept_idx
  ON inventor_geyser.human_inputs (project_id, concept_id);

CREATE INDEX IF NOT EXISTS human_inputs_project_source_idx
  ON inventor_geyser.human_inputs (project_id, source);

CREATE INDEX IF NOT EXISTS human_inputs_tags_gin
  ON inventor_geyser.human_inputs USING GIN (tags);

-- Upsert key. Two ledger writers for the same (project, source, source_ref_id)
-- triple should update the existing row, not append. We don't enforce this
-- as a UNIQUE constraint because source_ref_id is nullable and Postgres
-- treats NULLs as distinct in unique constraints — the ledger module's
-- recordHumanInput() does the find-or-insert dance in app code instead.
