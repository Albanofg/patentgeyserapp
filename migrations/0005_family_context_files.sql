-- Family Context Files: external reference documents (typically prior
-- patents in the same product domain) uploaded once at the family level
-- so every sibling in the family has access. Files are stored inline as
-- base64 in the column so no external blob storage is required.
--
-- Cost-control: the heavy AI work (text extraction + one-line summary)
-- runs exactly ONCE at upload time on the owning family. Every later
-- prompt sees only the cached summary; the AI helper fetches full
-- extracted text via a tool call only when it genuinely needs to read
-- a specific file.
--
-- Idempotent. Additive only. Apply via Neon SQL editor.

CREATE TABLE IF NOT EXISTS inventor_geyser.project_family_context_files (
  id                       varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id                varchar NOT NULL REFERENCES inventor_geyser.project_families(id) ON DELETE CASCADE,
  uploaded_by_user_id      varchar REFERENCES inventor_geyser.users(id) ON DELETE SET NULL,
  uploaded_by_inventors_user_id varchar REFERENCES inventor_geyser.inventors_users(id) ON DELETE SET NULL,
  original_filename        text NOT NULL,
  mime_type                text NOT NULL,
  byte_size                integer NOT NULL DEFAULT 0,
  -- base64-encoded file body. Bounded by app-side upload cap (default 15 MB).
  file_bytes_b64           text NOT NULL,
  -- Plain text extracted at upload time. Used by the AI helper's fetch tool.
  extracted_text           text,
  extraction_status        text NOT NULL DEFAULT 'pending', -- 'pending' | 'ok' | 'failed'
  extraction_error         text,
  -- Short, one-line model-written summary. This is what ships into the per-turn
  -- QA context — never the full extracted text.
  summary                  text,
  created_at               timestamp NOT NULL DEFAULT NOW(),
  updated_at               timestamp NOT NULL DEFAULT NOW(),
  deleted_at               timestamp
);

CREATE INDEX IF NOT EXISTS pfcf_family_idx
  ON inventor_geyser.project_family_context_files (family_id)
  WHERE deleted_at IS NULL;
