-- Store the canonical JSON bytes of each provenance event's payload so we
-- can reconstruct the exact bytes that were hashed and timestamped. Required
-- for the downloadable proof package (canonical-disclosure.json).

ALTER TABLE inventor_geyser.provenance_events
  ADD COLUMN IF NOT EXISTS payload_canonical TEXT;
