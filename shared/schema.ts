import { sql, relations } from "drizzle-orm";
import { pgSchema, text, varchar, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";

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
