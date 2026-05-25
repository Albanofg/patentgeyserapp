-- Provenance & proof system — three tables that together produce a
-- cryptographically verifiable record of disclosure existence + integrity.
-- All-free architecture: FreeTSA (RFC 3161) + OpenTimestamps (Bitcoin) +
-- local SHA-256 hash chain. Idempotent: safe to run multiple times.

-- 1. Append-only hash chain of events.
CREATE TABLE IF NOT EXISTS inventor_geyser.provenance_events (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    VARCHAR NOT NULL REFERENCES inventor_geyser.projects(id) ON DELETE CASCADE,
  user_id       VARCHAR,
  event_type    TEXT NOT NULL,
  ref_table     TEXT NOT NULL,
  ref_id        TEXT,
  payload_hash  TEXT NOT NULL,
  prev_hash     TEXT,
  event_hash    TEXT NOT NULL,
  metadata      JSONB,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS provenance_events_project_eventhash_idx
  ON inventor_geyser.provenance_events (project_id, event_hash);

CREATE INDEX IF NOT EXISTS provenance_events_project_created_idx
  ON inventor_geyser.provenance_events (project_id, created_at);

CREATE INDEX IF NOT EXISTS provenance_events_project_type_idx
  ON inventor_geyser.provenance_events (project_id, event_type);


-- 2. RFC 3161 TimeStampTokens (one per checkpoint event).
CREATE TABLE IF NOT EXISTS inventor_geyser.provenance_stamps (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    VARCHAR NOT NULL REFERENCES inventor_geyser.projects(id) ON DELETE CASCADE,
  event_id      VARCHAR NOT NULL REFERENCES inventor_geyser.provenance_events(id) ON DELETE CASCADE,
  tsa_url       TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  tsa_response  TEXT NOT NULL,   -- base64-encoded .tsr bytes
  tsa_cert      TEXT,            -- base64-encoded cert chain
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS provenance_stamps_project_idx
  ON inventor_geyser.provenance_stamps (project_id);

CREATE INDEX IF NOT EXISTS provenance_stamps_event_idx
  ON inventor_geyser.provenance_stamps (event_id);


-- 3. Daily Merkle anchors via OpenTimestamps (Bitcoin).
CREATE TABLE IF NOT EXISTS inventor_geyser.provenance_anchors (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      VARCHAR NOT NULL REFERENCES inventor_geyser.projects(id) ON DELETE CASCADE,
  anchor_date     TEXT NOT NULL,    -- YYYY-MM-DD UTC
  event_count     INTEGER NOT NULL,
  merkle_root     TEXT NOT NULL,
  ots_proof       TEXT NOT NULL,    -- base64-encoded .ots bytes
  ots_upgraded_at TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS provenance_anchors_project_date_idx
  ON inventor_geyser.provenance_anchors (project_id, anchor_date);
