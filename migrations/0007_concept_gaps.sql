-- Concept gaps ledger — Gate 1 of the gap-ledger rebuild (see
-- memory/project-gap-ledger-rebuild-contract.md for full architecture).
--
-- Purpose: capture, persist, and gate on the AI-flagged gaps in an inventor's
-- spec. Today the 2a draft prompt's Section 3 ("Granularity Gap Coaching
-- Prompts" + "Inferred Subsystem Candidates" + "Novelty Claim Candidates")
-- is produced on every run but silently discarded by the server. That lets
-- Module 5 (Genus & Species expansion) later fabricate internals for a
-- component the inventor never described, and lets Pannu certify priority
-- claims on top of brittle disclosures — the failure mode that becomes a
-- §101 / enabling-disclosure problem at non-provisional conversion 12
-- months later.
--
-- This migration creates ONLY the table. No code reads from or writes to it
-- yet — that lands in Gate 2 (2a parses Section 3 into rows in shadow mode).
-- Reversible by dropping the table; no other state depends on it.
--
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS inventor_geyser.concept_gaps (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          VARCHAR NOT NULL REFERENCES inventor_geyser.projects(id) ON DELETE CASCADE,

  -- What kind of gap. The taxonomy is fixed and load-bearing for the
  -- enforcement policy: only `missing_mechanism` triggers hard-block at
  -- Module 5 / Pannu boundaries. The other two are AI proposals awaiting
  -- inventor confirmation, never enforcement triggers.
  class               TEXT NOT NULL CHECK (class IN (
                        'missing_mechanism',
                        'inferred_subsystem',
                        'novelty_candidate'
                      )),

  -- Human-readable description, stored verbatim from the prompt's
  -- Granularity Gap Coaching Prompt text (no server-side rephrasing —
  -- preserves the AI's coaching language for the inventor to read).
  description         TEXT NOT NULL,

  -- Where in the spec the gap lives. Free-text anchor — typical values are
  -- "Section 4 paragraph 2" or "Concept 7". Null when the gap isn't tied
  -- to a specific spec location (e.g. inferred subsystems that span the
  -- whole spec).
  context_ref         TEXT,

  -- Provenance of the gap creation. `origin_module` is the module code
  -- that produced the row (e.g. "module2/2a-draft"). `origin_run_id` ties
  -- back to the AI call/run for audit. Both nullable on `origin_run_id`
  -- only because some gaps may be created from inventor action (e.g.
  -- explicit "I'm not sure about X" entries).
  origin_module       TEXT NOT NULL,
  origin_run_id       VARCHAR,

  -- Which downstream modules are blocked while this gap is `open`. The
  -- enforcement layer (Gates 5-7) reads this array to pre-flight check
  -- each module. Empty array means the gap surfaces in the UI but doesn't
  -- block anything — common for `novelty_candidate` rows.
  blocked_modules     TEXT[] NOT NULL DEFAULT '{}'::text[],

  -- Lifecycle. Only `open` blocks downstream modules; the other three
  -- are terminal states. `resolved` = inventor supplied the missing thing.
  -- `dismissed` = inventor removed the underlying concept or explicitly
  -- waived. `superseded` = 2a re-extraction created a new gap that
  -- covers the same surface; this row's no longer current and points to
  -- its replacement via superseded_by.
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                        'open', 'resolved', 'dismissed', 'superseded'
                      )),

  -- Resolution detail. `resolution_text` is the inventor's typed answer
  -- when status='resolved'. `resolution_source` records HOW the gap
  -- closed: 'inventor_typed' (typed an answer), 'concept_removed'
  -- (deleted the underlying concept from the spec), 'inventor_waived'
  -- (explicit dismiss), 'merged' (replaced by another gap), 'auto'
  -- (system-driven, reserved for future re-extraction supersession).
  resolution_text     TEXT,
  resolution_source   TEXT,
  superseded_by       VARCHAR REFERENCES inventor_geyser.concept_gaps(id),

  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMP,

  -- Provenance stamp for the resolution event. Per the contract, we stamp
  -- inventor resolutions (real authoring acts) and NOT gap creations
  -- (AI implementation detail). Null until status transitions out of
  -- `open`. The FK lives in the same schema; no cross-schema reference.
  provenance_event_id VARCHAR REFERENCES inventor_geyser.provenance_events(id)
);

-- Hot path: list all open gaps for a project. Both the UI panel and the
-- Module 5 / Pannu pre-flight checks run this query on every relevant
-- request, so a partial index keyed on the small `open` subset keeps it
-- O(1) regardless of how much resolved history accumulates.
CREATE INDEX IF NOT EXISTS concept_gaps_open_per_project_idx
  ON inventor_geyser.concept_gaps (project_id, status)
  WHERE status = 'open';

-- Enforcement path: "is there any open missing_mechanism gap on this
-- project that I should block on?" Hit at every proceed-to-next-stage
-- click once Gate 4 lands. Partial index covers only the rows the
-- enforcement layer cares about.
CREATE INDEX IF NOT EXISTS concept_gaps_blocking_idx
  ON inventor_geyser.concept_gaps (project_id, class)
  WHERE status = 'open' AND class = 'missing_mechanism';

-- Audit path: walking the supersession chain (re-extractions). Rarely
-- hit at request time but useful for the proof package export and any
-- future "show me the gap history" UI.
CREATE INDEX IF NOT EXISTS concept_gaps_superseded_by_idx
  ON inventor_geyser.concept_gaps (superseded_by)
  WHERE superseded_by IS NOT NULL;
