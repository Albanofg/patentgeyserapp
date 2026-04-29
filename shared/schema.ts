import { sql, relations } from "drizzle-orm";
import { pgSchema, text, varchar, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";

// All PatentGeyser (inventor/consumer) tables live under the `inventor_geyser`
// Postgres schema. The same Neon DB also hosts the twin (lawyer) app under the
// `patent_geyser` schema — DO NOT touch that schema from this app.
const inventorGeyser = pgSchema("inventor_geyser");
const pgTable = inventorGeyser.table.bind(inventorGeyser);
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

// PatentGeyser paid customers (GoHighLevel funnel). Separate from the shared
// `users` table used by the lawyer twin app. Same auth mechanism (bcrypt +
// email/password + 2FA), but each paid user has a project creation cap.
export const paidUsers = pgTable("paid_users", {
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
// Exactly one of userId / paidUserId is set per row (enforced at app layer).
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  paidUserId: varchar("paid_user_id").references(() => paidUsers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: text("category"), // deprecated — kept nullable for legacy rows
  currentStage: integer("current_stage").notNull().default(1), // 1-5 representing agent stages
  currentSubstage: text("current_substage"), // For Agent 2: '2a', '2b', '2c'
  completed: integer("completed").notNull().default(0), // 0 or 1 boolean
  sourceCodeFiles: jsonb("source_code_files").$type<SourceCodeFile[]>(), // Array of source code files
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
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
// Exactly one of userId / paidUserId is set per row.
export const priorArtSearches = pgTable("prior_art_searches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  paidUserId: varchar("paid_user_id").references(() => paidUsers.id, { onDelete: "cascade" }),
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

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const paidUsersRelations = relations(paidUsers, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  paidUser: one(paidUsers, {
    fields: [projects.paidUserId],
    references: [paidUsers.id],
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

export const insertPaidUserSchema = createInsertSchema(paidUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  projectLimit: true, // server-controlled
});

export const insertProjectSchema = createInsertSchema(projects, {
  userId: z.string().nullable().optional(),
  paidUserId: z.string().nullable().optional(),
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
  paidUserId: z.string().nullable().optional(),
}).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertPaidUser = z.infer<typeof insertPaidUserSchema>;
export type PaidUser = typeof paidUsers.$inferSelect;
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

// Email whitelist table — only listed emails may register or log in
export const emailWhitelist = pgTable("email_whitelist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  note: text("note"), // optional label for who this is
  status: text("status").notNull().default("active"), // 'active' | 'read_only'
  addedAt: timestamp("added_at").defaultNow(),
});

export type EmailWhitelistEntry = typeof emailWhitelist.$inferSelect;
