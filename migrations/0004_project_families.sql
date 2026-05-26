-- Project Families: organizational layer that lets an inventor group sibling
-- patents covering the same product and prevents them from overlapping with
-- each other. The family itself is just a label; the cost-controlled overlap
-- check lives in project_family_artifacts (digests + optional embeddings
-- computed once at save time on the sibling, never at check time on the
-- viewer).
--
-- Idempotent. Schema-qualified. Apply via Neon SQL editor — never drizzle-kit push.

CREATE TABLE IF NOT EXISTS inventor_geyser.project_families (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     varchar REFERENCES inventor_geyser.users(id) ON DELETE CASCADE,
  inventors_user_id varchar REFERENCES inventor_geyser.inventors_users(id) ON DELETE CASCADE,
  title             text NOT NULL,
  description       text,
  created_at        timestamp NOT NULL DEFAULT NOW(),
  updated_at        timestamp NOT NULL DEFAULT NOW(),
  deleted_at        timestamp,
  CONSTRAINT project_families_owner_xor
    CHECK ((owner_user_id IS NOT NULL)::int + (inventors_user_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS project_families_owner_user_idx
  ON inventor_geyser.project_families (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS project_families_inventors_user_idx
  ON inventor_geyser.project_families (inventors_user_id) WHERE deleted_at IS NULL;

ALTER TABLE inventor_geyser.projects
  ADD COLUMN IF NOT EXISTS family_id varchar
    REFERENCES inventor_geyser.project_families(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_family_id_idx
  ON inventor_geyser.projects (family_id) WHERE family_id IS NOT NULL;

-- Cached, per-artifact digest of every sibling's notable content. Written
-- exactly once per save by the owning project; read by sibling-overlap
-- checks. This is the entire reason overlap checks cost ~zero tokens:
-- the expensive work (hashing, optional embedding) happens on the sibling's
-- own save path, never on the viewer's working session.
--
-- artifact_kind values:
--   'idea_summary'      — one row per project (Agent 1)
--   'extracted_idea'    — one row per extracted idea (Agent 2)
--   'key_concept'       — one row per selected key concept (Agent 4b)
-- artifact_ref is whatever stable id ties the digest back to the source
-- (e.g. the extracted-idea title slug or the key-concept index). Free-form
-- string; the writer decides.
CREATE TABLE IF NOT EXISTS inventor_geyser.project_family_artifacts (
  id            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    varchar NOT NULL REFERENCES inventor_geyser.projects(id) ON DELETE CASCADE,
  family_id     varchar REFERENCES inventor_geyser.project_families(id) ON DELETE SET NULL,
  artifact_kind text    NOT NULL,
  artifact_ref  text    NOT NULL,
  preview       text    NOT NULL,
  char_count    integer NOT NULL DEFAULT 0,
  hash          text    NOT NULL,
  embedding     jsonb,
  updated_at    timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT project_family_artifacts_unique
    UNIQUE (project_id, artifact_kind, artifact_ref)
);

CREATE INDEX IF NOT EXISTS pfa_family_kind_idx
  ON inventor_geyser.project_family_artifacts (family_id, artifact_kind)
  WHERE family_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pfa_hash_idx
  ON inventor_geyser.project_family_artifacts (family_id, hash)
  WHERE family_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pfa_project_idx
  ON inventor_geyser.project_family_artifacts (project_id);
