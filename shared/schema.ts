import { sql, relations } from "drizzle-orm";
import { pgSchema, text, varchar, timestamp, integer, jsonb, boolean, date, vector } from "drizzle-orm/pg-core";

// All PatentGeyser (inventor/consumer) tables live under the `inventor_geyser`
// Postgres schema. The same Neon DB also hosts the twin (lawyer) app under the
// `patent_geyser` schema — DO NOT touch that schema from this app.
const inventorGeyser = pgSchema("inventor_geyser");
const pgTable = inventorGeyser.table.bind(inventorGeyser);
// Sibling schema for admin/observability tables (usage logs, future audit
// trails). Kept separate so the app schema stays focused on product data.
const inventorGeyserAdmin = pgSchema("inventor_geyser_admin");
const adminTable = inventorGeyserAdmin.table.bind(inventorGeyserAdmin);
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table for email/password authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  // 2FA fields
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorMethod: text("two_factor_method"), // 'email' or 'totp'
  totpSecret: text("totp_secret"), // Secret for authenticator app
  pendingTwoFactorCode: text("pending_two_factor_code"), // Temporary code for email 2FA
  pendingTwoFactorExpiry: timestamp("pending_two_factor_expiry"), // When the code expires
  twoFactorVerifiedAt: timestamp("two_factor_verified_at"), // Session-level 2FA verification timestamp
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// PatentGeyser inventor users. Separate from the shared `users` table used by
// the lawyer twin app. Same auth mechanism (bcrypt + email/password + 2FA),
// and each user has a per-credit project creation cap (free signups start at 0).
export const inventorsUsers = pgTable("inventors_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorMethod: text("two_factor_method"),
  totpSecret: text("totp_secret"),
  pendingTwoFactorCode: text("pending_two_factor_code"),
  pendingTwoFactorExpiry: timestamp("pending_two_factor_expiry"),
  twoFactorVerifiedAt: timestamp("two_factor_verified_at"),
  lastLoginAt: timestamp("last_login_at"),
  // Credits = projects user can still create. New signups start at 0; purchases add to this.
  projectLimit: integer("project_limit").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Source code file structure for JSONB storage
// Each file: { id: string, fileName: string, description: string, code: string, addedAt: string }
export type SourceCodeFile = {
  id: string;
  fileName: string;
  description: string;
  code: string;
  addedAt: string;
};

// Projects table - stores patent application projects
// Exactly one of userId / inventorsUserId is set per row (enforced at app layer).
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  inventorsUserId: varchar("inventors_user_id").references(() => inventorsUsers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: text("category"), // deprecated — kept nullable for legacy rows
  currentStage: integer("current_stage").notNull().default(1), // 1-5 representing agent stages
  currentSubstage: text("current_substage"), // For Agent 2: '2a', '2b', '2c'
  completed: integer("completed").notNull().default(0), // 0 or 1 boolean
  sourceCodeFiles: jsonb("source_code_files").$type<SourceCodeFile[]>(), // Array of source code files
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // Soft-delete marker. Stage-5+ projects are soft-deleted (deletedAt set) so
  // their consumed credit is preserved; pre-stage-5 deletes are hard-deletes
  // and the credit is refunded.
  deletedAt: timestamp("deleted_at"),
  // Optional family membership. FK enforced at DB level (ON DELETE SET NULL).
  familyId: varchar("family_id"),
  // Patent metadata — all optional, populated as the inventor learns / files.
  inventorNames: text("inventor_names").array(),
  filedDate: date("filed_date"),
  status: text("status"), // 'draft' | 'filed' | 'published' | 'granted' | 'abandoned'
  applicationNumber: text("application_number"),
  publicationNumber: text("publication_number"),
  assignee: text("assignee"),
  jurisdiction: text("jurisdiction"),
  patentType: text("patent_type"), // 'provisional' | 'utility' | 'design' | 'plant' | 'pct' | 'other'
  externalUrl: text("external_url"),
  notes: text("notes"),
});

// Agent data table - stores outputs from each agent stage as JSON
export const agentData = pgTable("agent_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  agentNumber: integer("agent_number").notNull(), // 1-5
  data: jsonb("data").notNull(), // Flexible JSON storage for each agent's output
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Idea snapshots table - tracks evolution of the idea through refinements
// Snapshot types by stage:
// - Stage 1: 'root', 'debate', 'mechanic_add', 'mechanic_fix', 'mechanic_delete', 'mechanic_change'
// - Stage 2: '2a_concept_expansion', '2b_selected_ideas'
// - Stage 3: '3_prior_art'
// - Stage 4: '4a_white_space', '4b_claims', '4c_provisional'
// - Stage 5: '5_diagrams'
export const ideaSnapshots = pgTable("idea_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), // Sequential version number
  snapshotType: text("snapshot_type").notNull(), // See types above
  title: text("title"), // Brief title/label for this snapshot
  content: text("content").notNull(), // The idea content at this point (human-readable markdown)
  command: text("command"), // The user command that triggered this snapshot (for mechanic types)
  qualityScore: text("quality_score"), // Score from internal quality loop (for mechanic types)
  metadata: jsonb("metadata"), // Structured data: selectedIdeas, priorArt, claims, diagrams, etc.
  createdAt: timestamp("created_at").defaultNow(),
});

// Quick Prior Art Searches - standalone prior art checks from sidebar.
// Exactly one of userId / inventorsUserId is set per row.
export const priorArtSearches = pgTable("prior_art_searches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  inventorsUserId: varchar("inventors_user_id").references(() => inventorsUsers.id, { onDelete: "cascade" }),
  searchText: text("search_text").notNull(),
  results: jsonb("results"),
  analysis: jsonb("analysis"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Pannu Test records - stores inventorship validation for each claim
export const pannuRecords = pgTable("pannu_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conceptId: text("concept_id").notNull(), // ID of the concept/claim being validated
  claimText: text("claim_text").notNull(), // The claim text being validated
  strategyContext: text("strategy_context"), // White space strategy context
  questions: jsonb("questions"), // Generated Pannu questions
  answers: jsonb("answers"), // Human inventor's answers
  certificationStatus: text("certification_status"), // 'Certified', 'Needs Clarification', 'Rejected'
  confidenceScore: text("confidence_score"), // 0.0 to 1.0 as string
  pannuRecordText: text("pannu_record_text"), // Detailed justification
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────
// Provenance & proof system
//
// Three tables that, together, produce a cryptographically verifiable record
// that a given disclosure existed at a given time and has not been altered:
//
//   provenance_events  — append-only hash-chained log of every meaningful
//                        write. Internal tamper detection; chain breaks on
//                        any historic mutation.
//   provenance_stamps  — RFC 3161 TimeStampTokens from FreeTSA, one per
//                        checkpoint event (finalize / export).
//   provenance_anchors — daily Merkle root anchored via OpenTimestamps into
//                        the Bitcoin blockchain. The legal heavyweight: free,
//                        permanent, third-party verifiable.
//
// All-free architecture: FreeTSA + OpenTimestamps + local SHA-256. No paid
// timestamp authorities, no per-stamp cost.
// ─────────────────────────────────────────────────────────────────────────

export const provenanceEvents = pgTable("provenance_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id"),
  eventType: text("event_type").notNull(),
  refTable: text("ref_table").notNull(),
  refId: text("ref_id"),
  payloadHash: text("payload_hash").notNull(),
  payloadCanonical: text("payload_canonical"),
  prevHash: text("prev_hash"),
  eventHash: text("event_hash").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const provenanceStamps = pgTable("provenance_stamps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  eventId: varchar("event_id").notNull().references(() => provenanceEvents.id, { onDelete: "cascade" }),
  tsaUrl: text("tsa_url").notNull(),
  requestHash: text("request_hash").notNull(),
  tsaResponse: text("tsa_response").notNull(), // base64-encoded .tsr bytes
  tsaCert: text("tsa_cert"),                   // base64-encoded cert chain
  createdAt: timestamp("created_at").defaultNow(),
});

export const provenanceAnchors = pgTable("provenance_anchors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  anchorDate: text("anchor_date").notNull(), // YYYY-MM-DD UTC
  eventCount: integer("event_count").notNull(),
  merkleRoot: text("merkle_root").notNull(),
  otsProof: text("ots_proof").notNull(),     // base64-encoded .ots bytes
  otsUpgradedAt: timestamp("ots_upgraded_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Human-input ledger — every verbatim statement the user types into any
// agent page, captured at save-time, tagged so downstream steps can pre-fill
// answers from prior typing instead of asking the user to retype.
//
// Pure passthrough: NO AI ever rewrites these rows. The promptText / answerText
// are exactly what the user saw and typed. Tags map to factor categories
// (see server/modules/human-inputs/tags.ts for the controlled vocabulary).
// The Pannu pre-fill engine reads this table to draft answers from the user's
// own earlier words across Modules 0 / 1 / 2 / 3 / 4.
export const humanInputs = pgTable("human_inputs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Where the input came from — e.g. "module0/qa-assistant",
  // "module2/refinement", "module4a/concept-notes", "module4b/rationale".
  source: text("source").notNull(),
  // Optional within-source ref (e.g. a concept index, a message id).
  sourceRefId: text("source_ref_id"),
  // The prompt or placeholder the user saw (null for free-form inputs).
  promptText: text("prompt_text"),
  // The user's verbatim words — never AI-rewritten.
  answerText: text("answer_text").notNull(),
  // Controlled-vocabulary tags. See server/modules/human-inputs/tags.ts.
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  // Optional concept scoping — when the input is about a specific
  // concept, set this so pre-fill can filter.
  conceptId: text("concept_id"),
  charCount: integer("char_count").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// AI usage log — one row per server-side AI call across the app.
// Lives in the `inventor_geyser_admin` schema so observability data stays
// out of the product schema. Written fire-and-forget so a failed log never
// breaks an AI request. `agentLabel` is the user-friendly name from
// server/ai/usage-log.ts (e.g. "Whitespace (Stage 4a)").
export const aiUsageLog = adminTable("ai_usage_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),         // inventors_users.id or users.id; nullable for unauthenticated calls
  userEmail: text("user_email"),      // captured at insert time so the log stays readable if the user is later deleted
  projectId: varchar("project_id"),   // nullable (some calls aren't project-scoped)
  agentLabel: text("agent_label").notNull(), // friendly name: "Whitespace (Stage 4a)", "AI Helper", ...
  model: text("model").notNull(),     // "gemini-pro-latest", "gpt-4o", ...
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cachedTokens: integer("cached_tokens"),
  totalTokens: integer("total_tokens"),
  durationMs: integer("duration_ms"),
  status: text("status").notNull(),   // "ok" | "retry" | "fallback" | "error"
  fallbackFrom: text("fallback_from"), // set when this call replaced a failed Gemini attempt
  usedSecondaryKey: boolean("used_secondary_key").default(false),
  requestId: text("request_id"),       // Vercel request id for cross-correlation, when available
  errorMessage: text("error_message"), // populated when status = "error"
  metadata: jsonb("metadata"),         // free-form per-call extras
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const inventorsUsersRelations = relations(inventorsUsers, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  inventorUser: one(inventorsUsers, {
    fields: [projects.inventorsUserId],
    references: [inventorsUsers.id],
  }),
  agentData: many(agentData),
  ideaSnapshots: many(ideaSnapshots),
  pannuRecords: many(pannuRecords),
}));

export const agentDataRelations = relations(agentData, ({ one }) => ({
  project: one(projects, {
    fields: [agentData.projectId],
    references: [projects.id],
  }),
}));

export const ideaSnapshotsRelations = relations(ideaSnapshots, ({ one }) => ({
  project: one(projects, {
    fields: [ideaSnapshots.projectId],
    references: [projects.id],
  }),
}));

export const pannuRecordsRelations = relations(pannuRecords, ({ one }) => ({
  project: one(projects, {
    fields: [pannuRecords.projectId],
    references: [projects.id],
  }),
}));

export const priorArtSearchesRelations = relations(priorArtSearches, ({ one }) => ({
  user: one(users, {
    fields: [priorArtSearches.userId],
    references: [users.id],
  }),
}));

// Zod schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInventorUserSchema = createInsertSchema(inventorsUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  projectLimit: true, // server-controlled
});

export const insertProjectSchema = createInsertSchema(projects, {
  userId: z.string().nullable().optional(),
  inventorsUserId: z.string().nullable().optional(),
  sourceCodeFiles: z.array(z.object({
    id: z.string(),
    fileName: z.string(),
    description: z.string(),
    code: z.string(),
    addedAt: z.string(),
  })).nullable().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAgentDataSchema = createInsertSchema(agentData).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPannuRecordSchema = createInsertSchema(pannuRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertIdeaSnapshotSchema = createInsertSchema(ideaSnapshots).omit({
  id: true,
  createdAt: true,
});

export const insertPriorArtSearchSchema = createInsertSchema(priorArtSearches, {
  userId: z.string().nullable().optional(),
  inventorsUserId: z.string().nullable().optional(),
}).omit({
  id: true,
  createdAt: true,
});

export const insertHumanInputSchema = createInsertSchema(humanInputs, {
  tags: z.array(z.string()).default([]),
  sourceRefId: z.string().nullable().optional(),
  promptText: z.string().nullable().optional(),
  conceptId: z.string().nullable().optional(),
}).omit({
  id: true,
  charCount: true, // server computes
  createdAt: true,
  updatedAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertInventorUser = z.infer<typeof insertInventorUserSchema>;
export type InventorUser = typeof inventorsUsers.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertAgentData = z.infer<typeof insertAgentDataSchema>;
export type AgentData = typeof agentData.$inferSelect;
export type InsertPannuRecord = z.infer<typeof insertPannuRecordSchema>;
export type PannuRecord = typeof pannuRecords.$inferSelect;
export type InsertIdeaSnapshot = z.infer<typeof insertIdeaSnapshotSchema>;
export type IdeaSnapshot = typeof ideaSnapshots.$inferSelect;
export type InsertPriorArtSearch = z.infer<typeof insertPriorArtSearchSchema>;
export type PriorArtSearch = typeof priorArtSearches.$inferSelect;
export type InsertHumanInput = z.infer<typeof insertHumanInputSchema>;
export type HumanInput = typeof humanInputs.$inferSelect;

// Email whitelist table — only listed emails may register or log in
export const emailWhitelist = pgTable("email_whitelist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  note: text("note"), // optional label for who this is
  status: text("status").notNull().default("active"), // 'active' | 'read_only'
  addedAt: timestamp("added_at").defaultNow(),
});

export type EmailWhitelistEntry = typeof emailWhitelist.$inferSelect;

// -----------------------------------------------------------------------------
// Project Families — organizational grouping of sibling patents covering the
// same product domain. A family is just a label + ownership; the membership
// link is `projects.family_id`. Cross-sibling overlap warnings are powered by
// the `projectFamilyArtifacts` cache below (digests computed once at save time
// on the owning project, never recomputed at viewer-side check time).
// -----------------------------------------------------------------------------

export const projectFamilies = pgTable("project_families", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerUserId: varchar("owner_user_id"),
  inventorsUserId: varchar("inventors_user_id"),
  title: text("title").notNull(),
  description: text("description"),
  // Free-text background the inventor can edit after creation. Distinct from
  // `description` (a short label): `context` is injected into the AI helper's
  // FAMILY CONTEXT block so every sibling is drafted with it in view.
  context: text("context"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

// Cached per-artifact digest of a sibling's notable content. Written exactly
// once per save by the owning project; read by sibling-overlap checks. Hash
// is mandatory; embedding is optional (populated when semantic overlap layer
// is enabled — V1 ships hash-only, embedding column stays NULL).
export const projectFamilyArtifacts = pgTable("project_family_artifacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  familyId: varchar("family_id"),
  artifactKind: text("artifact_kind").notNull(), // 'idea_summary' | 'extracted_idea' | 'key_concept'
  artifactRef: text("artifact_ref").notNull(),
  preview: text("preview").notNull(),
  charCount: integer("char_count").notNull().default(0),
  hash: text("hash").notNull(),
  // pgvector column. 1536 dims matches OpenAI text-embedding-3-small native
  // output. NULL until the save-time embedding writer fills it. Used by
  // getRelevantFamilyArtifacts for semantic retrieval on edit-text stages.
  embedding: vector("embedding", { dimensions: 1536 }),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProjectFamilySchema = createInsertSchema(projectFamilies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export const insertProjectFamilyArtifactSchema = createInsertSchema(projectFamilyArtifacts).omit({
  id: true,
  updatedAt: true,
});

export type ProjectFamily = typeof projectFamilies.$inferSelect;
export type InsertProjectFamily = z.infer<typeof insertProjectFamilySchema>;
export type ProjectFamilyArtifact = typeof projectFamilyArtifacts.$inferSelect;
export type InsertProjectFamilyArtifact = z.infer<typeof insertProjectFamilyArtifactSchema>;

// External reference documents uploaded at the family level. Used as
// shared context for every sibling. Heavy fields (file_bytes_b64,
// extracted_text) are only read on demand — list endpoints return only
// metadata + summary.
export const projectFamilyContextFiles = pgTable("project_family_context_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  familyId: varchar("family_id").notNull(),
  uploadedByUserId: varchar("uploaded_by_user_id"),
  uploadedByInventorsUserId: varchar("uploaded_by_inventors_user_id"),
  originalFilename: text("original_filename").notNull(),
  // Optional human-readable title; falls back to originalFilename in the UI.
  title: text("title"),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull().default(0),
  fileBytesB64: text("file_bytes_b64").notNull(),
  extractedText: text("extracted_text"),
  extractionStatus: text("extraction_status").notNull().default("pending"),
  extractionError: text("extraction_error"),
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
  // Patent metadata — same shape as projects so the same dialog edits both.
  inventorNames: text("inventor_names").array(),
  filedDate: date("filed_date"),
  status: text("status"),
  applicationNumber: text("application_number"),
  publicationNumber: text("publication_number"),
  assignee: text("assignee"),
  jurisdiction: text("jurisdiction"),
  patentType: text("patent_type"),
  externalUrl: text("external_url"),
  notes: text("notes"),
});

export type ProjectFamilyContextFile = typeof projectFamilyContextFiles.$inferSelect;

// Shared metadata shape used by both projects and context-files. The dialog
// component edits exactly this set; the API accepts the same shape on either
// resource. All fields are optional.
export const patentMetadataSchema = z.object({
  inventorNames: z.array(z.string()).optional().nullable(),
  filedDate: z.string().optional().nullable(), // ISO date string
  status: z.enum(["draft", "filed", "published", "granted", "converted", "abandoned", "expired"]).optional().nullable(),
  applicationNumber: z.string().optional().nullable(),
  publicationNumber: z.string().optional().nullable(),
  assignee: z.string().optional().nullable(),
  jurisdiction: z.string().optional().nullable(),
  patentType: z.enum(["provisional", "utility", "design", "plant", "pct", "other"]).optional().nullable(),
  externalUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type PatentMetadata = z.infer<typeof patentMetadataSchema>;
