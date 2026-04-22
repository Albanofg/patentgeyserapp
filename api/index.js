import{createRequire as __cr}from'module';const require=__cr(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/app.ts
import "dotenv/config";
import express from "express";
import cors from "cors";

// server/routes.ts
import { createServer } from "http";
import https from "https";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  agentData: () => agentData,
  agentDataRelations: () => agentDataRelations,
  emailWhitelist: () => emailWhitelist,
  ideaSnapshots: () => ideaSnapshots,
  ideaSnapshotsRelations: () => ideaSnapshotsRelations,
  insertAgentDataSchema: () => insertAgentDataSchema,
  insertIdeaSnapshotSchema: () => insertIdeaSnapshotSchema,
  insertPannuRecordSchema: () => insertPannuRecordSchema,
  insertPriorArtSearchSchema: () => insertPriorArtSearchSchema,
  insertProjectSchema: () => insertProjectSchema,
  insertUserSchema: () => insertUserSchema,
  pannuRecords: () => pannuRecords,
  pannuRecordsRelations: () => pannuRecordsRelations,
  priorArtSearches: () => priorArtSearches,
  priorArtSearchesRelations: () => priorArtSearchesRelations,
  projects: () => projects,
  projectsRelations: () => projectsRelations,
  users: () => users,
  usersRelations: () => usersRelations
});
import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  // 2FA fields
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorMethod: text("two_factor_method"),
  // 'email' or 'totp'
  totpSecret: text("totp_secret"),
  // Secret for authenticator app
  pendingTwoFactorCode: text("pending_two_factor_code"),
  // Temporary code for email 2FA
  pendingTwoFactorExpiry: timestamp("pending_two_factor_expiry"),
  // When the code expires
  twoFactorVerifiedAt: timestamp("two_factor_verified_at"),
  // Session-level 2FA verification timestamp
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});
var projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: text("category").notNull(),
  // Software, SaaS, or Blockchain
  currentStage: integer("current_stage").notNull().default(1),
  // 1-5 representing agent stages
  currentSubstage: text("current_substage"),
  // For Agent 2: '2a', '2b', '2c'
  completed: integer("completed").notNull().default(0),
  // 0 or 1 boolean
  sourceCodeFiles: jsonb("source_code_files").$type(),
  // Array of source code files
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});
var agentData = pgTable("agent_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  agentNumber: integer("agent_number").notNull(),
  // 1-5
  data: jsonb("data").notNull(),
  // Flexible JSON storage for each agent's output
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});
var ideaSnapshots = pgTable("idea_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  // Sequential version number
  snapshotType: text("snapshot_type").notNull(),
  // See types above
  title: text("title"),
  // Brief title/label for this snapshot
  content: text("content").notNull(),
  // The idea content at this point (human-readable markdown)
  command: text("command"),
  // The user command that triggered this snapshot (for mechanic types)
  qualityScore: text("quality_score"),
  // Score from internal quality loop (for mechanic types)
  metadata: jsonb("metadata"),
  // Structured data: selectedIdeas, priorArt, claims, diagrams, etc.
  createdAt: timestamp("created_at").defaultNow()
});
var priorArtSearches = pgTable("prior_art_searches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  searchText: text("search_text").notNull(),
  results: jsonb("results"),
  // Array of prior art results
  analysis: jsonb("analysis"),
  // Analysis with key_differentiators, claims_focus, etc.
  createdAt: timestamp("created_at").defaultNow()
});
var pannuRecords = pgTable("pannu_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conceptId: text("concept_id").notNull(),
  // ID of the concept/claim being validated
  claimText: text("claim_text").notNull(),
  // The claim text being validated
  strategyContext: text("strategy_context"),
  // White space strategy context
  questions: jsonb("questions"),
  // Generated Pannu questions
  answers: jsonb("answers"),
  // Human inventor's answers
  certificationStatus: text("certification_status"),
  // 'Certified', 'Needs Clarification', 'Rejected'
  confidenceScore: text("confidence_score"),
  // 0.0 to 1.0 as string
  pannuRecordText: text("pannu_record_text"),
  // Detailed justification
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});
var usersRelations = relations(users, ({ many }) => ({
  projects: many(projects)
}));
var projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id]
  }),
  agentData: many(agentData),
  ideaSnapshots: many(ideaSnapshots),
  pannuRecords: many(pannuRecords)
}));
var agentDataRelations = relations(agentData, ({ one }) => ({
  project: one(projects, {
    fields: [agentData.projectId],
    references: [projects.id]
  })
}));
var ideaSnapshotsRelations = relations(ideaSnapshots, ({ one }) => ({
  project: one(projects, {
    fields: [ideaSnapshots.projectId],
    references: [projects.id]
  })
}));
var pannuRecordsRelations = relations(pannuRecords, ({ one }) => ({
  project: one(projects, {
    fields: [pannuRecords.projectId],
    references: [projects.id]
  })
}));
var priorArtSearchesRelations = relations(priorArtSearches, ({ one }) => ({
  user: one(users, {
    fields: [priorArtSearches.userId],
    references: [users.id]
  })
}));
var insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});
var insertProjectSchema = createInsertSchema(projects, {
  sourceCodeFiles: z.array(z.object({
    id: z.string(),
    fileName: z.string(),
    description: z.string(),
    code: z.string(),
    addedAt: z.string()
  })).nullable().optional()
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});
var insertAgentDataSchema = createInsertSchema(agentData).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});
var insertPannuRecordSchema = createInsertSchema(pannuRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});
var insertIdeaSnapshotSchema = createInsertSchema(ideaSnapshots).omit({
  id: true,
  createdAt: true
});
var insertPriorArtSearchSchema = createInsertSchema(priorArtSearches).omit({
  id: true,
  createdAt: true
});
var emailWhitelist = pgTable("email_whitelist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  note: text("note"),
  // optional label for who this is
  status: text("status").notNull().default("active"),
  // 'active' | 'read_only'
  addedAt: timestamp("added_at").defaultNow()
});

// server/db.ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
var pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 3e4,
  connectionTimeoutMillis: 1e4
});
pool.on("error", (err) => {
  if (err.code === "57P01") {
    console.log("PG Pool: Connection terminated by server (idle timeout) - this is normal");
  } else {
    console.error("PG Pool error:", err);
  }
});
var db = drizzle({ client: pool, schema: schema_exports });

// server/storage.ts
import { eq, and, desc, sql as sql2 } from "drizzle-orm";
var DatabaseStorage = class {
  // User operations
  async getUser(id) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || void 0;
  }
  async getUserByEmail(email) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || void 0;
  }
  async createUser(insertUser) {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }
  async updateUser2FA(userId, data) {
    const [user] = await db.update(users).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(users.id, userId)).returning();
    return user || void 0;
  }
  async updateUserPassword(userId, hashedPassword) {
    const [user] = await db.update(users).set({ password: hashedPassword, updatedAt: /* @__PURE__ */ new Date() }).where(eq(users.id, userId)).returning();
    return user || void 0;
  }
  // Project operations
  async getProject(id) {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project || void 0;
  }
  async getProjectsByUserId(userId) {
    return await db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
  }
  async createProject(insertProject) {
    const [project] = await db.insert(projects).values(insertProject).returning();
    return project;
  }
  async updateProject(id, data) {
    const [project] = await db.update(projects).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(projects.id, id)).returning();
    return project || void 0;
  }
  async deleteProject(id) {
    await db.delete(projects).where(eq(projects.id, id));
  }
  // Agent data operations
  async getAgentData(projectId, agentNumber) {
    const [data] = await db.select().from(agentData).where(and(eq(agentData.projectId, projectId), eq(agentData.agentNumber, agentNumber))).orderBy(desc(agentData.createdAt));
    return data || void 0;
  }
  async upsertAgentData(insertData) {
    const existing = await this.getAgentData(insertData.projectId, insertData.agentNumber);
    if (existing) {
      const [updated] = await db.update(agentData).set({ data: insertData.data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(agentData.id, existing.id)).returning();
      return updated;
    } else {
      const [created] = await db.insert(agentData).values(insertData).returning();
      return created;
    }
  }
  async mergeAgentData(projectId, agentNumber, partialData) {
    const existing = await this.getAgentData(projectId, agentNumber);
    if (existing) {
      const [updated] = await db.update(agentData).set({
        data: sql2`${agentData.data} || ${JSON.stringify(partialData)}::jsonb`,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq(agentData.id, existing.id)).returning();
      return updated;
    } else {
      const [created] = await db.insert(agentData).values({ projectId, agentNumber, data: partialData }).returning();
      return created;
    }
  }
  async deleteAgentData(projectId, agentNumber) {
    await db.delete(agentData).where(and(eq(agentData.projectId, projectId), eq(agentData.agentNumber, agentNumber)));
  }
  async getAllAgentDataForProject(projectId) {
    return await db.select().from(agentData).where(eq(agentData.projectId, projectId)).orderBy(agentData.agentNumber);
  }
  // Pannu record operations
  async getPannuRecords(projectId) {
    return await db.select().from(pannuRecords).where(eq(pannuRecords.projectId, projectId)).orderBy(desc(pannuRecords.createdAt));
  }
  async getPannuRecord(projectId, conceptId) {
    const [record] = await db.select().from(pannuRecords).where(and(eq(pannuRecords.projectId, projectId), eq(pannuRecords.conceptId, conceptId)));
    return record || void 0;
  }
  async createPannuRecord(insertRecord) {
    const [record] = await db.insert(pannuRecords).values(insertRecord).returning();
    return record;
  }
  async updatePannuRecord(id, data) {
    const [record] = await db.update(pannuRecords).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(pannuRecords.id, id)).returning();
    return record || void 0;
  }
  // Idea snapshot operations
  async getIdeaSnapshots(projectId) {
    return await db.select().from(ideaSnapshots).where(eq(ideaSnapshots.projectId, projectId)).orderBy(ideaSnapshots.version);
  }
  async getLatestIdeaSnapshot(projectId) {
    const [snapshot] = await db.select().from(ideaSnapshots).where(eq(ideaSnapshots.projectId, projectId)).orderBy(desc(ideaSnapshots.version)).limit(1);
    return snapshot || void 0;
  }
  async createIdeaSnapshot(insertSnapshot) {
    const [snapshot] = await db.insert(ideaSnapshots).values(insertSnapshot).returning();
    return snapshot;
  }
  async getNextSnapshotVersion(projectId) {
    const latest = await this.getLatestIdeaSnapshot(projectId);
    return (latest?.version || 0) + 1;
  }
  // Prior art search operations
  async getPriorArtSearches(userId) {
    return await db.select().from(priorArtSearches).where(eq(priorArtSearches.userId, userId)).orderBy(desc(priorArtSearches.createdAt));
  }
  async createPriorArtSearch(insertSearch) {
    const [search] = await db.insert(priorArtSearches).values(insertSearch).returning();
    return search;
  }
  async deletePriorArtSearch(id) {
    await db.delete(priorArtSearches).where(eq(priorArtSearches.id, id));
  }
  // Email whitelist operations
  async isEmailWhitelisted(email) {
    const [entry] = await db.select().from(emailWhitelist).where(eq(emailWhitelist.email, email.toLowerCase().trim()));
    return !!entry;
  }
  async getWhitelistEntry(email) {
    const [entry] = await db.select().from(emailWhitelist).where(eq(emailWhitelist.email, email.toLowerCase().trim()));
    return entry || void 0;
  }
  async getWhitelistedEmails() {
    return await db.select().from(emailWhitelist).orderBy(emailWhitelist.addedAt);
  }
  async addEmailToWhitelist(email, note) {
    const [entry] = await db.insert(emailWhitelist).values({ email: email.toLowerCase().trim(), note: note || null, status: "active" }).returning();
    return entry;
  }
  async removeEmailFromWhitelist(email) {
    await db.delete(emailWhitelist).where(eq(emailWhitelist.email, email.toLowerCase().trim()));
  }
  async updateWhitelistStatus(email, status) {
    const [entry] = await db.update(emailWhitelist).set({ status }).where(eq(emailWhitelist.email, email.toLowerCase().trim())).returning();
    if (!entry) throw new Error("Email not found in whitelist");
    return entry;
  }
  async getAdminUsers() {
    const result = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.two_factor_enabled AS "twoFactorEnabled",
        w.status AS "subscriptionStatus",
        w.note,
        COUNT(p.id)::int AS "projectCount",
        u.last_login_at AS "lastLoginAt",
        u.created_at AS "createdAt",
        COALESCE(
          json_agg(
            json_build_object('stage', p.current_stage, 'substage', p.current_substage)
            ORDER BY p.created_at ASC
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
        ) AS "projectStages"
      FROM users u
      LEFT JOIN email_whitelist w ON lower(u.email) = w.email
      LEFT JOIN projects p ON p.user_id = u.id
      GROUP BY u.id, u.email, u.two_factor_enabled, w.status, w.note, u.last_login_at, u.created_at
      ORDER BY u.last_login_at DESC NULLS LAST
    `);
    return result.rows;
  }
  async updateLastLogin(userId) {
    await db.update(users).set({ lastLoginAt: /* @__PURE__ */ new Date() }).where(eq(users.id, userId));
  }
};
var storage = new DatabaseStorage();

// server/routes.ts
import { z as z2 } from "zod";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { generateSecret, generateURI, verify as verifyTOTP } from "otplib";
import QRCode from "qrcode";

// server/ai/client.ts
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
var gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
var openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
function isGemini(model) {
  return model.startsWith("gemini");
}
var GEMINI_SAFETY_OFF = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE }
];
var EMPTY_RESPONSE_GUARD = "\n\nCRITICAL: You must never return an empty response. If you cannot process an item due to safety or content restrictions, you must output the exact string 'ITEM_FILTERED' instead of returning nothing.";
async function callGemini(opts, model) {
  const systemInstruction = (opts.systemPrompt || "") + EMPTY_RESPONSE_GUARD;
  const maxOutputTokens = Math.max(opts.config.maxTokens || 0, 2048);
  const response = await gemini.models.generateContent({
    model,
    contents: opts.userMessage,
    config: {
      systemInstruction,
      maxOutputTokens,
      temperature: opts.config.temperature,
      topP: opts.config.topP,
      responseMimeType: opts.jsonMode ? "application/json" : "text/plain",
      safetySettings: GEMINI_SAFETY_OFF
    }
  });
  const text2 = response.text;
  if (!text2) {
    const finishReason = response.candidates?.[0]?.finishReason;
    const blockReason = response.promptFeedback?.blockReason;
    throw new Error(
      `Gemini returned empty response (finishReason=${finishReason ?? "n/a"}, blockReason=${blockReason ?? "n/a"})`
    );
  }
  return text2;
}
async function callGPT(opts, model) {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userMessage }
    ],
    max_tokens: opts.config.maxTokens,
    temperature: opts.config.temperature,
    top_p: opts.config.topP,
    ...opts.jsonMode ? { response_format: { type: "json_object" } } : {}
  });
  const text2 = response.choices[0]?.message?.content;
  if (!text2) throw new Error("GPT returned empty response");
  return text2;
}
async function callModel(opts, model) {
  if (isGemini(model)) {
    return await callGemini(opts, model);
  } else {
    return await callGPT(opts, model);
  }
}
async function callAgent(opts) {
  const { model, fallback } = opts.config;
  const started = Date.now();
  console.log(`[AI] -> ${model} (maxTokens=${opts.config.maxTokens}, temp=${opts.config.temperature})`);
  try {
    const result = await callModel(opts, model);
    console.log(`[AI] <- ${model} ok (${Date.now() - started}ms, ${result.length} chars)`);
    return result;
  } catch (error) {
    console.error(`[AI] ${model} failed after ${Date.now() - started}ms:`, error.message);
    if (!fallback) throw error;
    console.log(`[AI] -> fallback ${fallback}`);
    const fbStarted = Date.now();
    try {
      const result = await callModel(opts, fallback);
      console.log(`[AI] <- ${fallback} ok (${Date.now() - fbStarted}ms, ${result.length} chars)`);
      return result;
    } catch (fallbackError) {
      console.error(`[AI] Fallback ${fallback} also failed after ${Date.now() - fbStarted}ms:`, fallbackError.message);
      throw fallbackError;
    }
  }
}
async function callAgentJSON(opts) {
  const raw = await callAgent({ ...opts, jsonMode: true });
  try {
    return JSON.parse(raw);
  } catch {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    throw new Error(`Failed to parse AI response as JSON: ${raw.substring(0, 200)}`);
  }
}
var configCache = /* @__PURE__ */ new Map();
var promptCache = /* @__PURE__ */ new Map();
function loadAgentConfig(modulePath) {
  let config = configCache.get(modulePath);
  if (!config || process.env.NODE_ENV !== "production") {
    const fullPath = path.resolve(process.cwd(), "server", "modules", modulePath);
    config = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    configCache.set(modulePath, config);
  }
  return config;
}
function loadPrompt(modulePath, vars = {}) {
  let template = promptCache.get(modulePath);
  if (!template || process.env.NODE_ENV !== "production") {
    const fullPath = path.resolve(process.cwd(), "server", "modules", modulePath);
    template = fs.readFileSync(fullPath, "utf-8");
    promptCache.set(modulePath, template);
  }
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// server/modules/module0/qa-assistant.ts
function buildContext(payload) {
  const { projectContext, conversationHistory, currentLocation } = payload;
  const sections = [];
  if (projectContext.projectTitle || projectContext.category || projectContext.currentStage) {
    let projectInfo = "## PROJECT INFO";
    if (projectContext.projectTitle) projectInfo += `
Title: ${projectContext.projectTitle}`;
    if (projectContext.category) projectInfo += `
Category: ${projectContext.category}`;
    if (projectContext.currentStage) projectInfo += `
Current Stage: Module ${projectContext.currentStage}`;
    if (currentLocation) projectInfo += `
Location: ${currentLocation}`;
    sections.push(projectInfo);
  }
  if (projectContext.ideaSummary) {
    sections.push(`## IDEA SUMMARY
${projectContext.ideaSummary}`);
  }
  const statusParts = [];
  if (projectContext.priorArtResults) statusParts.push(`Prior Art: ${projectContext.priorArtResults}`);
  if (projectContext.whiteSpaceAnalysis) statusParts.push(`White Space: ${projectContext.whiteSpaceAnalysis}`);
  if (projectContext.claimsGenerated) statusParts.push(`Claims Generated: ${projectContext.claimsGenerated}`);
  if (projectContext.hasProvisionalDraft) statusParts.push(`Provisional Draft: Ready`);
  if (projectContext.hasDiagrams) statusParts.push(`Diagrams: ${projectContext.diagramCount || "Yes"}`);
  if (statusParts.length) sections.push(`## STATUS
${statusParts.join("\n")}`);
  if (projectContext.specificClaims?.length) {
    const claimsPreview = projectContext.specificClaims.slice(0, 3).join("\n\n");
    const moreCount = projectContext.specificClaims.length - 3;
    sections.push(
      `## SPECIFIC CLAIMS (${projectContext.specificClaims.length} total)
${claimsPreview}${moreCount > 0 ? `

[...and ${moreCount} more claims]` : ""}`
    );
  }
  if (projectContext.broaderClaims?.length) {
    sections.push(
      `## BROADER CLAIMS (${projectContext.broaderClaims.length} total)
${projectContext.broaderClaims.slice(0, 2).join("\n\n")}`
    );
  }
  if (conversationHistory?.length) {
    const recentHistory = conversationHistory.slice(-4).map((m) => `${m.role.toUpperCase()}: ${m.content.length > 300 ? m.content.substring(0, 300) + "..." : m.content}`).join("\n\n");
    sections.push(`## RECENT CONVERSATION
${recentHistory}`);
  }
  return sections.length ? sections.join("\n\n---\n\n") : "";
}
async function runQAAssistant(payload) {
  console.log("[Module0/QA-Assistant] Running...");
  const config = loadAgentConfig("module0/qa-assistant.config.json");
  const systemPrompt = loadPrompt("module0/qa-assistant.md");
  const context = buildContext(payload);
  const userMessage = `This is the User Input:
${payload.message}

This is the Project Context:
${context}`;
  const result = await callAgent({
    systemPrompt,
    userMessage,
    config,
    jsonMode: false
  });
  console.log("[Module0/QA-Assistant] Done");
  return result;
}

// server/modules/module1/1a/debate.ts
async function runDebate(payload) {
  const idea = payload.idea;
  console.log(">>> [M1-1a DEBATE] <<< direct AI \u2014 Advocate + Examiner in parallel");
  try {
    const [advocateResult, examinerResult] = await Promise.all([
      runAdvocate(idea),
      runExaminer(idea)
    ]);
    console.log(">>> [M1-1a DEBATE] <<< complete \u2014 both agents responded");
    const transcript = `\u{1F3AD} PATENT GEYSER
${"=".repeat(60)}

\u{1F4A1} IDEA: ${idea}

\u2705 ADVOCATE:
${advocateResult}

\u274C EXAMINER:
${examinerResult}

${"=".repeat(60)}`;
    return {
      success: true,
      data: {
        fullDebate: [
          { speaker: "Advocate", message: advocateResult },
          { speaker: "Examiner", message: examinerResult }
        ],
        transcript,
        category: payload.category || "software",
        totalRounds: 1,
        debateComplete: true,
        metadata: {
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          rounds: 1,
          totalExchanges: 2
        }
      }
    };
  } catch (error) {
    console.error(">>> [M1-1a DEBATE] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message.includes("empty") || message.includes("no response") ? "AI service returned an empty response. Please try again." : message || "AI debate failed";
    return {
      success: false,
      error: errorMessage
    };
  }
}
async function runAdvocate(idea) {
  console.log("[M1-1a/Advocate] Running...");
  const config = loadAgentConfig("module1/1a/advocate.config.json");
  const systemPrompt = loadPrompt("module1/1a/advocate.md", { idea });
  const result = await callAgent({ systemPrompt, userMessage: idea, config });
  console.log("[M1-1a/Advocate] Done");
  return result;
}
async function runExaminer(idea) {
  console.log("[M1-1a/Examiner] Running...");
  const config = loadAgentConfig("module1/1a/examiner.config.json");
  const systemPrompt = loadPrompt("module1/1a/examiner.md", { idea });
  const result = await callAgent({ systemPrompt, userMessage: idea, config });
  console.log("[M1-1a/Examiner] Done");
  return result;
}

// server/modules/module1/1b/reanalyze.ts
async function runReanalyze(payload) {
  console.log(">>> [M1-1b REANALYZE] <<< direct AI \u2014 Advocate + Examiner audit in parallel");
  const [advocateResult, examinerResult] = await Promise.all([
    runAdvocateAudit(payload),
    runExaminerAudit(payload)
  ]);
  console.log(">>> [M1-1b REANALYZE] <<< complete \u2014 both agents responded");
  const transcript = `\u{1F3AD} PATENT GEYSER - ROUND 2 AUDIT
${"=".repeat(60)}

\u{1F4A1} ORIGINAL IDEA: ${payload.mainIdea.substring(0, 100)}...

\u{1F4DD} NEW CONSOLIDATED IDEA: ${payload.newIdea.substring(0, 100)}...

\u2705 ADVOCATE AUDIT:
${advocateResult}

\u274C EXAMINER AUDIT:
${examinerResult}

${"=".repeat(60)}`;
  return {
    success: true,
    round: 2,
    auditResults: [
      { speaker: "Advocate", message: advocateResult },
      { speaker: "Examiner", message: examinerResult }
    ],
    transcript,
    category: payload.category,
    projectId: payload.projectId,
    sessionId: payload.sessionId,
    metadata: {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      roundType: "audit",
      totalAudits: 2
    }
  };
}
async function runAdvocateAudit(payload) {
  console.log("[M1-1b/Advocate] Running audit...");
  const config = loadAgentConfig("module1/1b/advocate.config.json");
  const systemPrompt = loadPrompt("module1/1b/advocate.md");
  const userMessage = `CONTEXT DATA:
1. Main Idea (Original): ${payload.mainIdea}
2. My Previous Analysis (The Checklist): ${payload.previousAdvocate}
3. New Consolidated Idea (The Target): ${payload.newIdea}
4. User Discards (Authorized Removals): ${payload.discardedTopics || "None"}

INSTRUCTION:
Perform a "Value Preservation Audit" of the New Consolidated Idea against My Previous Analysis.
Adhere strictly to the "Discard Rule": If a topic is in the User Discards list, mark it DISMISSED.
Return the audit log in strict JSON.`;
  const result = await callAgent({ systemPrompt, userMessage, config, jsonMode: true });
  console.log("[M1-1b/Advocate] Done");
  return result;
}
async function runExaminerAudit(payload) {
  console.log("[M1-1b/Examiner] Running audit...");
  const config = loadAgentConfig("module1/1b/examiner.config.json");
  const systemPrompt = loadPrompt("module1/1b/examiner.md");
  const userMessage = `CONTEXT DATA:
1. Main Idea (Original): ${payload.mainIdea}
2. My Previous Analysis (The Checklist): ${payload.previousExaminer}
3. New Consolidated Idea (The Target): ${payload.newIdea}
4. User Discards (Authorized Overrides): ${payload.discardedTopics || "None"}

INSTRUCTION:
Perform a "Rigorous Technical Audit" of the New Consolidated Idea against My Previous Analysis.
Adhere strictly to the "Discard Rule": If a topic is in the User Discards list, mark it DISMISSED.
Return the audit log in strict JSON.`;
  const result = await callAgent({ systemPrompt, userMessage, config, jsonMode: true });
  console.log("[M1-1b/Examiner] Done");
  return result;
}

// server/modules/module1/1c/r3-fixes.ts
async function runR3Fixes(payload) {
  const { coreIdea, needsWorkItems } = payload;
  console.log(`>>> [M1-1c R3-FIXES] <<< Generating R3 fixes for ${needsWorkItems.length} items`);
  if (!needsWorkItems || needsWorkItems.length === 0) {
    return { success: true, data: [] };
  }
  const config = loadAgentConfig("module1/1c/r3-fixes.config.json");
  const systemPrompt = loadPrompt("module1/1c/r3-fixes.md");
  const results = await Promise.all(
    needsWorkItems.map(async (item, idx) => {
      const userMessage = `Core Idea: ${coreIdea}

Original: ${item.original || ""}
Advocate: ${item.advocate || ""}
Examiner: ${item.examiner || ""}

Generate a SHORT fix (max 2-3 sentences). Address the examiner's concerns while maintaining claim strength.`;
      try {
        const ai_fix = (await callAgent({ systemPrompt, userMessage, config })).trim();
        return { ...item, ai_fix };
      } catch (err) {
        console.error(`>>> [M1-1c R3-FIXES] <<< Item ${idx} failed:`, err.message);
        return { ...item, ai_fix: "" };
      }
    })
  );
  console.log(`>>> [M1-1c R3-FIXES] <<< Generated ${results.filter((r) => r.ai_fix).length}/${results.length} fixes`);
  return { success: true, data: results };
}

// server/modules/module1/1d/list-creator.ts
function parseUnifiedList(agentOutput) {
  if (!agentOutput || typeof agentOutput !== "string") return [];
  const itemBlocks = agentOutput.split(/\n\s*Item:/i).slice(1);
  const items = [];
  for (const block of itemBlocks) {
    const lines = block.trim().split("\n");
    const item = { label: "", fromOriginal: "", fromGoodCop: "", fromBadCop: "" };
    item.label = (lines[0] || "").trim();
    let section = "";
    let buffer = [];
    const flush = () => {
      if (section && section !== "label" && buffer.length > 0) {
        item[section] = buffer.join(" ").trim();
      }
    };
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("From Original:")) {
        flush();
        section = "fromOriginal";
        buffer = [line.replace("From Original:", "").trim()];
      } else if (line.startsWith("From Good Cop:")) {
        flush();
        section = "fromGoodCop";
        buffer = [line.replace("From Good Cop:", "").trim()];
      } else if (line.startsWith("From Bad Cop:")) {
        flush();
        section = "fromBadCop";
        buffer = [line.replace("From Bad Cop:", "").trim()];
      } else if (line && section) {
        buffer.push(line);
      }
    }
    flush();
    if (item.label) items.push(item);
  }
  return items;
}
async function filterItem(item, systemPrompt, config) {
  const userMessage = `Evaluate this item for inclusion in final output:

Label: ${item.label}
From Original: ${item.fromOriginal}
From Good Cop: ${item.fromGoodCop}
From Bad Cop: ${item.fromBadCop}

Respond with ONLY "KEEP" or "REMOVE" (one word only).`;
  try {
    const decision = (await callAgent({ systemPrompt, userMessage, config })).trim().toUpperCase();
    return decision.startsWith("KEEP");
  } catch (err) {
    console.error(`[M1-1d/Filter] Item "${item.label}" failed:`, err.message);
    return true;
  }
}
async function runListCreator(payload) {
  console.log(">>> [M1-1d LIST-CREATOR] <<< List Creator \u2014 generating unified items");
  try {
    const listConfig = loadAgentConfig("module1/1d/list-maker.config.json");
    const listSystem = loadPrompt("module1/1d/list-maker.md");
    const listUserMessage = `Here are the three texts you must analyze:

ORIGINAL:
${payload.original || ""}

GOOD COP:
${payload.goodCop || ""}

BAD COP:
${payload.badCop || ""}

Please generate a Unified Items List based on your system rules.

Use one unified item per unique idea, and for each item include:

Item:
[a neutral label of the merged idea]

From Original:
[summary or quote, or "Not mentioned"]

From Good Cop:
[summary or quote, or "Not mentioned"]

From Bad Cop:
[summary or quote, or "Not mentioned"]

Output only the Unified Items List.`;
    const rawList = await callAgent({
      systemPrompt: listSystem,
      userMessage: listUserMessage,
      config: listConfig
    });
    const items = parseUnifiedList(rawList);
    console.log(`>>> [M1-1d LIST-CREATOR] <<< Parsed ${items.length} unified items \u2014 filtering in parallel`);
    if (items.length === 0) {
      return {
        success: true,
        data: { kept: [], removed: [], totalKept: 0, totalRemoved: 0 }
      };
    }
    const filterConfig = loadAgentConfig("module1/1d/filter.config.json");
    const filterSystem = loadPrompt("module1/1d/filter.md");
    const decisions = await Promise.all(items.map((item) => filterItem(item, filterSystem, filterConfig)));
    const kept = [];
    const removed = [];
    items.forEach((item, idx) => {
      if (decisions[idx]) {
        kept.push(item);
      } else {
        removed.push({ ...item, reason: "Filter agent marked as redundant" });
      }
    });
    console.log(`>>> [M1-1d LIST-CREATOR] <<< Kept ${kept.length}, removed ${removed.length}`);
    return {
      success: true,
      data: {
        kept,
        removed,
        totalKept: kept.length,
        totalRemoved: removed.length
      }
    };
  } catch (error) {
    console.error(">>> [M1-1d LIST-CREATOR] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message || "List creator failed";
    return {
      success: false,
      error: errorMessage
    };
  }
}

// server/modules/module1/1e/ai-modifier.ts
async function runAiModifier(payload) {
  console.log(`>>> [M1-1e AI-MODIFIER] <<< AI Idea Modifier \u2014 refining item: "${payload.item?.substring(0, 60)}..."`);
  try {
    const config = loadAgentConfig("module1/1e/ai-modifier.config.json");
    const systemPrompt = loadPrompt("module1/1e/ai-modifier.md");
    const userMessage = `Here is the MAIN IDEA (Context):
${payload.mainIdea || ""}

Here is the TITLE:
${payload.item || ""}

Here is the ORIGINAL IDEA (Draft):
${payload.fromOriginal || ""}

GOOD COP (Features to Integrate):
${payload.fromGoodCop || ""}

BAD COP (Flaws to Fix):
${payload.fromBadCop || ""}

**INSTRUCTIONS:**
Rewrite the ORIGINAL IDEA into a single, scientifically robust technical paragraph.
\u2022 **If it's in the ORIGINAL or GOOD COP:** Keep the feature, but describe it with technical precision (e.g., change "it writes like me" to "emulates user-specific syntactic patterns").
\u2022 **If it's in the BAD COP:** Fix the flaw by defining the missing mechanism.
\u2022 **Format:** Single dense paragraph. Patent English.

Output strictly the rewritten text, followed by a line "Improvements Made:" and a short bulleted list of the specific changes applied.`;
    const raw = await callAgent({ systemPrompt, userMessage, config });
    const parts = raw.split(/Improvements Made:/i);
    const improvedIdea = (parts[0] || "").trim();
    const improvementsMade = parts.length > 1 ? parts[1].trim() : "";
    console.log(`>>> [M1-1e AI-MODIFIER] <<< Done \u2014 improvedIdea ${improvedIdea.length} chars, improvementsMade ${improvementsMade.length} chars`);
    return {
      success: true,
      data: { improvedIdea, improvementsMade }
    };
  } catch (error) {
    console.error(">>> [M1-1e AI-MODIFIER] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message || "AI idea modifier failed";
    return {
      success: false,
      error: errorMessage
    };
  }
}

// server/modules/module2/2a/draft.ts
function stringify(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join("\n\n");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
async function runDraft(payload) {
  console.log(">>> [M2 DRAFT] <<< Generating provisional draft");
  try {
    const config = loadAgentConfig("module2/2a/draft.config.json");
    const systemPrompt = loadPrompt("module2/2a/draft.md");
    const userMessage = `IDEA SUMMARY:
${stringify(payload.ideaSummary)}

GOOD COP ANALYSIS:
${stringify(payload.goodCopInsights)}

BAD COP ANALYSIS:
${stringify(payload.badCopChallenges)}

FULL TRANSCRIPT:
${stringify(payload.fullTranscript)}

REFINEMENT FEEDBACK:
${stringify(payload.refinementFeedback)}

Your task is to evaluate all five sections.
Use them exactly as provided.
Do not infer priority.
The system message contains the authority rules and conflict resolution logic.`;
    const provisionalDraft = await callAgent({ systemPrompt, userMessage, config });
    console.log(`>>> [M2 DRAFT] <<< Done \u2014 ${provisionalDraft.length} chars`);
    return {
      success: true,
      provisionalDraft,
      idea: payload.idea ?? payload.ideaSummary,
      category: payload.category || "software",
      metadata: {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        wordCount: provisionalDraft.split(/\s+/).filter(Boolean).length,
        draftType: "provisional"
      }
    };
  } catch (error) {
    console.error(">>> [M2 DRAFT] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message.includes("empty") || message.includes("no response") ? "AI service returned an empty response. Please try again." : message || "Provisional draft generation failed";
    return {
      success: false,
      error: errorMessage
    };
  }
}

// server/modules/module2/2b/extract-concepts.ts
function normalizeIdeas(raw) {
  if (!raw) return [];
  const list = raw.ideas ?? raw.concepts ?? [];
  return list.map((s) => typeof s === "string" ? s.trim() : String(s).trim()).filter(Boolean);
}
async function runExtractConcepts(payload) {
  console.log(">>> [M2-2b EXTRACT-CONCEPTS] <<< extractor + refiner pipeline");
  try {
    const extractorConfig = loadAgentConfig("module2/2b/extractor.config.json");
    const extractorSystem = loadPrompt("module2/2b/extractor.md");
    const extractorUserMessage = `Here's the detailed concept:
${payload.detailedConcept}

Here's some code the user gives you so you can understand how it works (if it's empty, it means the user did not add any code):
${payload.codeFromTheUser || " "}`;
    const extractorRaw = await callAgentJSON({
      systemPrompt: extractorSystem,
      userMessage: extractorUserMessage,
      config: extractorConfig
    });
    const extracted = normalizeIdeas(extractorRaw);
    console.log(`>>> [M2-2b EXTRACT-CONCEPTS] <<< extractor produced ${extracted.length} concepts`);
    if (extracted.length === 0) {
      return {
        success: false,
        error: "Extractor returned no concepts. Please try again."
      };
    }
    const refinerConfig = loadAgentConfig("module2/2b/refiner.config.json");
    const refinerSystem = loadPrompt("module2/2b/refiner.md");
    const refinerUserMessage = `PROPOSED CONCEPTS (JSON):
${JSON.stringify({ ideas: extracted })}

ORIGINAL DETAILED CONCEPT (for context only \u2014 do not add new ideas):
${payload.detailedConcept}`;
    const refinerRaw = await callAgentJSON({
      systemPrompt: refinerSystem,
      userMessage: refinerUserMessage,
      config: refinerConfig
    });
    const refined = normalizeIdeas(refinerRaw);
    console.log(`>>> [M2-2b EXTRACT-CONCEPTS] <<< refiner kept ${refined.length}/${extracted.length}`);
    const finalIdeas = refined.length > 0 ? refined : extracted;
    return {
      success: true,
      ideas: finalIdeas,
      totalConcepts: finalIdeas.length
    };
  } catch (error) {
    console.error(">>> [M2-2b EXTRACT-CONCEPTS] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message.includes("Failed to parse AI response as JSON") ? "AI service returned invalid JSON. Please try again." : message || "Concept extraction failed";
    return {
      success: false,
      error: errorMessage
    };
  }
}

// server/modules/module4/4a/whitespace.ts
function matchPriorArt(idea, priorArtResults, index) {
  if (idea.id) {
    const byId = priorArtResults.find((pa) => pa.conceptId === idea.id);
    if (byId) return byId;
  }
  if (priorArtResults[index]) return priorArtResults[index];
  const searchText = (idea.text || idea.title || "").toLowerCase().substring(0, 40);
  if (searchText) {
    const byTitle = priorArtResults.find(
      (pa) => pa.conceptTitle && pa.conceptTitle.toLowerCase().includes(searchText)
    );
    if (byTitle) return byTitle;
  }
  return null;
}
function buildUserMessage(nugget) {
  const { nuggetTitle, nuggetDescription, expandedConcept, priorArt } = nugget;
  const priorArtBlock = priorArt.length ? priorArt.map((pa, idx) => {
    const pn = pa.publicationNumber || "";
    const granted = pn.endsWith("-B1") || pn.endsWith("-B2");
    return `---
PATENT ${idx + 1} of ${priorArt.length}:
  Publication Number: ${pn}
  Title: ${pa.title || ""}
  Summary: ${pa.summary || ""}
  Relevance Score: ${pa.relevanceScore ?? ""}
  Status: ${granted ? "GRANTED (Infringement Risk)" : "PENDING (Disclosure Risk)"}`;
  }).join("\n\n") : "No prior art found for this concept.";
  return `Analyze this inventive concept against ALL of the following prior art patents:

**Inventive Concept (Nugget):**
Title: ${nuggetTitle}
Description: ${nuggetDescription || "No additional description provided"}

**Full Invention Context:**
${expandedConcept}

**Prior Art Patents to Analyze (${priorArt.length} total):**
${priorArtBlock}

**CRITICAL: You must analyze EACH patent listed above and include it in your response.**

**Your Task:**
Conduct a rigorous differential analysis against EVERY patent listed. For each patent, determine if it creates a constraint on our claims. Return ONLY a JSON object with your comprehensive analysis.`;
}
function riskEmoji(level) {
  return level === "Green" ? "\u{1F7E2}" : level === "Yellow" ? "\u{1F7E1}" : level === "Red" ? "\u{1F534}" : "\u26AA";
}
function threatEmoji(level) {
  return level === "High" ? "\u{1F534}" : level === "Medium" ? "\u{1F7E1}" : "\u{1F7E2}";
}
function buildStrategicDirective(sessionId, conceptAnalyses) {
  let md = "# White Space Analysis - Strategic Directive for Claims Drafting\n\n";
  md += `**Analysis Date:** ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}
`;
  md += `**Session ID:** ${sessionId}
`;
  md += `**Total Concepts Analyzed:** ${conceptAnalyses.length}

`;
  md += "## Executive Summary\n\n";
  md += "| # | Concept Title | Risk Level | Patents Analyzed | High Threats |\n";
  md += "|---|---------------|------------|------------------|--------------|\n";
  conceptAnalyses.forEach((c, i) => {
    md += `| ${i + 1} | ${c.conceptTitle} | ${riskEmoji(c.overallRiskLevel)} ${c.overallRiskLevel} | ${c.totalPatentsAnalyzed} | ${c.threatCounts.high} |
`;
  });
  md += "\n---\n\n";
  conceptAnalyses.forEach((c, i) => {
    md += `## Concept ${i + 1}: ${c.conceptTitle}

`;
    if (c.conceptDescription) md += `> ${c.conceptDescription}

`;
    md += `### Overall Assessment
`;
    md += `* **Risk Level:** ${riskEmoji(c.overallRiskLevel)} ${c.overallRiskLevel}
`;
    md += `* **Patents Analyzed:** ${c.totalPatentsAnalyzed} (Input: ${c.priorArtInputCount})
`;
    md += `* **Threat Distribution:** \u{1F534} High: ${c.threatCounts.high} | \u{1F7E1} Medium: ${c.threatCounts.medium} | \u{1F7E2} Low: ${c.threatCounts.low}

`;
    if (c.patentAnalyses?.length > 0) {
      md += `### Prior Art Patent Analysis

`;
      c.patentAnalyses.forEach((pa, j) => {
        md += `#### ${j + 1}. ${pa.patentNumber} ${threatEmoji(pa.threatLevel)} ${pa.threatLevel}
`;
        md += `* **Title:** ${pa.patentTitle}
`;
        md += `* **Status:** ${pa.patentStatus}
`;
        md += `* **Specific Constraint:** "${pa.specificConstraint}"
`;
        md += `* **Differentiation Strategy:** ${pa.differentiationStrategy}
`;
        md += `* **Can Design Around:** ${pa.canDesignAround ? "\u2705 Yes" : "\u274C No"}

`;
      });
    } else {
      md += `### Prior Art Patent Analysis

*No prior art patents were found for this concept.*

`;
    }
    md += `### Strategic Guidance

`;
    md += `**White Space Strategy:**
${c.strategy.whiteSpaceStrategy}

`;
    if (c.strategy.primaryDifferentiators?.length > 0) {
      md += `**Primary Differentiators:**
`;
      c.strategy.primaryDifferentiators.forEach((d, idx) => {
        md += `${idx + 1}. ${d}
`;
      });
      md += "\n";
    }
    md += `**Claim Drafting Guidance:**
${c.strategy.claimDraftingGuidance}

`;
    md += "---\n\n";
  });
  return md;
}
async function runWhitespace(payload) {
  console.log(">>> [M4-4a WHITESPACE] <<< analyzing", payload.selectedIdeas?.length, "concepts");
  try {
    if (!Array.isArray(payload.selectedIdeas) || payload.selectedIdeas.length === 0) {
      return { success: false, error: "No selected ideas provided." };
    }
    if (!Array.isArray(payload.priorArtResults)) {
      return { success: false, error: "Missing priorArtResults." };
    }
    const config = loadAgentConfig("module4/4a/whitespace.config.json");
    const systemPrompt = loadPrompt("module4/4a/whitespace.md");
    const nuggetInputs = payload.selectedIdeas.map((idea, index) => {
      const matched = matchPriorArt(idea, payload.priorArtResults, index);
      const priorArt = matched?.priorArt || [];
      const nuggetTitle = matched?.conceptTitle || idea.title || idea.text || idea.name || `Concept ${index + 1}`;
      return {
        index,
        nuggetId: idea.id || `concept-${index}`,
        nuggetTitle,
        nuggetDescription: idea.description || "",
        priorArt,
        priorArtCount: priorArt.length
      };
    });
    const analyses = await Promise.all(
      nuggetInputs.map(async (nugget) => {
        try {
          const userMessage = buildUserMessage({
            nuggetTitle: nugget.nuggetTitle,
            nuggetDescription: nugget.nuggetDescription,
            expandedConcept: payload.expandedConcept || "",
            priorArt: nugget.priorArt
          });
          const parsed = await callAgentJSON({
            systemPrompt,
            userMessage,
            config
          });
          return { nugget, parsed, parseError: null };
        } catch (err) {
          console.error(
            `>>> [M4-4a WHITESPACE] <<< concept "${nugget.nuggetTitle}" failed:`,
            err.message
          );
          return { nugget, parsed: null, parseError: err.message || String(err) };
        }
      })
    );
    const conceptAnalyses = analyses.map(({ nugget, parsed, parseError }) => {
      const p = parsed || {};
      return {
        conceptNumber: nugget.index + 1,
        conceptId: nugget.nuggetId,
        conceptTitle: nugget.nuggetTitle,
        conceptDescription: nugget.nuggetDescription,
        overallRiskLevel: p.overallRiskLevel || (parseError ? "Error - Parse Failed" : "Unknown"),
        totalPatentsAnalyzed: p.totalPatentsAnalyzed ?? (p.patentAnalyses?.length || 0),
        priorArtInputCount: nugget.priorArtCount,
        threatCounts: {
          high: p.highThreatCount || 0,
          medium: p.mediumThreatCount || 0,
          low: p.lowThreatCount || 0
        },
        patentAnalyses: p.patentAnalyses || [],
        strategy: {
          whiteSpaceStrategy: p.consolidatedWhiteSpaceStrategy || (parseError ? `Analysis failed: ${parseError}` : "No strategy generated."),
          primaryDifferentiators: p.primaryDifferentiators || [],
          claimDraftingGuidance: p.claimDraftingGuidance || (parseError ? "Manual review required \u2014 AI call failed." : "")
        }
      };
    });
    const sessionId = payload.sessionId || "unknown";
    const strategicDirective = buildStrategicDirective(sessionId, conceptAnalyses);
    const summary = {
      totalConceptsAnalyzed: conceptAnalyses.length,
      totalPatentsAnalyzed: conceptAnalyses.reduce(
        (sum, a) => sum + (a.totalPatentsAnalyzed || 0),
        0
      ),
      totalHighThreats: conceptAnalyses.reduce(
        (sum, a) => sum + (a.threatCounts.high || 0),
        0
      ),
      riskDistribution: {
        green: conceptAnalyses.filter((a) => a.overallRiskLevel === "Green").length,
        yellow: conceptAnalyses.filter((a) => a.overallRiskLevel === "Yellow").length,
        red: conceptAnalyses.filter((a) => a.overallRiskLevel === "Red").length
      },
      conceptTitles: conceptAnalyses.map((a) => a.conceptTitle)
    };
    console.log(
      `>>> [M4-4a WHITESPACE] <<< done \u2014 ${summary.totalConceptsAnalyzed} concepts, ${summary.totalPatentsAnalyzed} patents, ${summary.totalHighThreats} high threats`
    );
    return {
      success: true,
      sessionId,
      strategicDirective,
      conceptAnalyses,
      summary,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (error) {
    console.error(">>> [M4-4a WHITESPACE] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message || "White space analysis failed";
    return { success: false, error: errorMessage };
  }
}

// server/modules/module4/4b/claims.ts
function normalizeWhiteSpace(ws2) {
  if (!ws2) return { contextBlock: "", perConcept: [] };
  const perConcept = [];
  let contextBlock = `

### PRIOR ART CONSTRAINTS:
${ws2.strategicDirective || ""}`;
  if (Array.isArray(ws2.conceptAnalyses) && ws2.conceptAnalyses.length > 0) {
    contextBlock += `

KEY DIFFERENTIATION POINTS:
`;
    ws2.conceptAnalyses.forEach((c, idx) => {
      const patentNums = (c.patentAnalyses || []).map((p) => p.patentNumber).filter(Boolean).join(", ");
      const topConstraint = (c.patentAnalyses || [])[0]?.specificConstraint || "";
      const wsStrategy = c.strategy?.whiteSpaceStrategy || c.consolidatedWhiteSpaceStrategy || "";
      const differentiators = c.strategy?.primaryDifferentiators || c.primaryDifferentiators || [];
      const guidance = c.strategy?.claimDraftingGuidance || c.claimDraftingGuidance || "";
      contextBlock += `
${idx + 1}. ${patentNums || "No prior art"}
`;
      contextBlock += `   Risk: ${c.overallRiskLevel || "Unknown"}
`;
      contextBlock += `   Constraint: ${topConstraint}
`;
      contextBlock += `   Strategy: ${wsStrategy}
`;
      contextBlock += `   Differentiation: ${differentiators.join("; ")}
`;
      contextBlock += `   Drafting Guidance: ${guidance}
`;
      perConcept.push({
        primaryPriorArt: patentNums || "No prior art",
        riskLevel: c.overallRiskLevel || "Unknown",
        constraint: topConstraint,
        whiteSpaceStrategy: wsStrategy,
        differentiationLogic: differentiators.join("; ")
      });
    });
    return { contextBlock, perConcept };
  }
  if (Array.isArray(ws2.nuggetAnalyses) && ws2.nuggetAnalyses.length > 0) {
    contextBlock += `

KEY DIFFERENTIATION POINTS:
`;
    ws2.nuggetAnalyses.forEach((n, idx) => {
      contextBlock += `
${idx + 1}. ${n.primaryPriorArt || ""}
`;
      contextBlock += `   Risk: ${n.riskLevel || ""}
`;
      contextBlock += `   Constraint: ${n.constraint || ""}
`;
      contextBlock += `   Strategy: ${n.whiteSpaceStrategy || ""}
`;
      contextBlock += `   Differentiation: ${n.differentiationLogic || ""}
`;
      perConcept.push({
        primaryPriorArt: n.primaryPriorArt || "",
        riskLevel: n.riskLevel || "",
        constraint: n.constraint || "",
        whiteSpaceStrategy: n.whiteSpaceStrategy || "",
        differentiationLogic: n.differentiationLogic || ""
      });
    });
    return { contextBlock, perConcept };
  }
  return { contextBlock, perConcept: [] };
}
function buildUserMessage2(args) {
  const { category, mainIdea, expandedConcept, conceptText, whiteSpaceContext, nugget } = args;
  const priorArtAware = whiteSpaceContext ? `---

**PRIOR ART AWARENESS:**
${whiteSpaceContext}
` : "";
  const differentiation = nugget ? `
**DIFFERENTIATION STRATEGY:**
- Risk Level: ${nugget.riskLevel}
- Primary Prior Art: ${nugget.primaryPriorArt}
- White Space Strategy: ${nugget.whiteSpaceStrategy}
- Differentiation Logic: ${nugget.differentiationLogic}
` : "";
  return `**TECHNICAL CONTEXT:**

**Invention Category:** ${category}

**Core Innovation:**
${mainIdea}

**Technical Specification:**
${expandedConcept}

**Specific Concept for This Claim Set:**
${conceptText}

` + priorArtAware + differentiation + `
---

**YOUR MISSION:**

Draft a comprehensive, technically detailed claim set that fully captures the innovation described above. Generate only claims that add meaningful strategic value - no padding, no redundancy. Follow the system instructions exactly for formatting, technical depth, and output structure.`;
}
function parseClaimsOutput(rawOutput, conceptId, conceptText, category, index) {
  const output = rawOutput || "";
  const complexityMatch = output.match(/\*\*Complexity Assessment\*\*\s*\n+([^\n*]+)/i);
  const complexityAssessment = complexityMatch ? complexityMatch[1].trim() : "";
  let complexityLevel = "moderate";
  const cLow = complexityAssessment.toLowerCase();
  if (cLow.includes("simple")) complexityLevel = "simple";
  else if (cLow.includes("complex")) complexityLevel = "complex";
  const claimTypeMatch = output.match(/\*\*Claim Type:\s*(SYSTEM|METHOD)\*\*/i);
  const claimType = claimTypeMatch ? claimTypeMatch[1].toLowerCase() : "system";
  const inventiveConceptMatch = output.match(/\*\*Inventive Concept\*\*\s*\n+([^\n*]+)/i);
  const inventiveConcept = inventiveConceptMatch ? inventiveConceptMatch[1].trim() : "";
  const claims = [];
  const claimSections = output.split(/(?=\*\*Claim\s+\d+\s*\([^)]+\)\*\*)/i);
  for (const section of claimSections) {
    const headerMatch = section.match(/\*\*Claim\s+(\d+)\s*\(([^)]+)\)\*\*/i);
    if (!headerMatch) continue;
    const claimNumber = parseInt(headerMatch[1], 10);
    const dependencyInfo = headerMatch[2].trim();
    const textMatch = section.match(/\*\*Claim\s+\d+\s*\([^)]+\)\*\*\s*\n?([\s\S]*?)(?=\*\*|$)/i);
    const claimText = textMatch ? textMatch[1].trim().replace(/\n+/g, " ").replace(/\s+/g, " ") : "";
    const isIndependent = dependencyInfo.toLowerCase().includes("independent");
    let parentClaim = null;
    if (!isIndependent) {
      const parentMatch = dependencyInfo.match(/(?:depends?\s+on|dependent\s+on)\s+claim\s+(\d+)/i);
      if (parentMatch) parentClaim = parseInt(parentMatch[1], 10);
      else {
        const fallbackMatch = dependencyInfo.match(/claim\s+(\d+)/i);
        parentClaim = fallbackMatch ? parseInt(fallbackMatch[1], 10) : 1;
      }
    }
    claims.push({
      number: claimNumber,
      type: isIndependent ? "independent" : "dependent",
      claimType,
      parentClaim,
      dependsOn: parentClaim,
      text: claimText
    });
  }
  const violations = [];
  if (claims.length < 5) violations.push({ claim: 0, issue: `Too few claims: ${claims.length} (minimum 5)` });
  if (claims.length > 10) violations.push({ claim: 0, issue: `Too many claims: ${claims.length} (maximum 10)` });
  claims.forEach((claim) => {
    const tl = claim.text.toLowerCase();
    if (tl.includes("any preceding claim") || tl.includes("any of the preceding") || tl.includes("any one of claims") || tl.includes("any of claims")) {
      violations.push({ claim: claim.number, issue: 'Uses prohibited "any preceding claim" language' });
    }
    if (tl.match(/system,?\s*method,?\s*(or|and)\s*medium/i) || tl.match(/method,?\s*system,?\s*(or|and)/i)) {
      violations.push({ claim: claim.number, issue: "Uses mixed claim types (system, method, or medium)" });
    }
    if (claim.text.match(/claims?\s+\d+\s*[-–—]\s*\d+/i) || claim.text.match(/claims?\s+\d+\s*(?:to|through)\s+\d+/i)) {
      violations.push({ claim: claim.number, issue: "Uses claim range reference instead of specific claim" });
    }
    if (claim.type === "dependent") {
      const claimRefs = claim.text.match(/(?:the\s+)?(?:system|method)\s+of\s+claim\s+(\d+)/gi) || [];
      if (claimRefs.length === 0) violations.push({ claim: claim.number, issue: "Dependent claim does not reference a parent claim" });
      else if (claimRefs.length > 1) violations.push({ claim: claim.number, issue: "Dependent claim references multiple claims" });
    }
  });
  const independentClaims = claims.filter((c) => c.type === "independent");
  const dependentClaims = claims.filter((c) => c.type === "dependent");
  const dependencyTree = {};
  claims.forEach((c) => {
    if (c.type === "independent") dependencyTree[c.number] = { claim: c.number, children: [] };
  });
  dependentClaims.forEach((c) => {
    const parent = c.parentClaim;
    if (parent == null) return;
    if (!dependencyTree[parent]) dependencyTree[parent] = { claim: parent, children: [] };
    dependencyTree[parent].children.push(c.number);
  });
  return {
    concept_id: conceptId,
    concept_text: conceptText,
    category,
    index,
    complexity_assessment: complexityAssessment,
    complexity_level: complexityLevel,
    claim_type: claimType,
    inventive_concept: inventiveConcept,
    claims,
    claims_count: claims.length,
    independent_claims: independentClaims,
    independent_claims_count: independentClaims.length,
    dependent_claims: dependentClaims,
    dependent_claims_count: dependentClaims.length,
    formatting_violations: violations,
    has_violations: violations.length > 0,
    is_valid: violations.length === 0,
    dependency_tree: dependencyTree,
    independent_claim: independentClaims[0]?.text || "",
    raw_output: output,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function runClaims(payload) {
  console.log(">>> [M4-4b CLAIMS] <<< generating claim sets for", payload.selectedIdeas?.length, "concepts");
  try {
    if (!Array.isArray(payload.selectedIdeas) || payload.selectedIdeas.length === 0) {
      return { success: false, error: "No selected ideas provided." };
    }
    const config = loadAgentConfig("module4/4b/claims.config.json");
    const systemPrompt = loadPrompt("module4/4b/claims.md");
    const { contextBlock, perConcept } = normalizeWhiteSpace(payload.whiteSpaceAnalysis || null);
    const category = payload.category || "";
    const mainIdea = payload.mainIdea || "";
    const expandedConcept = payload.expandedConcept || "";
    const results = await Promise.all(
      payload.selectedIdeas.map(async (idea, index) => {
        const conceptId = idea.id || `concept-${index}`;
        const conceptText = idea.text || "";
        try {
          const userMessage = buildUserMessage2({
            category,
            mainIdea,
            expandedConcept,
            conceptText,
            whiteSpaceContext: contextBlock,
            nugget: perConcept[index] || null
          });
          const raw = await callAgent({ systemPrompt, userMessage, config });
          return parseClaimsOutput(raw, conceptId, conceptText, category, index);
        } catch (err) {
          console.error(`>>> [M4-4b CLAIMS] <<< concept "${conceptId}" failed:`, err.message);
          return parseClaimsOutput(
            `**Complexity Assessment**
Analysis failed: ${err.message || String(err)}`,
            conceptId,
            conceptText,
            category,
            index
          );
        }
      })
    );
    console.log(
      `>>> [M4-4b CLAIMS] <<< done \u2014 ${results.length} concepts, ${results.reduce((s, r) => s + r.claims_count, 0)} total claims`
    );
    return {
      success: true,
      data: results
    };
  } catch (error) {
    console.error(">>> [M4-4b CLAIMS] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message || "Claims generation failed";
    return { success: false, error: errorMessage };
  }
}

// server/modules/module4/4c/pannu.ts
async function runPannuQuestions(payload) {
  console.log(">>> [M4-4c PANNU/QUESTIONS] <<< generating questions for", payload.concept_id);
  try {
    const config = loadAgentConfig("module4/4c/questions.config.json");
    const systemPrompt = loadPrompt("module4/4c/questions.md");
    const userMessage = `Claim Text: ${payload.claim_text}

Concept ID: ${payload.concept_id}

White Space Strategy: ${payload.strategy_context || ""}

Generate the three Pannu Test questions in JSON format.`;
    const parsed = await callAgentJSON({
      systemPrompt,
      userMessage,
      config
    });
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      return { success: false, error: "AI returned no questions." };
    }
    return {
      success: true,
      status: "success",
      concept_id: payload.concept_id,
      questions: parsed.questions
    };
  } catch (error) {
    console.error(">>> [M4-4c PANNU/QUESTIONS] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message.includes("Failed to parse AI response as JSON") ? "AI service returned invalid JSON. Please try again." : message || "Pannu questions generation failed";
    return { success: false, error: errorMessage };
  }
}
var VALID_STATUSES = /* @__PURE__ */ new Set(["Certified", "Needs Clarification", "Rejected"]);
async function runPannuScorer(payload) {
  console.log(">>> [M4-4c PANNU/SCORER] <<< scoring answers for", payload.concept_id);
  try {
    const config = loadAgentConfig("module4/4c/scorer.config.json");
    const systemPrompt = loadPrompt("module4/4c/scorer.md");
    const userMessage = `Claim Text: ${payload.claim_text}

Concept ID: ${payload.concept_id}

Human Answers:
${JSON.stringify(payload.human_answers, null, 2)}

Analyze and provide the compliance score in the required JSON format.`;
    const parsed = await callAgentJSON({
      systemPrompt,
      userMessage,
      config
    });
    if (!VALID_STATUSES.has(parsed.certification_status)) {
      throw new Error(`Invalid certification_status: ${parsed.certification_status}`);
    }
    if (typeof parsed.confidence_score !== "number" || parsed.confidence_score < 0 || parsed.confidence_score > 1) {
      throw new Error(`confidence_score out of range: ${parsed.confidence_score}`);
    }
    return {
      success: true,
      certification_status: parsed.certification_status,
      concept_id: payload.concept_id,
      confidence_score: parsed.confidence_score,
      pannu_record_text: parsed.pannu_record_text || ""
    };
  } catch (error) {
    console.error(">>> [M4-4c PANNU/SCORER] <<< failed:", error);
    const message = error?.message || String(error);
    return {
      success: false,
      certification_status: "Rejected",
      concept_id: payload.concept_id,
      confidence_score: 0,
      pannu_record_text: `Scoring failed: ${message}`,
      error: message
    };
  }
}

// server/modules/module4/4d/suggestion.ts
var FACTOR_CONTEXT = {
  conception: "Conception - This factor evaluates independent conception of the invention. Focus on how the inventor independently thought of and developed this specific technical solution.",
  quality: "Contribution Quality - This factor evaluates the significance and substantiality of the contribution. Focus on how meaningful and substantial this contribution is to the invention.",
  known_concepts: "Exceeding Known Concepts - This factor evaluates whether the contribution goes beyond known concepts. Focus on what makes this solution novel compared to existing knowledge."
};
async function runPannuSuggestion(payload) {
  console.log(">>> [M4-4d PANNU/SUGGESTION] <<< factor:", payload.factor);
  try {
    const config = loadAgentConfig("module4/4d/suggestion.config.json");
    const systemPrompt = loadPrompt("module4/4d/suggestion.md");
    const contextDescription = FACTOR_CONTEXT[payload.factor] || "General Pannu Test Factor";
    const userMessage = `You are helping evaluate a patent claim under the Pannu test.

Factor: ${contextDescription}

Claim Text:
${payload.claimText || ""}

Question to Answer:
${payload.question || ""}

Please provide a professional, thoughtful response that directly addresses this specific Pannu factor. Your response should be clear, concise, and helpful for patent documentation purposes.`;
    const response = await callAgent({ systemPrompt, userMessage, config });
    return {
      success: true,
      response: response.trim(),
      suggestion: response.trim(),
      factor: payload.factor,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (error) {
    console.error(">>> [M4-4d PANNU/SUGGESTION] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message || "Pannu AI suggestion failed";
    return { success: false, error: errorMessage };
  }
}

// server/modules/module5/5b/diagrams.ts
var ERASER_ENDPOINT = "https://app.eraser.io/api/render/prompt";
var ERASER_TYPE_MAP = {
  flowchart: "cloud-architecture-diagram",
  "system-architecture": "cloud-architecture-diagram",
  "data-model": "entity-relationship-diagram",
  "component-map": "cloud-architecture-diagram",
  "sequence-diagram": "sequence-diagram"
};
function extractPatentText(payload) {
  const title = payload.title || payload.patent_title || "Untitled";
  const patentText = payload.detailed_description || payload.patent_text || "";
  const codeFromTheUser = payload.codeFromTheUser || {};
  const codeSnippets = [];
  let formattedCode = "";
  for (const key of Object.keys(codeFromTheUser)) {
    if (!key.startsWith("code")) continue;
    const snippet = codeFromTheUser[key] || {};
    codeSnippets.push({
      id: key,
      text: snippet.text || "",
      code: snippet.code || ""
    });
    formattedCode += `
--- ${snippet.text || key} ---
${snippet.code || ""}
`;
  }
  return { title, patentText, codeSnippets, codeCount: codeSnippets.length, formattedCode };
}
function allocateFigureIds(diagrams) {
  let nextFig = 1;
  for (const d of diagrams) {
    const fig = d.figureId;
    if (fig && typeof fig === "string") {
      const match = fig.match(/(\d+)/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n >= nextFig) nextFig = n + 1;
      }
    }
  }
  return diagrams.map((d) => {
    if (d.figureId) return d;
    return { ...d, figureId: `FIG. ${nextFig++}` };
  });
}
function checkComponents(d) {
  const desc2 = d.detailed_description || "";
  const comps = Array.isArray(d.referenced_components) ? d.referenced_components : [];
  const present = [];
  const missing = [];
  for (const c of comps) {
    if (!c) continue;
    if (desc2.includes(String(c))) present.push(c);
    else missing.push(c);
  }
  return { present, missing };
}
function buildEraserPrompt(d) {
  const title = d.title || "Untitled";
  const detailedDescription = d.detailed_description || "";
  const rawDiagramType = (d.diagramType || "flowchart").toLowerCase().trim();
  const eraserDSL = d.eraserDSL || null;
  const eraserType = ERASER_TYPE_MAP[rawDiagramType] || "flowchart-diagram";
  const useElementsAPI = eraserType === "flowchart-diagram" && !!eraserDSL;
  const layoutInstruction = !useElementsAPI && (eraserType === "flowchart-diagram" || eraserType === "cloud-architecture-diagram") ? "IMPORTANT: Use vertical top-to-bottom layout (direction down). The flow must go from top to bottom, NOT left to right. This is required for patent PDF formatting.\n\n" : "";
  const bwInstruction = "CRITICAL STYLE REQUIREMENT: This diagram must be black and white only, with no color of any kind. All shapes must have a white fill and black borders. All lines and arrows must be black. All text must be black. All group containers and bounding boxes must have a white or transparent fill with a black border \u2014 no colored backgrounds on groups. Do not use any color fills, gradients, shadows, or colored backgrounds on any element, group, or container. This is a strict requirement for USPTO/PCT patent compliance.\n\n";
  const userPrompt = `Title: ${title}

${bwInstruction}${layoutInstruction}${detailedDescription}`;
  return { userPrompt, diagramType: eraserType, eraserDSL, useElementsAPI };
}
async function callEraser(prompt, diagramType) {
  const apiKey = process.env.ERASER_API_KEY;
  if (!apiKey) {
    throw new Error("ERASER_API_KEY not set");
  }
  const resp = await fetch(ERASER_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      text: prompt,
      diagramType,
      mode: "standard",
      theme: "light"
    }),
    signal: AbortSignal.timeout(12e4)
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Eraser API ${resp.status}: ${errText.substring(0, 300)}`);
  }
  const data = await resp.json();
  return {
    imageUrl: data?.imageUrl || null,
    editLink: data?.createEraserFileUrl || null,
    diagramCode: data?.diagrams?.[0]?.code || null,
    raw: data
  };
}
async function runDiagrams(payload) {
  console.log(">>> [M5-5b DIAGRAMS] <<< Generating patent diagrams");
  try {
    const { title, patentText, codeCount, formattedCode } = extractPatentText(payload);
    const config = loadAgentConfig("module5/5b/planner.config.json");
    const systemPrompt = loadPrompt("module5/5b/planner.md");
    const userMessage = `Provisional Patent Title: ${title}
Provisional Patent Text: ${patentText}

Code Snippets Uploaded by the User (${codeCount} total):
${formattedCode}`;
    const plan = await callAgentJSON({
      systemPrompt,
      userMessage,
      config
    });
    let diagrams = Array.isArray(plan.diagrams) ? plan.diagrams : [];
    if (diagrams.length === 0) {
      return {
        success: false,
        error: "Planner returned no diagrams."
      };
    }
    diagrams = allocateFigureIds(diagrams);
    const results = await Promise.all(
      diagrams.map(async (d, index) => {
        const chartNumber = index + 1;
        const diagramTitle = d.title || `Diagram ${chartNumber}`;
        const figureId = d.figureId || null;
        const { present, missing } = checkComponents(d);
        const { userPrompt, diagramType } = buildEraserPrompt(d);
        try {
          const eraserResp = await callEraser(userPrompt, diagramType);
          const markdown = eraserResp.imageUrl ? `![Flowchart](${eraserResp.imageUrl})

**[Edit in Eraser](${eraserResp.editLink || ""})**` : "";
          return {
            chartNumber,
            title: diagramTitle,
            figureId,
            diagramType,
            imageUrl: eraserResp.imageUrl,
            editLink: eraserResp.editLink,
            diagramCode: eraserResp.diagramCode,
            markdown,
            success: !!eraserResp.imageUrl,
            referenced_components: present,
            referenced_components_missing: missing
          };
        } catch (err) {
          console.error(`>>> [M5-5b DIAGRAMS] <<< Eraser failed for "${diagramTitle}":`, err.message);
          return {
            chartNumber,
            title: diagramTitle,
            figureId,
            diagramType,
            imageUrl: null,
            editLink: null,
            diagramCode: null,
            markdown: "",
            success: false,
            error: err.message || String(err),
            referenced_components: present,
            referenced_components_missing: missing
          };
        }
      })
    );
    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;
    console.log(
      `>>> [M5-5b DIAGRAMS] <<< Done \u2014 ${results.length} diagrams (${successful} ok, ${failed} failed)`
    );
    return {
      success: true,
      totalFlowcharts: results.length,
      successful,
      failed,
      flowcharts: results,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (error) {
    console.error(">>> [M5-5b DIAGRAMS] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message.includes("ERASER_API_KEY") ? "Eraser API key is not configured. Set ERASER_API_KEY in environment." : message.includes("Failed to parse AI response as JSON") ? "Diagram planner returned invalid JSON. Please try again." : message || "Diagrams generation failed";
    return { success: false, error: errorMessage };
  }
}

// server/modules/module5/5c/broader-claims.ts
function prepareData(payload) {
  const currentClaimsText = payload.current_claims || "";
  const fullSpecText = payload.full_specification || "";
  const drawingsText = payload.drawing_descriptions_and_reference_numerals || "No drawings provided for this specification.";
  let contextText = "";
  if (payload.deep_research_notes) contextText += `DEEP RESEARCH NOTES:
${payload.deep_research_notes}

`;
  if (payload.prior_art_notes) contextText += `PRIOR ART NOTES:
${payload.prior_art_notes}

`;
  if (payload.important_claim_sets) contextText += `IMPORTANT CLAIM SETS:
${payload.important_claim_sets}

`;
  let patentTitle = payload.patent_title || "";
  if (!patentTitle && fullSpecText) {
    const titleMatch = fullSpecText.match(/TITLE:\s*([^\n]+)/i);
    if (titleMatch) patentTitle = titleMatch[1].trim();
  }
  return {
    sessionId: payload.sessionId || "",
    patent_title: patentTitle,
    one_sentence_summary: payload.one_sentence_summary || "",
    current_claims_text: currentClaimsText,
    full_specification_text: fullSpecText,
    drawings_text: drawingsText,
    optional_context_text: contextText || "No additional context provided.",
    execution_mode: payload.executionMode || "production",
    webhook_url: payload.webhookUrl || ""
  };
}
function buildReaderPrompt(d) {
  return `TITLE: ${d.patent_title}

SPECIFICATION:
${d.full_specification_text}

DRAWINGS:
${d.drawings_text}

CURRENT CLAIMS:
${d.current_claims_text}

CONTEXT:
${d.optional_context_text || "None provided."}

SUMMARY:
${d.one_sentence_summary || "None provided."}

Analyze the specification and current claims. Produce a single structured analysis with these exact sections:

INNOVATIONS INVENTORY:
List every distinct technical innovation described in the specification. For each:
- Name it
- What it does (one sentence)
- Supporting paragraph (\xB6 number)
- Is it covered by any current claim? (YES citing claim number / NO / PARTIALLY citing claim number and what's missing)

UNCLAIMED INNOVATIONS:
List every innovation marked NO or PARTIALLY above. These are broadening opportunities.

INDEPENDENT CLAIM PROBLEMS:
For each current independent claim:
- Which limitations are non-essential implementation details that should be in dependents?
- Which limitations use technology-specific language that could be generalized?
- What is the minimum set of limitations that captures the inventive principle?

STATUTORY CLASS GAPS:
What statutory classes are missing from the current claim set? (system / method / non-transitory computer-readable medium)

SPEC FLEXIBILITY:
List every place the specification says the invention may be implemented using alternative technologies, in alternative industries, or with alternative architectures. These support broader claim language.

Be exhaustive. Miss nothing. This analysis directly determines the quality of the broadened claims.`;
}
function buildStrategistPrompt(d, specAnalysis) {
  return `You must produce a precise claim broadening blueprint. This blueprint will be handed directly to a claim drafter who will write formal USPTO claims from it. If your blueprint is vague, the claims will be vague. If you miss a feature, the patent loses that protection.

SPEC ANALYSIS (from previous agent):
${specAnalysis}

ORIGINAL CLAIMS:
${d.current_claims_text}

CONTEXT:
${d.optional_context_text}

ONE-SENTENCE SUMMARY:
${d.one_sentence_summary}

Produce your blueprint in this exact order:

PART 1 \u2014 INDEPENDENT CLAIM SKELETONS

Design the independent claims. You must include at least one system, one method, and one medium claim. For each:

INDEPENDENT CLAIM [N] ([SYSTEM/METHOD/MEDIUM]):
- Limitation A: [exact language to use]
- Limitation B: [exact language to use]
- Limitation C: [exact language to use]
(list every limitation \u2014 this is the full skeleton)

Rules for independent claims:
- Capture the inventive principle, not any specific implementation
- No technology-specific language (no vendor names, no specific protocols, no specific database types, no specific file formats, no specific programming languages)
- Replace specific technologies with functional descriptions
- Do not lock claims to a specific industry
- Every limitation must be supported by the specification

PART 2 \u2014 COVERAGE AUDIT

Go through every single original claim, one by one. For each original claim, determine its fate in the new claim set:

Original Claim [N]: [brief description of what it covers]
\u2192 ABSORBED INTO: Independent Claim [X], Limitation [Y] \u2014 because [reason]
OR
\u2192 DEPENDENT CLAIM NEEDED: [describe what the dependent should say, with generalized language if the original was too technology-specific]
OR
\u2192 INTENTIONALLY DROPPED: [specific reason \u2014 e.g., redundant with Claim X, or unsupported by spec, or damages prosecution strategy]

Do not skip any original claim. Every single one must appear in this audit with one of the three dispositions above.

PART 3 \u2014 NEW DEPENDENT CLAIMS FROM UNCLAIMED INNOVATIONS

For each innovation the Spec Reader identified as unclaimed (NO or PARTIALLY covered), specify a new dependent claim:

- Parent: Independent Claim [N]
- Adds: [what specific limitation it adds]
- Spec support: [paragraph reference]
- Why: [what design-around path this closes or what feature this protects]

PART 4 \u2014 COMPLETE DEPENDENT CLAIMS LIST

Compile the full list of ALL dependent claims \u2014 both those carried over from Part 2 and those newly created in Part 3. For each:

- Parent: Claim [N]
- Limitation: [exact language]
- Spec support: [paragraph reference]
- Purpose: [what this protects that the independent doesn't]

This list is what the drafter will convert directly into formal claims. Every item becomes one claim. Do not leave anything vague.

PART 5 \u2014 NEW SPEC PARAGRAPHS NEEDED

For each claim (independent or dependent) that lacks full spec support:
- Topic: [what to describe]
- Why: [which claim needs this]
- Draft: [write the actual paragraph]

If no new spec is needed, say so.

PART 6 \u2014 PATENT ELIGIBILITY STRATEGY (\xA7101/Alice)

For software patents:
- What are the strongest technical improvements to emphasize?
- What aspects cannot be performed by a human mind?
- How should the claims be framed to survive \xA7101 challenges?`;
}
function buildDrafterPrompt(d, blueprint) {
  return `CLAIM BLUEPRINT:
${blueprint}

ORIGINAL SPECIFICATION (for verifying support \u2014 do not copy-paste from it):
${d.full_specification_text}

DRAWINGS:
${d.drawings_text || "non provided"}

Convert the blueprint above into formal USPTO patent claims.

Your ENTIRE response must be numbered patent claims. Nothing else. No headers. No commentary. No explanations. No sections. Start with "1." and end with the last claim number's period.

Every item in Part 4 (Complete Dependent Claims List) of the blueprint becomes exactly one dependent claim. Every independent claim skeleton in Part 1 becomes exactly one independent claim. Do not consolidate, merge, skip, or summarize any item from the blueprint.

Format rules:
- Independent claims: "1. A system comprising:" or "N. A computer-implemented method comprising:" or "N. A non-transitory computer-readable medium storing instructions that, when executed by a processor, cause the processor to perform operations comprising:"
- Dependent claims: "N. The [system/method/non-transitory computer-readable medium] of claim X, wherein..." or "...further comprising..."
- Every claim is one sentence ending with a period
- Use "comprising" on all independent claims
- Antecedent basis: first mention "a/an", all subsequent "the/said"
- Method claims: gerund verbs (receiving, determining, generating, filtering)
- System claims: "a processor configured to" or "cause the processor to"
- No source code, no pseudocode
- No specific technology names in independent claims (no database vendors, no protocol names, no programming languages, no file formats)
- Technology-specific language is acceptable in dependent claims where the blueprint specifies it`;
}
function parseClaims(rawOutput) {
  const claims = [];
  let currentClaim = null;
  const lines = (rawOutput || "").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const claimStart = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (claimStart) {
      if (currentClaim) {
        currentClaim.text = currentClaim.text.trim();
        claims.push(currentClaim);
      }
      const num = parseInt(claimStart[1], 10);
      const restOfLine = claimStart[2];
      let type = "dependent";
      let statutoryClass = null;
      let parentClaim = null;
      if (/^A system comprising/i.test(restOfLine)) {
        type = "independent";
        statutoryClass = "system";
      } else if (/^A computer-implemented method comprising/i.test(restOfLine)) {
        type = "independent";
        statutoryClass = "method";
      } else if (/^A non-transitory computer-readable medium/i.test(restOfLine)) {
        type = "independent";
        statutoryClass = "medium";
      } else {
        const depMatch = restOfLine.match(
          /^The\s+(system|method|non-transitory computer-readable medium)\s+of\s+claim\s+(\d+)/i
        );
        if (depMatch) {
          const classMap = {
            system: "system",
            method: "method",
            "non-transitory computer-readable medium": "medium"
          };
          statutoryClass = classMap[depMatch[1].toLowerCase()] || depMatch[1].toLowerCase();
          parentClaim = parseInt(depMatch[2], 10);
        }
      }
      currentClaim = {
        number: num,
        type,
        statutoryClass,
        parentClaim,
        text: restOfLine
      };
    } else if (currentClaim) {
      currentClaim.text += "\n" + trimmed;
    }
  }
  if (currentClaim) {
    currentClaim.text = currentClaim.text.trim();
    claims.push(currentClaim);
  }
  const independent = claims.filter((c) => c.type === "independent");
  const dependent = claims.filter((c) => c.type === "dependent");
  const dependentsByParent = {};
  for (const dep of dependent) {
    const key = dep.parentClaim != null ? String(dep.parentClaim) : "unknown";
    dependentsByParent[key] = (dependentsByParent[key] || 0) + 1;
  }
  return {
    summary: {
      totalClaims: claims.length,
      independentClaims: independent.length,
      dependentClaims: dependent.length,
      statutoryClasses: Array.from(new Set(independent.map((c) => c.statutoryClass).filter(Boolean))),
      dependentsByParent
    },
    claims
  };
}
async function runBroaderClaims(payload) {
  console.log(">>> [M5-5c BROADER-CLAIMS] <<< starting 3-stage pipeline");
  try {
    const prepared = prepareData(payload);
    console.log(">>> [M5-5c BROADER-CLAIMS] <<< stage 1/3 spec-reader");
    const readerConfig = loadAgentConfig("module5/5c/spec-reader.config.json");
    const readerSystem = loadPrompt("module5/5c/spec-reader.md");
    const readerPrompt = buildReaderPrompt(prepared);
    const specAnalysis = await callAgent({
      systemPrompt: readerSystem,
      userMessage: readerPrompt,
      config: readerConfig
    });
    console.log(">>> [M5-5c BROADER-CLAIMS] <<< stage 2/3 claim-strategist");
    const strategistConfig = loadAgentConfig("module5/5c/claim-strategist.config.json");
    const strategistSystem = loadPrompt("module5/5c/claim-strategist.md");
    const blueprint = await callAgent({
      systemPrompt: strategistSystem,
      userMessage: buildStrategistPrompt(prepared, specAnalysis),
      config: strategistConfig
    });
    console.log(">>> [M5-5c BROADER-CLAIMS] <<< stage 3/3 claim-drafter");
    const drafterConfig = loadAgentConfig("module5/5c/claim-drafter.config.json");
    const drafterSystem = loadPrompt("module5/5c/claim-drafter.md");
    const rawClaims = await callAgent({
      systemPrompt: drafterSystem,
      userMessage: buildDrafterPrompt(prepared, blueprint),
      config: drafterConfig
    });
    const parsed = parseClaims(rawClaims);
    console.log(
      `>>> [M5-5c BROADER-CLAIMS] <<< done \u2014 ${parsed.summary.totalClaims} claims (${parsed.summary.independentClaims} independent, ${parsed.summary.dependentClaims} dependent)`
    );
    return {
      success: true,
      summary: parsed.summary,
      claims: parsed.claims
    };
  } catch (error) {
    console.error(">>> [M5-5c BROADER-CLAIMS] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message || "Broader claims generation failed";
    return { success: false, error: errorMessage };
  }
}

// server/modules/module5/5a/provisional.ts
function parsePayload(payload) {
  const sessionId = payload.sessionId || "";
  const category = payload.category || "";
  const coreIdea = payload.coreIdea || payload.mainIdea || "";
  const expandedConcept = payload.expandedConcept || "";
  const claimGroups = [];
  let currentIndependent = null;
  let dependents = [];
  if (Array.isArray(payload.selectedClaims)) {
    for (const claim of payload.selectedClaims) {
      if (claim.type === "independent claim") {
        if (currentIndependent != null) {
          claimGroups.push({ independent: currentIndependent, dependents: dependents.slice() });
        }
        currentIndependent = claim.text || "";
        dependents = [];
      } else {
        dependents.push(claim.text || "");
      }
    }
    if (currentIndependent != null) {
      claimGroups.push({ independent: currentIndependent, dependents: dependents.slice() });
    }
  }
  const claimsText = claimGroups.map(
    (g, i) => `Independent Claim ${i + 1}:
${g.independent}

Dependent Claims:
${g.dependents.join("\n\n")}`
  ).join("\n\n---\n\n");
  return {
    sessionId,
    category,
    coreIdea,
    expandedConcept,
    claimGroups,
    claimsText,
    totalClaims: payload.selectedClaims?.length || 0
  };
}
async function runAgent(agentName, userMessage) {
  const config = loadAgentConfig(`module5/5a/${agentName}.config.json`);
  const systemPrompt = loadPrompt(`module5/5a/${agentName}.md`);
  const result = await callAgent({ systemPrompt, userMessage, config });
  return (result || "").trim();
}
function titleUserPrompt(p) {
  return `**CATEGORY:** ${p.category}

**CORE INNOVATION:**
${p.coreIdea}

**EXPANDED CONCEPT:**
${p.expandedConcept}

**INDEPENDENT CLAIMS:**
${p.claimsText}

---

**YOUR MISSION: PATENT TITLE**

Draft the title for a provisional patent application that will appear on the USPTO filing.

**USPTO TITLE REQUIREMENTS:**
- Technically precise - identify the exact technical field
- Innovation clarity - state what the invention does
- Professional format - no marketing language, pure technical description
- Concise but complete - typically 10-15 words

**EXAMPLES OF EFFECTIVE TITLES:**
- "System and Method for Autonomous Multi-Application Workflow Synthesis via Observational Learning"
- "Apparatus for Real-Time Semantic Action Abstraction Across Heterogeneous Software Environments"
- "Cross-Platform Workflow Orchestration Using Behavioral Pattern Recognition"

**OUTPUT:**
Provide only the title text. No explanations, no preamble, no markdown.`;
}
function backgroundUserPrompt(p, s) {
  return `**PATENT TITLE:**
${s.title}

**CATEGORY:** ${p.category}

**CORE INNOVATION:**
${p.coreIdea}

**EXPANDED CONCEPT:**
${p.expandedConcept}

**INDEPENDENT CLAIMS:**
${p.claimsText}

---

**YOUR MISSION: BACKGROUND SECTION**

The background section establishes why this invention is necessary by documenting the deficiencies in existing solutions. Patent examiners use this section to understand the problem space and evaluate novelty.

**REQUIRED CONTENT:**

**1. FIELD OF THE INVENTION**
State the precise technical domain - not just "software" but the specific area like "cross-application process automation using machine learning-based behavioral inference." Identify the specific industry problem space and establish technical context.

**2. DESCRIPTION OF RELATED ART**
Identify and analyze existing solution categories. For each category of prior art:
- Explain what it does technically
- Document its specific limitations and deficiencies  
- Explain why it fails to solve the problem adequately
- Identify technical gaps (e.g., "requires explicit user programming," "cannot infer cross-application workflows," "limited to predefined templates")

Consider these categories of prior art:
- Traditional RPA (Robotic Process Automation) tools
- Workflow automation platforms (Zapier, IFTTT, n8n, Make)
- Task recording/macro tools
- AI assistants and copilots
- Low-code/no-code platforms
- Script-based automation
- Enterprise integration platforms
- Any other relevant existing approaches

**3. TECHNICAL PROBLEMS WITH PRIOR ART**
Document specific technical deficiencies:
- Manual workflow design overhead
- Inability to discover implicit user patterns
- No cross-application behavioral learning
- Template-based limitations
- Lack of autonomous workflow synthesis
- No semantic action abstraction
- Inability to personalize without explicit configuration
- Poor handling of disparate application environments

For each problem, explain why it's technically significant and what failures or inefficiencies it causes.

**WRITING APPROACH:**
Be comprehensive and thorough. Use technical terminology. Build a clear case for why existing solutions are inadequate. Reference specific technical deficiencies, not marketing claims. Write in formal technical prose.

**OUTPUT:**
Provide only the background text. No section headers in the output, no markdown formatting.`;
}
function summaryUserPrompt(p, s) {
  return `**PATENT TITLE:**
${s.title}

**BACKGROUND SECTION (ALREADY WRITTEN):**
${s.background}

**CORE INNOVATION:**
${p.coreIdea}

**INDEPENDENT CLAIMS:**
${p.claimsText}

---

**YOUR MISSION: SUMMARY SECTION**

The summary presents the solution to the problems documented in the background. This is where you explain what the invention IS and how it addresses the deficiencies in prior art.

**REQUIRED CONTENT:**

**1. INVENTION OVERVIEW**
State clearly what the invention is and its core technical approach. Explain how it fundamentally differs from the prior art discussed in the background.

**2. KEY INNOVATIONS**
Explain each major innovation component:
- **Autonomous discovery**: How the system learns by observation rather than programming
- **Semantic abstraction**: How it understands user intent from raw interactions
- **Cross-application synthesis**: How it chains actions across disparate tools
- **Personalization without configuration**: How it adapts to individual users
- **De novo workflow creation**: How it creates new automations rather than using templates

**3. TECHNICAL ADVANTAGES**
Explain the specific benefits and how they solve the problems identified in the background:
- Eliminates manual workflow design burden
- Discovers hidden efficiency opportunities
- Adapts to individual user patterns
- Handles heterogeneous application environments
- Creates truly personalized automations
- Reduces technical expertise requirements
- Continuously learns and refines workflows

**4. CONNECTION TO DETAILED DESCRIPTION**
Bridge to the upcoming detailed description by indicating that comprehensive technical specifications follow.

**WRITING APPROACH:**
Be confident and comprehensive. Focus on WHAT the invention does and WHY it's valuable, saving the detailed HOW for the next section. Make it clear this invention solves the problems documented in the background. Use technical but accessible language.

**OUTPUT:**
Provide only the summary text. No section headers in the output, no markdown formatting.`;
}
function architectureUserPrompt(p, s) {
  return `**PATENT TITLE:**
${s.title}

**SUMMARY:**
${s.summary}

**CORE INNOVATION:**
${p.coreIdea}

**EXPANDED CONCEPT:**
${p.expandedConcept}

---

**YOUR MISSION: SYSTEM ARCHITECTURE (Part 1 of Detailed Description)**

Document the complete system architecture with every component properly identified and described. This is the structural foundation that enables a PHOSITA to understand what needs to be built.

**COMPONENT INVENTORY WITH REFERENCE NUMERALS:**

Assign unique reference numerals to every component in the system. Use the format (100), (102), (104), etc.

Example components to identify and describe:
- Computing System (100)
- User Device (102)
- Interaction Monitoring Agent (104)
- Operating System Event Hook (106)
- Raw Interaction Data Repository (108)
- Secure Data Transmission Protocol (110)
- Backend Server Infrastructure (112)
- Action Abstraction and Normalization Service (114)
- Pattern Recognition Engine (116)
- Machine Learning Model (118)
- Workflow Discovery Engine (120)
- Workflow Synthesis Module (122)
- Synthesized Workflow Repository (124)
- Cross-Application Integration Layer (126)
- Application Connectors (128)
- Automation Execution Environment (130)
- Orchestration Engine (132)
- User Interface Module (134)
- [Continue with all necessary components]

**FOR EACH COMPONENT, DESCRIBE:**

**Structure - What is it made of?**
- Hardware components: Specify CPU, RAM, storage, network requirements
- Software components: Programming language, frameworks, libraries, dependencies
- Data components: Database type, schema structure, indexing strategy

**Location - Where does it exist?**
- On user's local device?
- On cloud server infrastructure?
- Edge compute location?
- Distributed across multiple locations?

**Connectivity - How does it connect?**
- What protocols does it use? (HTTP, WebSocket, gRPC, TCP, UDP)
- What APIs does it expose or consume?
- What message formats? (JSON, Protobuf, XML)
- Authentication and security mechanisms?

**Function - What does it do?**
- Input: What data or signals does it receive?
- Processing: What computations or transformations does it perform?
- Output: What does it produce or send?
- Purpose: Why is this component necessary?

**PHYSICAL RELATIONSHIPS:**
Explain how components are physically or logically connected:
- "The Interaction Monitoring Agent (104) runs as a background process on User Device (102) and communicates with Backend Server (112) via Secure Transmission Protocol (110)..."
- "Pattern Recognition Engine (116) queries Raw Interaction Data Repository (108) using SQL queries over TCP connection..."

**WRITING APPROACH:**
Use reference numerals consistently throughout. Be specific about technologies and implementations. Provide enough detail that a PHOSITA could design the system architecture.

**OUTPUT:**
Provide only the architecture description text. No section headers in output, no markdown formatting. This will be Part 1 of the Detailed Description section.`;
}
function dataStructuresUserPrompt(p, s) {
  return `**PATENT TITLE:**
${s.title}

**SYSTEM ARCHITECTURE (ALREADY WRITTEN):**
${s.architecture}

**CORE INNOVATION:**
${p.coreIdea}

---

**YOUR MISSION: DATA STRUCTURES & FORMATS (Part 2 of Detailed Description)**

Document every data structure, format, and protocol used in the system. This enables a PHOSITA to understand how information is represented, stored, and transmitted.

**REQUIRED DATA STRUCTURES:**

**1. RAW INTERACTION EVENTS**
Define the complete structure for captured user interactions:

Fields to document:
- Timestamp (format specification: ISO8601, Unix epoch, etc.)
- Event type (enumeration of all possible types)
- Application identifier (how applications are uniquely identified)
- Window/element identification (DOM path, accessibility tree, window handle)
- Input data (keystrokes, mouse coordinates, values entered)
- Application state (current view, open documents, active elements)
- Contextual metadata (user session, device info, environment variables)

Explain the serialization format (JSON, Protocol Buffers, etc.) and provide example structure.

**2. ABSTRACTED ACTIONS**
Define the standardized action format that makes actions application-agnostic:

Fields to document:
- Action identifier (UUID, sequential ID)
- Action type (standardized verb taxonomy: create, read, update, delete, navigate, etc.)
- Source application (reference to application from which action originated)
- Target element (abstracted element identifier)
- Parameters (action-specific data in key-value format)
- Semantic intent (interpreted purpose of the action)
- Confidence score (if applicable for ML-based abstraction)

Explain how normalization works across different application types.

**3. PATTERN RECOGNITION OUTPUT**
Define how identified patterns are represented:

Structure to document:
- Pattern identifier
- Action sequence (ordered list of action references)
- Frequency metrics (how often pattern occurs)
- Temporal characteristics (typical timing between actions)
- Contextual triggers (conditions under which pattern occurs)
- Confidence metrics (statistical significance)

**4. WORKFLOW DEFINITIONS (DAG)**
Define the workflow representation in complete detail:

Structure to document:
- Workflow identifier
- Workflow metadata (name, description, creation date)
- Nodes array (each node represents an atomic action)
  - Node identifier
  - Action reference
  - Input parameter mappings
  - Output data structure
- Edges array (each edge represents flow between nodes)
  - Source node
  - Target node
  - Condition (optional conditional logic)
  - Data transformation (how data passes between nodes)
- Triggers array (what causes workflow to execute)
  - Trigger type
  - Trigger conditions
  - Trigger parameters
- Personalization metadata
  - User-specific adaptations
  - Historical performance metrics
  - Optimization parameters

**5. EXECUTION STATE**
Define how workflow execution state is tracked:

Fields to document:
- Execution identifier
- Workflow reference
- Current node
- Execution status (running, paused, completed, failed)
- Node execution history
- Variable state (current values of all variables)
- Error information (if applicable)

**STORAGE & TRANSMISSION:**
Explain how these structures are:
- Stored in databases (schema design, indexing)
- Transmitted over network (serialization, compression)
- Secured (encryption at rest and in transit)
- Versioned (handling schema evolution)

**WRITING APPROACH:**
Be technically precise. Provide enough detail that a PHOSITA could implement these data structures. Use consistent terminology. Reference the component architecture from Part 1 using reference numerals where relevant.

**OUTPUT:**
Provide only the data structures description text. No section headers in output, no markdown formatting. This will be Part 2 of the Detailed Description section.`;
}
function operationsUserPrompt(p, s) {
  return `**PATENT TITLE:**
${s.title}

**SYSTEM ARCHITECTURE:**
${s.architecture}

**DATA STRUCTURES:**
${s.data_structures}

**CORE INNOVATION:**
${p.coreIdea}

---

**YOUR MISSION: OPERATIONAL WORKFLOW (Part 3 of Detailed Description)**

Provide a complete chronological narrative of how the system operates from start to finish. A PHOSITA must be able to understand the exact sequence of operations.

**CHRONOLOGICAL NARRATIVE STRUCTURE:**

Use reference numerals from the architecture section consistently throughout. Write in a flowing narrative that traces execution.

**PHASE 1: INTERACTION CAPTURE**

Begin with: "During normal system operation, a user interacts with applications on User Device (102). When the user performs an action\u2014such as clicking a button, entering text, or switching applications\u2014the Interaction Monitoring Agent (104) detects this event through Operating System Event Hook (106)..."

Continue with:
- How the event is captured (specific OS APIs or hooks used)
- What information is extracted
- How the event is packaged into the Event Data Structure
- Any filtering or preprocessing that occurs

**PHASE 2: DATA TRANSMISSION & STORAGE**

"The captured Event Object is transmitted from User Device (102) to Backend Server (112) via Secure Data Transmission Protocol (110), which implements TLS 1.3 encryption..."

Continue with:
- Network communication mechanism
- Security and authentication
- How the server receives and validates the data
- Storage in Raw Interaction Data Repository (108)
- Database operations (insert, index, etc.)

**PHASE 3: ACTION ABSTRACTION**

"Action Abstraction and Normalization Service (114) periodically queries Raw Interaction Data Repository (108) for new events. For each event, the service..."

Continue with:
- How raw events are processed
- Application-specific interpretation logic
- Semantic analysis mechanism
- Creation of Abstracted Action objects
- Storage of abstracted actions

**PHASE 4: PATTERN RECOGNITION**

"Pattern Recognition Engine (116) analyzes the stream of Abstracted Actions to identify recurring sequences. The engine employs..."

Continue with:
- Specific algorithms or ML models used
- How patterns are identified (sequence mining, neural network inference, etc.)
- Statistical significance testing
- Pattern storage and indexing
- Continuous learning updates

**PHASE 5: WORKFLOW DISCOVERY**

"Workflow Discovery Engine (120) examines identified patterns to determine which represent genuine automation opportunities..."

Continue with:
- Criteria for workflow candidacy
- Cross-application sequence detection
- Implicit data dependency identification
- Contextual trigger inference

**PHASE 6: WORKFLOW SYNTHESIS**

"Workflow Synthesis Module (122) constructs executable workflow definitions from discovered patterns..."

Continue with:
- DAG construction algorithm
- Node and edge creation
- Parameter mapping logic
- Personalization incorporation
- Workflow validation

**PHASE 7: WORKFLOW STORAGE & PRESENTATION**

"The synthesized workflow is stored in Synthesized Workflow Repository (124) and presented to the user via User Interface Module (134)..."

Continue with:
- Repository storage mechanism
- User notification method
- Workflow display in UI
- User review and approval process

**PHASE 8: WORKFLOW EXECUTION**

"When a user activates a workflow, or when a trigger condition is met, Automation Execution Environment (130) instantiates the workflow for execution..."

Continue with:
- Trigger detection mechanism
- Execution initialization
- Node-by-node execution with Orchestration Engine (132)
- Cross-Application Integration Layer (126) invocation
- API calls to target applications
- Data flow between nodes
- Error handling and retry logic
- Execution state tracking
- Completion handling

**PHASE 9: CONTINUOUS REFINEMENT**

"As the workflow executes and as the user continues working, the system continues monitoring to refine and optimize..."

Continue with:
- Performance metrics collection
- Workflow adjustment logic
- User feedback incorporation
- Model retraining process

**WRITING APPROACH:**
Write as a flowing narrative, not bullet points. Use reference numerals constantly to tie back to the architecture. Describe the technical mechanism for each step. A PHOSITA should be able to implement the system's logic from this description.

**OUTPUT:**
Provide only the operational workflow description text. No section headers in output, no markdown formatting. This will be Part 3 of the Detailed Description section.`;
}
function alternativesUserPrompt(p, s) {
  return `**PATENT TITLE:**
${s.title}

**SYSTEM ARCHITECTURE:**
${s.architecture}

**OPERATIONS:**
${s.operations}

---

**YOUR MISSION: ALTERNATIVE EMBODIMENTS (Part 4 of Detailed Description)**

Document technical variations that achieve the same inventive function. This shows that the invention is not limited to one specific implementation but represents a broader inventive concept.

**HARDWARE & INFRASTRUCTURE ALTERNATIVES:**

**Deployment Architectures:**
Explain that while the primary embodiment may describe a cloud-based architecture, the invention can be implemented in alternative configurations:
- Pure cloud infrastructure (all components on remote servers)
- On-premise deployment (enterprise data center)
- Hybrid architecture (monitoring agents on user devices, processing in cloud)
- Edge computing (processing at network edge closer to users)
- Peer-to-peer distributed (no central server)

For each, explain what changes from the primary embodiment and what remains the same inventively.

**Compute Platforms:**
Describe platform flexibility:
- Desktop systems (Windows, macOS, Linux)
- Mobile devices (iOS, Android with platform-specific monitoring approaches)
- Embedded systems (resource-constrained implementations)
- Browser-based (web extension architecture)
- Mixed heterogeneous environments

**Hardware Acceleration:**
Explain optional hardware acceleration:
- GPU acceleration for machine learning inference
- TPU or specialized AI accelerators
- FPGA for low-latency pattern matching
- Distributed computing clusters

**SOFTWARE & TECHNOLOGY ALTERNATIVES:**

**Programming Languages:**
While the primary embodiment might use Python, explain that implementation language is not limiting:
- Compiled languages (Go, Rust, C++) for performance-critical components
- JVM languages (Java, Kotlin, Scala) for enterprise integration
- JavaScript/TypeScript for web-based components
- Multiple languages in microservices architecture

**Machine Learning Frameworks:**
Explain ML framework flexibility:
- TensorFlow for large-scale neural networks
- PyTorch for research and development
- JAX for high-performance computing
- Scikit-learn for traditional ML algorithms
- Custom implementations of algorithms

**Database Technologies:**
Describe database alternatives:
- Relational databases (PostgreSQL, MySQL) for structured data
- NoSQL (MongoDB, Cassandra) for flexible schemas
- Time-series databases (InfluxDB, TimescaleDB) for event streams
- Graph databases (Neo4j) for relationship tracking
- Vector databases (Pinecone, Weaviate) for embeddings

**ALGORITHMIC ALTERNATIVES:**

**Pattern Recognition:**
Explain alternative approaches to pattern discovery:
- Statistical methods: Markov chains, Hidden Markov Models, Bayesian networks
- Deep learning: Transformer architectures, LSTM networks, GRU networks
- Traditional ML: Random forests, gradient boosting, decision trees
- Sequence mining: PrefixSpan, SPADE, CloSpan algorithms
- Hybrid approaches combining multiple techniques

**Workflow Optimization:**
Describe alternative optimization methods:
- Reinforcement learning for workflow improvement
- Genetic algorithms for workflow synthesis
- Simulated annealing for parameter optimization
- Constraint satisfaction for workflow validation

**INTEGRATION ALTERNATIVES:**

**Application Integration Methods:**
Explain that applications can be integrated through various means:
- API-based integration (REST, GraphQL, gRPC)
- UI automation (Selenium, Playwright, Puppeteer)
- Native SDKs and libraries
- Browser extensions
- Hybrid approaches combining multiple methods

**WRITING APPROACH:**
Be comprehensive in showing technical variations. Use language like "in alternative embodiments," "additionally," "furthermore," "alternatively" to show scope. The goal is to demonstrate that the core inventive concept applies across many technical implementations.

**OUTPUT:**
Provide only the alternatives description text. No section headers in output, no markdown formatting. This will be Part 4 of the Detailed Description section.`;
}
function ramificationsUserPrompt(p, s) {
  return `**DETAILED DESCRIPTION (ALREADY WRITTEN):**
${s.detailed_description}

**CORE INNOVATION:**
${p.coreIdea}

**INDEPENDENT CLAIMS:**
${p.claimsText}

---

**YOUR MISSION: RAMIFICATIONS AND SCOPE SECTION**

The detailed description showed one way to build the invention. This section demonstrates the breadth of the invention by showing the full range of variations, alternatives, and applications. This maximizes patent scope and defensibility.

**PURPOSE:**
Show that the invention isn't limited to one specific implementation but covers a broad class of related approaches. This prevents competitors from designing around the patent by making trivial modifications.

**REQUIRED CONTENT:**

**1. ALTERNATIVE MATERIALS & TECHNOLOGIES**

For a software invention, cover the full technology stack:

**Programming & Frameworks:**
Explain that the system can be implemented in various programming languages (Python, JavaScript, Go, Rust, Java, C++, etc.), using different frameworks appropriate to each language. The choice of implementation language doesn't change the fundamental invention.

**Data Storage:**
Describe how different database technologies can be used depending on requirements: relational databases for structured data, NoSQL for flexibility, time-series databases for event streams, graph databases for relationship tracking, vector databases for embeddings.

**Infrastructure:**
Explain deployment flexibility: cloud platforms (AWS, Azure, GCP), on-premise infrastructure, hybrid approaches, edge computing, serverless architectures. The hosting model doesn't change the core invention.

**2. DEPLOYMENT SCENARIOS & ENVIRONMENTS**

**Scale Variations:**
Explain how the invention adapts across scales:
- Personal single-user automation on individual devices
- Team/workgroup automation (small organizations)
- Department-level deployment (medium scale)
- Enterprise-wide deployment (large scale)
- Multi-tenant SaaS (service provider model)

**Platform Variations:**
Describe deployment across platforms:
- Desktop operating systems (Windows, macOS, Linux)
- Mobile platforms (iOS, Android)
- Web browsers
- Embedded systems and IoT devices
- Mixed-platform environments

**3. APPLICATIONS & USE CASES**

Beyond the primary use case, explain how this invention applies to:

**Industry-Specific Applications:**
Healthcare, finance, legal, manufacturing, retail, education, government - for each relevant industry, explain how the same core technology addresses that industry's automation needs.

**Functional Categories:**
- Personal productivity optimization
- Business process automation
- Data migration and integration
- Testing and quality assurance
- Security and compliance monitoring
- Customer support operations
- Content creation workflows

**Cross-Industry Patterns:**
Any multi-step process involving multiple applications, any repetitive task with observable patterns, any workflow requiring data coordination between systems.

**4. ALGORITHMIC & METHODOLOGICAL ALTERNATIVES**

**Pattern Recognition Approaches:**
Explain that the pattern recognition can be achieved through various technical approaches: statistical methods (Markov models, Bayesian networks), deep learning (Transformers, recurrent networks), traditional ML (decision trees, ensemble methods), or hybrid approaches combining multiple techniques.

**Optimization Methods:**
Describe alternative approaches to workflow optimization: reinforcement learning, evolutionary algorithms, constraint satisfaction, heuristic search.

**5. INTEGRATION METHODS**

**Application Integration:**
Explain that applications can be integrated through various technical means: REST APIs, GraphQL, gRPC, native SDKs, UI automation frameworks, browser extensions, or hybrid approaches combining multiple methods.

**WRITING APPROACH:**
Be comprehensive and thorough. Use language like "in alternative embodiments," "additionally," "furthermore," "in various implementations" to show scope. The goal is to demonstrate that the core inventive concept applies broadly across many technical variations.

**OUTPUT:**
Provide only the ramifications text. No section headers in the output, no markdown formatting. Be thorough in showing the breadth of patent coverage.`;
}
function abstractUserPrompt(p, s) {
  return `**PATENT TITLE:**
${s.title}

**SUMMARY:**
${s.summary}

**INDEPENDENT CLAIMS:**
${p.claimsText}



---

**YOUR MISSION: PATENT ABSTRACT**

Write the abstract for this provisional patent application. The abstract is the first thing anyone reads and must provide a complete but concise overview.

**USPTO ABSTRACT REQUIREMENTS:**
- Maximum 150 words (this is a strict USPTO requirement)
- Single paragraph with no line breaks
- Technical precision required
- Must be understandable to both technical and non-technical readers
- Should enable someone to understand the invention without reading further
- No marketing language or subjective claims

**REQUIRED ELEMENTS:**

**Opening Statement:**
State what the invention is: "A computing system for..."

**Problem Context:**
Briefly explain what problem it solves: "Existing approaches require explicit programming and cannot..."

**Technical Solution:**
Explain how it works: "The system monitors user interactions, abstracts actions into standardized formats, employs machine learning to identify patterns, and autonomously synthesizes executable workflows..."

**Result:**
State the outcome: "Enabling zero-configuration, personalized automation across disparate applications."

**WRITING REQUIREMENTS:**
- One continuous paragraph
- Exactly 150 words or fewer (count carefully)
- Technical accuracy
- Clear and direct language
- Follow USPTO formatting conventions

**OUTPUT:**
Provide only the abstract text as a single paragraph. No preamble, no markdown formatting.`;
}
function abstractFixerUserPrompt(args) {
  const { p, s, abstract, wordCount } = args;
  return `**COMPLIANCE FAILURE: ABSTRACT EXCEEDS 150-WORD USPTO LIMIT**

**FAILED ABSTRACT (${wordCount} words):**
${abstract}

---

**PATENT BEING DESCRIBED:**

**Title:** ${s.title}

**Core Innovation:** ${p.coreIdea}

**Technical Summary:** ${s.summary}

**Legal Claims:** ${p.claimsText}

---

**YOUR TASK:**

The abstract above is ${wordCount} words. USPTO maximum is 150 words.

Rewrite this abstract to describe THE EXACT SAME INVENTION in under 150 words.

PRESERVE:
- Every system component mentioned
- Every process and action described
- Every input/output relationship
- Every technical outcome stated

The rewritten abstract must be legally equivalent - a patent attorney must confirm both versions describe the same invention with the same scope.

**TARGET:** 120-140 words
**MAXIMUM:** 150 words

**OUTPUT:** The rewritten abstract only. Single paragraph. No commentary.`;
}
function countWords(text2) {
  if (!text2) return 0;
  return String(text2).trim().split(/\s+/).filter(Boolean).length;
}
var MAX_ABSTRACT_FIX_ATTEMPTS = 3;
function buildFormattedDocument(args) {
  const sep = "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550";
  return [
    "TITLE:",
    args.title,
    "",
    sep,
    "",
    "ABSTRACT:",
    args.abstract,
    "",
    sep,
    "",
    "BACKGROUND:",
    args.background,
    "",
    sep,
    "",
    "SUMMARY:",
    args.summary,
    "",
    sep,
    "",
    "DETAILED DESCRIPTION:",
    args.detailedDescription,
    "",
    sep,
    "",
    "RAMIFICATIONS AND SCOPE:",
    args.ramifications,
    "",
    sep,
    "",
    "CLAIMS:",
    args.claims.join("\n\n")
  ].join("\n");
}
async function runProvisional(payload) {
  console.log(">>> [M5-5a PROVISIONAL] <<< starting 9-10 agent pipeline");
  try {
    const parsed = parsePayload(payload);
    const sections = {};
    console.log(">>> [M5-5a PROVISIONAL] <<< 1/9 title");
    sections.title = await runAgent("title", titleUserPrompt(parsed));
    console.log(">>> [M5-5a PROVISIONAL] <<< 2/9 background");
    sections.background = await runAgent("background", backgroundUserPrompt(parsed, sections));
    console.log(">>> [M5-5a PROVISIONAL] <<< 3/9 summary");
    sections.summary = await runAgent("summary", summaryUserPrompt(parsed, sections));
    console.log(">>> [M5-5a PROVISIONAL] <<< 4/9 architecture");
    sections.architecture = await runAgent("architecture", architectureUserPrompt(parsed, sections));
    console.log(">>> [M5-5a PROVISIONAL] <<< 5/9 data-structures");
    sections.data_structures = await runAgent(
      "data-structures",
      dataStructuresUserPrompt(parsed, sections)
    );
    console.log(">>> [M5-5a PROVISIONAL] <<< 6/9 operations");
    sections.operations = await runAgent("operations", operationsUserPrompt(parsed, sections));
    console.log(">>> [M5-5a PROVISIONAL] <<< 7/9 alternatives");
    sections.alternatives = await runAgent(
      "alternatives",
      alternativesUserPrompt(parsed, sections)
    );
    sections.detailed_description = [
      sections.architecture,
      sections.data_structures,
      sections.operations,
      sections.alternatives
    ].join("\n\n");
    console.log(">>> [M5-5a PROVISIONAL] <<< 8/9 ramifications");
    sections.ramifications_and_scope = await runAgent(
      "ramifications",
      ramificationsUserPrompt(parsed, sections)
    );
    console.log(">>> [M5-5a PROVISIONAL] <<< 9/9 abstract");
    let abstract = await runAgent("abstract", abstractUserPrompt(parsed, sections));
    let wordCount = countWords(abstract);
    for (let attempt = 0; wordCount > 150 && attempt < MAX_ABSTRACT_FIX_ATTEMPTS; attempt++) {
      console.log(
        `>>> [M5-5a PROVISIONAL] <<< abstract ${wordCount} words > 150, fixer attempt ${attempt + 1}/${MAX_ABSTRACT_FIX_ATTEMPTS}`
      );
      abstract = await runAgent(
        "abstract-fixer",
        abstractFixerUserPrompt({ p: parsed, s: sections, abstract, wordCount })
      );
      wordCount = countWords(abstract);
    }
    sections.abstract = abstract;
    const claimsArray = [];
    let claimNumber = 1;
    for (const group of parsed.claimGroups) {
      claimsArray.push(`Claim ${claimNumber}: ${group.independent}`);
      claimNumber++;
      for (const dep of group.dependents) {
        claimsArray.push(`Claim ${claimNumber}: ${dep}`);
        claimNumber++;
      }
    }
    const wordCounts = {
      title: countWords(sections.title || ""),
      abstract: countWords(sections.abstract || ""),
      background: countWords(sections.background || ""),
      summary: countWords(sections.summary || ""),
      detailed_description: countWords(sections.detailed_description || ""),
      ramifications: countWords(sections.ramifications_and_scope || "")
    };
    const totalWords = Object.values(wordCounts).reduce((a, b) => a + b, 0);
    const formattedDocument = buildFormattedDocument({
      title: sections.title || "",
      abstract: sections.abstract || "",
      background: sections.background || "",
      summary: sections.summary || "",
      detailedDescription: sections.detailed_description || "",
      ramifications: sections.ramifications_and_scope || "",
      claims: claimsArray
    });
    console.log(
      `>>> [M5-5a PROVISIONAL] <<< done \u2014 ${claimsArray.length} claims, ${totalWords} total words (abstract ${wordCounts.abstract})`
    );
    return {
      success: true,
      sessionId: parsed.sessionId,
      category: parsed.category,
      coreIdea: parsed.coreIdea,
      expandedConcept: parsed.expandedConcept,
      claimGroups: parsed.claimGroups,
      title: sections.title || "",
      abstract: sections.abstract || "",
      background: sections.background || "",
      summary: sections.summary || "",
      detailed_description: sections.detailed_description || "",
      ramifications_and_scope: sections.ramifications_and_scope || "",
      claims: claimsArray,
      claims_count: claimsArray.length,
      word_counts: wordCounts,
      total_words: totalWords,
      formatted_document: formattedDocument,
      broad_claims_glossary: [],
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (error) {
    console.error(">>> [M5-5a PROVISIONAL] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out") ? "AI service timed out. Please try again." : message || "Provisional generation failed";
    return { success: false, error: errorMessage };
  }
}

// server/routes.ts
var SALT_ROUNDS = 10;
var AGENT_TIMEOUT = 9e5;
var N8N_MECHANIC_WEBHOOK = process.env.N8N_MECHANIC_WEBHOOK;
var N8N_WHITESPACE_WEBHOOK = process.env.N8N_WHITESPACE_WEBHOOK;
var N8N_PROVISIONAL_WEBHOOK = process.env.N8N_PROVISIONAL_WEBHOOK;
var N8N_DIAGRAMS_WEBHOOK = process.env.N8N_DIAGRAMS_WEBHOOK;
var N8N_PANNU_QUESTIONS_WEBHOOK = process.env.N8N_PANNU_QUESTIONS_WEBHOOK;
var N8N_PANNU_VALIDATE_WEBHOOK = process.env.N8N_PANNU_VALIDATE_WEBHOOK;
var N8N_PANNU_AI_SUGGESTION_WEBHOOK = process.env.N8N_PANNU_AI_SUGGESTION_WEBHOOK;
var N8N_PRACTITIONER_MATCH_WEBHOOK = process.env.N8N_PRACTITIONER_MATCH_WEBHOOK;
var N8N_QUICK_PRIOR_ART_WEBHOOK = process.env.N8N_QUICK_PRIOR_ART_WEBHOOK;
var N8N_MULTI_CONCEPT_SEARCH_WEBHOOK = process.env.N8N_MULTI_CONCEPT_SEARCH_WEBHOOK;
var N8N_DRAFT_PROVISIONAL_WEBHOOK = process.env.N8N_DRAFT_PROVISIONAL_WEBHOOK;
var N8N_CLAIMS_WEBHOOK = process.env.N8N_CLAIMS_WEBHOOK;
var N8N_BROADER_CLAIMS_WEBHOOK = process.env.N8N_BROADER_CLAIMS_WEBHOOK;
var MECHANIC_INTENT_PATTERNS = [
  /^(please\s+)?add\s+/i,
  /^(please\s+)?fix\s+/i,
  /^(please\s+)?delete\s+/i,
  /^(please\s+)?remove\s+/i,
  /^(please\s+)?change\s+/i,
  /^(please\s+)?modify\s+/i,
  /^(please\s+)?update\s+/i,
  /^(please\s+)?improve\s+/i,
  /^(please\s+)?replace\s+/i,
  /^(please\s+)?include\s+/i,
  /^(please\s+)?discard\s+/i,
  /can you (add|fix|delete|remove|change|modify|update|improve|replace|include|discard)/i,
  /i (want|need|would like) (to\s+)?(add|fix|delete|remove|change|modify|update|improve|replace|include|discard)/i
];
function detectMechanicIntent(message) {
  const trimmed = message.trim().toLowerCase();
  for (const pattern of MECHANIC_INTENT_PATTERNS) {
    if (pattern.test(trimmed)) {
      const actionMatch = trimmed.match(/\b(add|fix|delete|remove|change|modify|update|improve|replace|include|discard)\b/i);
      const action = actionMatch ? actionMatch[1] : "modify";
      return {
        isMechanic: true,
        command: action,
        target: message
        // The full message as the target
      };
    }
  }
  return { isMechanic: false };
}
function sendWebhook(url, payload, timeout = AGENT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const jsonPayload = JSON.stringify(payload);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(jsonPayload)
      },
      timeout
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = data.trim() ? JSON.parse(data) : {};
            resolve(parsed);
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on("error", (error) => {
      reject(error);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.write(jsonPayload);
    req.end();
  });
}
function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1e3;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    pool,
    createTableIfMissing: true,
    ttl: sessionTtl
  });
  return session({
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: true,
    // Resave session on each request to keep it alive
    rolling: true,
    // Reset maxAge on every request - keeps active users logged in
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtl
    }
  });
}
var isAuthenticated = (req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};
var ADMIN_EMAILS = /* @__PURE__ */ new Set([
  (process.env.ADMIN_EMAIL || "albano@bookingboostpro.com").toLowerCase().trim(),
  "tim.bratton@gmail.com"
]);
var isAdmin = async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const user = await storage.getUser(userId);
  if (!user || !ADMIN_EMAILS.has(user.email.toLowerCase().trim())) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
};
async function callN8nWebhook(url, data) {
  try {
    console.log(`Calling n8n webhook: ${url}`);
    const result = await sendWebhook(url, data, AGENT_TIMEOUT);
    console.log(`n8n webhook parsed response:`, result);
    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error(`n8n webhook error:`, error);
    const errorMessage = error.message?.includes("timeout") ? "AI service timed out. Please try again." : error.message || "Webhook call failed";
    return {
      success: false,
      error: errorMessage,
      data: {
        ...data,
        processed: false,
        fallback: true
      }
    };
  }
}
async function clearDownstreamData(projectId, fromStage) {
  console.log(`Clearing downstream data from stage: ${fromStage} for project: ${projectId}`);
  const clearActions = {
    // Stage 1: Brainstorming - clears everything downstream
    "1": { agents: [2, 3, 4, 5] },
    "1a": { agents: [2, 3, 4, 5] },
    "1a-reanalyze": { agents: [2, 3, 4, 5] },
    "1-extract": { agents: [2, 3, 4, 5] },
    // Stage 2a: Concept expansion - clears 2b onwards
    "2a": { agents: [3, 4, 5] },
    // 2b data is part of agent 2
    // Stage 2b: Extract/select ideas - clears 3 onwards
    "2b": { agents: [3, 4, 5] },
    // Stage 3: Prior art - clears 4 onwards  
    "3": { agents: [4, 5] },
    // Stage 4a: White space - clears claims, provisional, diagrams
    "4a": {
      agents: [5],
      agent4Fields: ["claimVariations", "selectedClaims", "selectedVariationId", "editedClaims", "rawClaimsResponse", "claimsGeneratedAt", "claimsSelectedAt", "provisionalDraft", "provisionalGeneratedAt"]
    },
    // Stage 4 claims: Clears selected claims, provisional, diagrams
    "4-claims": {
      agents: [5],
      agent4Fields: ["selectedClaims", "selectedVariationId", "editedClaims", "claimsSelectedAt", "provisionalDraft", "provisionalGeneratedAt"]
    },
    // Stage 4b: Select claims - clears provisional, diagrams
    "4b": {
      agents: [5],
      agent4Fields: ["provisionalDraft", "provisionalGeneratedAt"]
    },
    // Stage 4c: Provisional - clears diagrams only
    "4c": { agents: [5] }
  };
  const action = clearActions[fromStage];
  if (!action) {
    console.log(`No clear action defined for stage: ${fromStage}`);
    return;
  }
  for (const agentNum of action.agents) {
    try {
      await storage.deleteAgentData(projectId, agentNum);
      console.log(`Cleared agent ${agentNum} data for project ${projectId}`);
    } catch (err) {
      console.log(`No agent ${agentNum} data to clear or error:`, err);
    }
  }
  if (action.agent4Fields && action.agent4Fields.length > 0) {
    try {
      const agent4Data = await storage.getAgentData(projectId, 4);
      if (agent4Data?.data) {
        const existingData = { ...agent4Data.data };
        for (const field of action.agent4Fields) {
          delete existingData[field];
        }
        await storage.upsertAgentData({
          projectId,
          agentNumber: 4,
          data: existingData
        });
        console.log(`Cleared agent 4 fields: ${action.agent4Fields.join(", ")}`);
      }
    } catch (err) {
      console.log(`Error clearing agent 4 fields:`, err);
    }
  }
}
var KNOWN_WHITELIST_EMAILS = [
  { email: "albano@bookingboostpro.com", note: "admin" },
  { email: "albanofgonzalez@gmail.com", note: "real user" },
  { email: "tim.bratton@gmail.com", note: "real user" },
  { email: "mercer+pg@tomitrader.com", note: "real user" },
  { email: "aeroclem@icloud.com", note: "real user" },
  { email: "kamnivijay@gmail.com", note: "real user" },
  { email: "karlsbad007@gmail.com", note: "real user" },
  { email: "kasim@3xfreedom.com", note: "real user" },
  { email: "info@finally-painfree.com", note: "real user" },
  { email: "gonzalezalbanof@gmail.com", note: "real user" },
  { email: "jsmyth@carmelestate.com", note: "Jim" },
  { email: "lumen@elevarus.com", note: "Lumen" },
  { email: "shane@elevarus.com", note: "Shane" },
  { email: "neal@taxsherpa.com", note: "Neal" },
  { email: "james@jamespfriel.com", note: "James Friel" },
  { email: "travis@cambridgecommerce.com", note: "Travis" },
  { email: "marc@forwardpush.com", note: "Marc" },
  { email: "gina@skyeyenetwork.com", note: "Gina" },
  { email: "goldstein@goldsteinpc.com", note: "Rich" },
  { email: "richflaneryteam@gmail.com", note: "Rich" },
  { email: "rachel@moolahmarketing.com", note: "Rachel" },
  { email: "gazalew@gmail.com", note: "Gary" }
];
async function seedWhitelistIfEmpty() {
  try {
    const existing = await storage.getWhitelistedEmails();
    const existingEmails = new Set(existing.map((e) => e.email.toLowerCase()));
    const missing = KNOWN_WHITELIST_EMAILS.filter((e) => !existingEmails.has(e.email.toLowerCase()));
    if (missing.length > 0) {
      console.log(`[whitelist] Adding ${missing.length} missing known user(s)...`);
      for (const entry of missing) {
        await storage.addEmailToWhitelist(entry.email, entry.note);
      }
    }
  } catch (err) {
    console.error("[whitelist] Seed error:", err);
  }
}
async function registerRoutes(app2) {
  seedWhitelistIfEmpty().catch((err) => console.error("[whitelist] Seed error:", err));
  app2.use(getSession());
  app2.use(["/api/projects", "/api/prior-art-check"], (req, res, next) => {
    if (req.method === "GET") return next();
    const status = req.session?.whitelistStatus;
    if (status === "read_only") {
      return res.status(403).json({
        message: "Your subscription has lapsed. Please renew to continue building.",
        code: "SUBSCRIPTION_LAPSED"
      });
    }
    return next();
  });
  app2.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password } = insertUserSchema.parse(req.body);
      const allowed = await storage.isEmailWhitelisted(email);
      if (!allowed) {
        return res.status(403).json({ message: "This email address is not authorized to create an account." });
      }
      const passwordRequirements = [
        { test: password.length >= 8, message: "Password must be at least 8 characters" },
        { test: /[A-Z]/.test(password), message: "Password must contain at least one uppercase letter" },
        { test: /[a-z]/.test(password), message: "Password must contain at least one lowercase letter" },
        { test: /\d/.test(password), message: "Password must contain at least one number" },
        { test: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password), message: "Password must contain at least one special character" }
      ];
      const failedRequirement = passwordRequirements.find((req2) => !req2.test);
      if (failedRequirement) {
        return res.status(400).json({ message: failedRequirement.message });
      }
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
      }
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      const user = await storage.createUser({
        email,
        password: hashedPassword
      });
      req.session.userId = user.id;
      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      res.json({ id: user.id, email: user.email });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(400).json({ message: error.message || "Registration failed" });
    }
  });
  app2.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      const allowed = await storage.isEmailWhitelisted(email);
      if (!allowed) {
        return res.status(403).json({ message: "This email address is not authorized to access this application." });
      }
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const whitelistEntry = await storage.getWhitelistEntry(email);
      const whitelistStatus = whitelistEntry?.status || "active";
      req.session.userId = user.id;
      req.session.whitelistStatus = whitelistStatus;
      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      if (!user.twoFactorEnabled) {
        storage.updateLastLogin(user.id).catch(() => {
        });
      }
      res.json({
        id: user.id,
        email: user.email,
        requires2FA: user.twoFactorEnabled || false
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(400).json({ message: "Login failed" });
    }
  });
  app2.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });
  app2.get("/api/admin/users", isAdmin, async (req, res) => {
    try {
      const users2 = await storage.getAdminUsers();
      res.json(users2);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });
  app2.get("/api/admin/whitelist", isAdmin, async (req, res) => {
    try {
      const entries = await storage.getWhitelistedEmails();
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch whitelist" });
    }
  });
  app2.post("/api/admin/whitelist", isAdmin, async (req, res) => {
    try {
      const { email, note } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }
      const entry = await storage.addEmailToWhitelist(email, note);
      res.json(entry);
    } catch (error) {
      if (error.message?.includes("unique")) {
        return res.status(409).json({ message: "Email is already whitelisted" });
      }
      res.status(500).json({ message: "Failed to add email to whitelist" });
    }
  });
  app2.delete("/api/admin/whitelist/:email", isAdmin, async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      await storage.removeEmailFromWhitelist(email);
      res.json({ message: "Email removed from whitelist" });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove email from whitelist" });
    }
  });
  app2.patch("/api/admin/whitelist/:email/status", isAdmin, async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const { status } = req.body;
      if (!status || !["active", "read_only"].includes(status)) {
        return res.status(400).json({ message: "status must be 'active' or 'read_only'" });
      }
      const entry = await storage.updateWhitelistStatus(email, status);
      res.json(entry);
    } catch (error) {
      res.status(500).json({ message: "Failed to update status" });
    }
  });
  app2.post("/api/webhook/whitelist-add", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.WHITELIST_API_KEY;
    if (!expectedKey) {
      return res.status(500).json({ message: "Webhook API key not configured on server" });
    }
    if (!apiKey || apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized \u2014 invalid or missing API key" });
    }
    const { email, note } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "email is required" });
    }
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const entry = await storage.addEmailToWhitelist(normalizedEmail, note || "");
      console.log(`[whitelist-webhook] Added: ${normalizedEmail}`);
      return res.json({ success: true, email: normalizedEmail, entry });
    } catch (error) {
      if (error.message?.includes("unique")) {
        return res.status(409).json({ success: false, message: "Email is already whitelisted" });
      }
      console.error("[whitelist-webhook] Error:", error);
      return res.status(500).json({ success: false, message: "Failed to add email to whitelist" });
    }
  });
  app2.post("/api/webhook/whitelist-suspend", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.WHITELIST_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "email is required" });
    }
    try {
      const entry = await storage.updateWhitelistStatus(email.trim().toLowerCase(), "read_only");
      console.log(`[whitelist-webhook] Suspended (read_only): ${email}`);
      return res.json({ success: true, email: entry.email, status: entry.status });
    } catch (error) {
      console.error("[whitelist-webhook] Suspend error:", error);
      return res.status(404).json({ success: false, message: "Email not found in whitelist" });
    }
  });
  app2.post("/api/webhook/whitelist-reactivate", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.WHITELIST_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "email is required" });
    }
    try {
      const entry = await storage.updateWhitelistStatus(email.trim().toLowerCase(), "active");
      console.log(`[whitelist-webhook] Reactivated: ${email}`);
      return res.json({ success: true, email: entry.email, status: entry.status });
    } catch (error) {
      console.error("[whitelist-webhook] Reactivate error:", error);
      return res.status(404).json({ success: false, message: "Email not found in whitelist" });
    }
  });
  app2.get("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const twoFactorVerified = req.session.twoFactorVerified || false;
      const subscriptionStatus = req.session.whitelistStatus || "active";
      res.json({
        id: user.id,
        email: user.email,
        twoFactorEnabled: user.twoFactorEnabled || false,
        twoFactorMethod: user.twoFactorMethod || null,
        twoFactorVerified,
        subscriptionStatus
      });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
  const GHL_EMAIL_WEBHOOK = process.env.GHL_EMAIL_WEBHOOK || "";
  function generateEmailCode() {
    return Math.floor(1e5 + Math.random() * 9e5).toString();
  }
  app2.post("/api/2fa/initiate", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const { method } = req.body;
      if (!method || !["email", "totp"].includes(method)) {
        return res.status(400).json({ message: "Invalid 2FA method" });
      }
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (method === "totp") {
        const secret = generateSecret();
        const otpauthUrl = generateURI({
          issuer: "Patent Geyser",
          label: user.email,
          secret,
          algorithm: "sha1",
          digits: 6,
          period: 30
        });
        const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);
        await storage.updateUser2FA(userId, {
          twoFactorMethod: "totp",
          totpSecret: secret,
          twoFactorEnabled: false
        });
        res.json({ qrCodeUrl, secret });
      } else {
        const code = generateEmailCode();
        const expiry = new Date(Date.now() + 10 * 60 * 1e3);
        await storage.updateUser2FA(userId, {
          twoFactorMethod: "email",
          pendingTwoFactorCode: code,
          pendingTwoFactorExpiry: expiry,
          twoFactorEnabled: false
        });
        if (GHL_EMAIL_WEBHOOK) {
          try {
            await sendWebhook(GHL_EMAIL_WEBHOOK, {
              email: user.email,
              code,
              type: "2fa_setup",
              subject: "Patent Geyser - 2FA Setup Code",
              message: `Your verification code is: ${code}. This code will expire in 10 minutes.`
            }, 3e4);
          } catch (emailError) {
            console.error("Failed to send 2FA email:", emailError);
            return res.status(500).json({ message: "Failed to send verification email" });
          }
        } else {
          console.log("GHL webhook not configured, 2FA code:", code);
        }
        res.json({ message: "Verification code sent to your email" });
      }
    } catch (error) {
      console.error("2FA initiate error:", error);
      res.status(500).json({ message: "Failed to initiate 2FA setup" });
    }
  });
  app2.post("/api/2fa/verify-setup", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const { code } = req.body;
      if (!code || typeof code !== "string" || code.length !== 6) {
        return res.status(400).json({ message: "Invalid verification code" });
      }
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      let isValid = false;
      if (user.twoFactorMethod === "totp" && user.totpSecret) {
        const verifyResult = await verifyTOTP({ token: code, secret: user.totpSecret });
        isValid = verifyResult.valid;
      } else if (user.twoFactorMethod === "email") {
        if (user.pendingTwoFactorCode === code && user.pendingTwoFactorExpiry) {
          const now = /* @__PURE__ */ new Date();
          isValid = now < user.pendingTwoFactorExpiry;
        }
      }
      if (!isValid) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }
      await storage.updateUser2FA(userId, {
        twoFactorEnabled: true,
        pendingTwoFactorCode: null,
        pendingTwoFactorExpiry: null,
        twoFactorVerifiedAt: /* @__PURE__ */ new Date()
      });
      req.session.twoFactorVerified = true;
      res.json({ message: "2FA enabled successfully" });
    } catch (error) {
      console.error("2FA verify-setup error:", error);
      res.status(500).json({ message: "Failed to verify 2FA" });
    }
  });
  app2.post("/api/2fa/verify", async (req, res) => {
    try {
      const { code, userId } = req.body;
      if (!code || typeof code !== "string" || code.length !== 6) {
        return res.status(400).json({ message: "Invalid verification code" });
      }
      const pendingUserId = req.session.pending2FAUserId || userId;
      if (!pendingUserId) {
        return res.status(400).json({ message: "No pending 2FA verification" });
      }
      const user = await storage.getUser(pendingUserId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      let isValid = false;
      if (user.twoFactorMethod === "totp" && user.totpSecret) {
        const verifyResult = await verifyTOTP({ token: code, secret: user.totpSecret });
        isValid = verifyResult.valid;
      } else if (user.twoFactorMethod === "email") {
        if (user.pendingTwoFactorCode === code && user.pendingTwoFactorExpiry) {
          const now = /* @__PURE__ */ new Date();
          isValid = now < user.pendingTwoFactorExpiry;
        }
      }
      if (!isValid) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }
      if (user.twoFactorMethod === "email") {
        await storage.updateUser2FA(pendingUserId, {
          pendingTwoFactorCode: null,
          pendingTwoFactorExpiry: null,
          twoFactorVerifiedAt: /* @__PURE__ */ new Date()
        });
      }
      req.session.userId = pendingUserId;
      req.session.twoFactorVerified = true;
      delete req.session.pending2FAUserId;
      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      storage.updateLastLogin(pendingUserId).catch(() => {
      });
      res.json({ id: user.id, email: user.email });
    } catch (error) {
      console.error("2FA verify error:", error);
      res.status(500).json({ message: "Failed to verify 2FA" });
    }
  });
  app2.post("/api/2fa/send-code", async (req, res) => {
    try {
      const { userId } = req.body;
      const pendingUserId = req.session.pending2FAUserId || userId;
      if (!pendingUserId) {
        return res.status(400).json({ message: "No pending 2FA verification" });
      }
      const user = await storage.getUser(pendingUserId);
      if (!user || user.twoFactorMethod !== "email") {
        return res.status(400).json({ message: "Email 2FA not configured for this user" });
      }
      const code = generateEmailCode();
      const expiry = new Date(Date.now() + 10 * 60 * 1e3);
      await storage.updateUser2FA(pendingUserId, {
        pendingTwoFactorCode: code,
        pendingTwoFactorExpiry: expiry
      });
      if (GHL_EMAIL_WEBHOOK) {
        try {
          await sendWebhook(GHL_EMAIL_WEBHOOK, {
            email: user.email,
            code,
            type: "2fa_login",
            subject: "Patent Geyser - Login Verification Code",
            message: `Your login verification code is: ${code}. This code will expire in 10 minutes.`
          }, 3e4);
        } catch (emailError) {
          console.error("Failed to send 2FA email:", emailError);
          return res.status(500).json({ message: "Failed to send verification email" });
        }
      } else {
        console.log("GHL webhook not configured, 2FA code:", code);
      }
      res.json({ message: "Verification code sent to your email" });
    } catch (error) {
      console.error("2FA send-code error:", error);
      res.status(500).json({ message: "Failed to send verification code" });
    }
  });
  app2.post("/api/2fa/disable", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      await storage.updateUser2FA(userId, {
        twoFactorEnabled: false,
        twoFactorMethod: null,
        totpSecret: null,
        pendingTwoFactorCode: null,
        pendingTwoFactorExpiry: null
      });
      res.json({ message: "2FA disabled successfully" });
    } catch (error) {
      console.error("2FA disable error:", error);
      res.status(500).json({ message: "Failed to disable 2FA" });
    }
  });
  app2.get("/api/2fa/status", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json({
        enabled: user.twoFactorEnabled || false,
        method: user.twoFactorMethod || null,
        verified: req.session.twoFactorVerified || false
      });
    } catch (error) {
      console.error("2FA status error:", error);
      res.status(500).json({ message: "Failed to get 2FA status" });
    }
  });
  const GHL_PASSWORD_RESET_WEBHOOK = process.env.GHL_PASSWORD_RESET_WEBHOOK || "";
  app2.post("/api/auth/change-password", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }
      const user = await storage.getUser(userId);
      if (!user || !user.password) {
        return res.status(404).json({ message: "User not found" });
      }
      const bcrypt2 = await import("bcryptjs");
      const isValid = await bcrypt2.compare(currentPassword, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }
      const hashedPassword = await bcrypt2.hash(newPassword, 10);
      await storage.updateUserPassword(userId, hashedPassword);
      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });
  app2.post("/api/auth/request-password-reset", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const code = generateEmailCode();
      const expiry = new Date(Date.now() + 10 * 60 * 1e3);
      await storage.updateUser2FA(userId, {
        pendingTwoFactorCode: code,
        pendingTwoFactorExpiry: expiry
      });
      if (GHL_PASSWORD_RESET_WEBHOOK) {
        try {
          await sendWebhook(GHL_PASSWORD_RESET_WEBHOOK, {
            email: user.email,
            code,
            type: "password_reset",
            subject: "Patent Geyser - Password Reset Code",
            message: `Your password reset code is: ${code}. This code will expire in 10 minutes.`
          }, 3e4);
        } catch (emailError) {
          console.error("Failed to send password reset email:", emailError);
          return res.status(500).json({ message: "Failed to send reset email" });
        }
      } else {
        console.log("GHL password reset webhook not configured, code:", code);
      }
      res.json({ message: "Reset code sent to your email" });
    } catch (error) {
      console.error("Request password reset error:", error);
      res.status(500).json({ message: "Failed to request password reset" });
    }
  });
  app2.post("/api/auth/reset-password", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const { code, newPassword } = req.body;
      if (!code || !newPassword) {
        return res.status(400).json({ message: "Reset code and new password are required" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (!user.pendingTwoFactorCode || user.pendingTwoFactorCode !== code) {
        return res.status(401).json({ message: "Invalid reset code" });
      }
      if (user.pendingTwoFactorExpiry && new Date(user.pendingTwoFactorExpiry) < /* @__PURE__ */ new Date()) {
        return res.status(401).json({ message: "Reset code has expired" });
      }
      const bcrypt2 = await import("bcryptjs");
      const hashedPassword = await bcrypt2.hash(newPassword, 10);
      await storage.updateUserPassword(userId, hashedPassword);
      await storage.updateUser2FA(userId, {
        pendingTwoFactorCode: null,
        pendingTwoFactorExpiry: null
      });
      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });
  const resetTokens = /* @__PURE__ */ new Map();
  app2.post("/api/auth/forgot-password/init", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      const user = await storage.getUserByEmail(email.toLowerCase());
      if (!user) {
        return res.status(404).json({ message: "No account found with that email address." });
      }
      let method = "email";
      if (user.twoFactorMethod === "totp" && user.totpSecret) {
        method = "totp";
        res.json({ method: "totp", message: "Enter your authenticator code" });
      } else {
        const code = generateEmailCode();
        const expiry = new Date(Date.now() + 10 * 60 * 1e3);
        await storage.updateUser2FA(user.id, {
          pendingTwoFactorCode: code,
          pendingTwoFactorExpiry: expiry
        });
        if (GHL_PASSWORD_RESET_WEBHOOK) {
          try {
            await sendWebhook(GHL_PASSWORD_RESET_WEBHOOK, {
              email: user.email,
              code,
              message: `Your password reset code is: ${code}. This code will expire in 10 minutes.`
            }, 3e4);
          } catch (emailError) {
            console.error("Failed to send forgot password email:", emailError);
            return res.status(500).json({ message: "Failed to send verification email" });
          }
        } else {
          console.log("GHL password reset webhook not configured, code:", code);
        }
        res.json({ method: "email", message: "Verification code sent to your email" });
      }
    } catch (error) {
      console.error("Forgot password init error:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });
  app2.post("/api/auth/forgot-password/verify", async (req, res) => {
    try {
      const { email, code, method } = req.body;
      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }
      const user = await storage.getUserByEmail(email.toLowerCase());
      if (!user) {
        return res.status(401).json({ message: "Invalid verification code" });
      }
      let isValid = false;
      if (method === "totp" && user.totpSecret) {
        const verifyResult = await verifyTOTP({ token: code, secret: user.totpSecret });
        isValid = verifyResult.valid;
      } else {
        const storedCode = user.pendingTwoFactorCode?.toString().trim();
        const submittedCode = code?.toString().trim();
        console.log("Forgot password verify - stored:", storedCode, "submitted:", submittedCode);
        if (!storedCode || storedCode !== submittedCode) {
          return res.status(401).json({ message: "Invalid verification code" });
        }
        if (user.pendingTwoFactorExpiry && new Date(user.pendingTwoFactorExpiry) < /* @__PURE__ */ new Date()) {
          return res.status(401).json({ message: "Verification code has expired" });
        }
        isValid = true;
      }
      if (!isValid) {
        return res.status(401).json({ message: "Invalid verification code" });
      }
      const resetToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const tokenExpiry = new Date(Date.now() + 15 * 60 * 1e3);
      resetTokens.set(resetToken, { email: user.email, expiry: tokenExpiry });
      if (method !== "totp") {
        await storage.updateUser2FA(user.id, {
          pendingTwoFactorCode: null,
          pendingTwoFactorExpiry: null
        });
      }
      res.json({ resetToken, message: "Verified successfully" });
    } catch (error) {
      console.error("Forgot password verify error:", error);
      res.status(500).json({ message: "Failed to verify code" });
    }
  });
  app2.post("/api/auth/forgot-password/reset", async (req, res) => {
    try {
      const { email, resetToken, newPassword } = req.body;
      if (!email || !resetToken || !newPassword) {
        return res.status(400).json({ message: "Email, reset token, and new password are required" });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      const tokenData = resetTokens.get(resetToken);
      if (!tokenData) {
        return res.status(401).json({ message: "Invalid or expired reset token" });
      }
      if (tokenData.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(401).json({ message: "Invalid reset token" });
      }
      if (tokenData.expiry < /* @__PURE__ */ new Date()) {
        resetTokens.delete(resetToken);
        return res.status(401).json({ message: "Reset token has expired" });
      }
      const user = await storage.getUserByEmail(email.toLowerCase());
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await storage.updateUserPassword(user.id, hashedPassword);
      resetTokens.delete(resetToken);
      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error("Forgot password reset error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });
  app2.get("/api/prior-art-searches", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const searches = await storage.getPriorArtSearches(userId);
      res.json(searches);
    } catch (error) {
      console.error("Get prior art searches error:", error);
      res.status(500).json({ message: "Failed to fetch search history" });
    }
  });
  app2.post("/api/prior-art-check", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const { searchText } = req.body;
      if (!searchText || typeof searchText !== "string" || searchText.trim().length < 10) {
        return res.status(400).json({ message: "Please provide at least 10 characters describing your idea" });
      }
      console.log("Running quick prior art check for user:", userId);
      const webhookPayload = {
        sessionId: `quick-check-${userId}-${Date.now()}`,
        idea: searchText.trim()
      };
      const webhookResponse = await sendWebhook(N8N_QUICK_PRIOR_ART_WEBHOOK, webhookPayload);
      console.log("Quick prior art webhook raw response:", JSON.stringify(webhookResponse, null, 2));
      let results = [];
      const responseData = Array.isArray(webhookResponse) ? webhookResponse[0] : webhookResponse;
      if (responseData?.results?.patents && Array.isArray(responseData.results.patents)) {
        results = responseData.results.patents;
      } else if (Array.isArray(responseData?.patents)) {
        results = responseData.patents;
      } else if (Array.isArray(responseData?.results)) {
        results = responseData.results;
      } else if (Array.isArray(responseData)) {
        results = responseData;
      } else {
        console.log("Could not find patent array in response structure");
        results = [];
      }
      console.log(`Extracted ${results.length} prior art results`);
      const analysis = responseData?.analysis || null;
      if (analysis) {
        console.log(`Analysis includes ${analysis.key_differentiators?.length || 0} key differentiators, ${analysis.claims_focus?.length || 0} claims focus items`);
      }
      const savedSearch = await storage.createPriorArtSearch({
        userId,
        searchText: searchText.trim(),
        results,
        analysis
      });
      console.log(`Prior art check completed: ${results.length} results found`);
      res.json({
        success: true,
        search: savedSearch
      });
    } catch (error) {
      console.error("Prior art check error:", error);
      res.status(500).json({ message: error.message || "Failed to run prior art check" });
    }
  });
  app2.delete("/api/prior-art-searches/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deletePriorArtSearch(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete prior art search error:", error);
      res.status(500).json({ message: "Failed to delete search" });
    }
  });
  app2.get("/api/projects", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const userProjects = await storage.getProjectsByUserId(userId);
      res.json(userProjects);
    } catch (error) {
      console.error("Get projects error:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });
  app2.get("/api/projects/:id", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(project);
    } catch (error) {
      console.error("Get project error:", error);
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });
  app2.post("/api/projects", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const projectData = insertProjectSchema.parse({
        ...req.body,
        userId
      });
      const project = await storage.createProject(projectData);
      res.json(project);
    } catch (error) {
      console.error("Create project error:", error);
      res.status(400).json({ message: error.message || "Failed to create project" });
    }
  });
  app2.post("/api/projects/:id/complete", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const updated = await storage.updateProject(req.params.id, {
        completed: 1,
        currentStage: 5
      });
      res.json(updated);
    } catch (error) {
      console.error("Complete project error:", error);
      res.status(500).json({ message: "Failed to complete project" });
    }
  });
  app2.patch("/api/projects/:id", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const updateSchema = z2.object({
        title: z2.string().min(1, "Title is required").max(200, "Title is too long").trim()
      });
      const validation = updateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: validation.error.issues[0]?.message || "Invalid input"
        });
      }
      const updatedProject = await storage.updateProject(req.params.id, {
        title: validation.data.title
      });
      res.json(updatedProject);
    } catch (error) {
      console.error("Update project error:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });
  app2.delete("/api/projects/:id", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteProject(req.params.id);
      res.json({ success: true, message: "Project deleted successfully" });
    } catch (error) {
      console.error("Delete project error:", error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });
  app2.get("/api/projects/:id/current-idea", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const snapshots = await storage.getIdeaSnapshots(req.params.id);
      const currentIdea = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
      res.json({
        currentIdea: currentIdea?.content || null,
        currentVersion: currentIdea?.version || 0,
        snapshots
      });
    } catch (error) {
      console.error("Get current idea error:", error);
      res.status(500).json({ message: "Failed to fetch current idea" });
    }
  });
  app2.post("/api/projects/:id/current-idea", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { snapshotType, title, content, command, qualityScore, metadata } = req.body;
      if (!snapshotType || !content) {
        return res.status(400).json({ message: "snapshotType and content are required" });
      }
      const nextVersion = await storage.getNextSnapshotVersion(req.params.id);
      const snapshot = await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: nextVersion,
        snapshotType,
        title,
        content,
        command,
        qualityScore,
        metadata
      });
      res.json(snapshot);
    } catch (error) {
      console.error("Create idea snapshot error:", error);
      res.status(500).json({ message: "Failed to create idea snapshot" });
    }
  });
  app2.post("/api/projects/:id/backfill-snapshots", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const existingSnapshots = await storage.getIdeaSnapshots(req.params.id);
      if (existingSnapshots.length > 0 && !req.body.force) {
        return res.json({
          message: "Snapshots already exist",
          snapshotCount: existingSnapshots.length,
          snapshots: existingSnapshots
        });
      }
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent3Data = await storage.getAgentData(req.params.id, 3);
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const createdSnapshots = [];
      let version = 1;
      const createSnapshot = async (snapshotType, content, title, command, metadata) => {
        const snapshot = await storage.createIdeaSnapshot({
          projectId: req.params.id,
          version: version++,
          snapshotType,
          title,
          content,
          command,
          metadata
        });
        createdSnapshots.push(snapshot);
        return snapshot;
      };
      if (agent1Data) {
        const a1 = agent1Data;
        if (a1.ideaSummary) {
          await createSnapshot("root", a1.ideaSummary, "Initial Idea");
        } else if (a1.rounds && a1.rounds.length > 0 && a1.rounds[0].userMessage) {
          await createSnapshot("root", a1.rounds[0].userMessage, "Initial Idea");
        }
        if (a1.rounds && a1.rounds.length > 0) {
          for (let i = 0; i < Math.min(a1.rounds.length, 3); i++) {
            const round = a1.rounds[i];
            if (round.transcript) {
              await createSnapshot(
                "debate",
                round.transcript.substring(0, 2e3),
                // Truncate for storage
                `Debate Round ${i + 1}`
              );
            }
          }
        }
      }
      if (agent2Data) {
        const a2 = agent2Data;
        if (a2.expandedDraft || a2.expandedConcept) {
          await createSnapshot(
            "2a_concept_expansion",
            a2.expandedDraft || a2.expandedConcept,
            "Concept Expanded"
          );
        }
        if (a2.extractedIdeas && a2.extractedIdeas.length > 0) {
          const selectedIdeas = a2.extractedIdeas.filter((idea) => idea.selected !== false).map((idea) => `**${idea.title}**
${idea.description || idea.content || ""}`).join("\n\n");
          if (selectedIdeas) {
            await createSnapshot(
              "2b_selected_ideas",
              selectedIdeas,
              `${a2.extractedIdeas.filter((i) => i.selected !== false).length} Ideas Selected`,
              void 0,
              { ideaCount: a2.extractedIdeas.filter((i) => i.selected !== false).length }
            );
          }
        }
      }
      if (agent3Data) {
        const a3 = agent3Data;
        if (a3.results || a3.searchResults) {
          const results = a3.results || a3.searchResults;
          let priorArtSummary = "Prior Art Research Complete\n\n";
          if (Array.isArray(results)) {
            priorArtSummary += results.slice(0, 5).map(
              (r) => `- ${r.title || r.name || "Result"}: ${r.summary || r.description || ""}`
            ).join("\n");
          }
          await createSnapshot(
            "3_prior_art",
            priorArtSummary,
            "Prior Art Research"
          );
        }
      }
      if (agent4Data) {
        const a4 = agent4Data;
        if (a4.nuggetAnalyses && a4.nuggetAnalyses.length > 0) {
          const whiteSpaceSummary = a4.nuggetAnalyses.map(
            (analysis) => `**${analysis.conceptTitle || "Concept"}**
Risk: ${analysis.riskLevel || "Unknown"}
Strategy: ${analysis.whiteSpaceStrategy || analysis.strategy || "N/A"}`
          ).join("\n\n");
          await createSnapshot(
            "4a_white_space",
            whiteSpaceSummary,
            "White Space Analysis",
            void 0,
            { analysisCount: a4.nuggetAnalyses.length }
          );
        }
        if (a4.selectedVariation) {
          const variation = a4.selectedVariation;
          let claimsSummary = `**Selected Claims (Variation ${variation.variationNumber || "N/A"})**

`;
          claimsSummary += `Strategy: ${variation.strategySummary || "N/A"}

`;
          if (variation.claims && variation.claims.length > 0) {
            claimsSummary += variation.claims.map(
              (c) => `${c.type || c.claimType}: ${c.text || c.content || ""}`
            ).join("\n\n");
          }
          await createSnapshot(
            "4b_claims",
            claimsSummary,
            "Claims Selected",
            void 0,
            { variationNumber: variation.variationNumber }
          );
        } else if (a4.claimVariations && a4.claimVariations.length > 0) {
          const firstVar = a4.claimVariations[0];
          let claimsSummary = `**Claims (Variation 1)**

`;
          claimsSummary += `Strategy: ${firstVar.strategySummary || "N/A"}

`;
          if (firstVar.claims && firstVar.claims.length > 0) {
            claimsSummary += firstVar.claims.slice(0, 3).map(
              (c) => `${c.type || c.claimType}: ${c.text || c.content || ""}`
            ).join("\n\n");
          }
          await createSnapshot(
            "4b_claims",
            claimsSummary,
            "Claims Generated"
          );
        }
        if (a4.provisionalDraft) {
          const draft = a4.provisionalDraft;
          let provisionalSummary = `# ${draft.title || "Provisional Patent Application"}

`;
          if (draft.abstract) {
            provisionalSummary += `**Abstract:**
${draft.abstract}

`;
          }
          if (draft.summary) {
            provisionalSummary += `**Summary:**
${draft.summary.substring(0, 500)}...

`;
          }
          await createSnapshot(
            "4c_provisional",
            provisionalSummary,
            draft.title || "Provisional Draft",
            void 0,
            { claimsCount: draft.claims_count || draft.claims?.length || 0 }
          );
        }
      }
      if (agent5Data) {
        const a5 = agent5Data;
        if (a5.diagrams && a5.diagrams.length > 0) {
          const diagramSummary = a5.diagrams.map(
            (d, i) => `**Diagram ${i + 1}:**
${d.title || d.description || d.text?.substring(0, 200) || "Technical Diagram"}`
          ).join("\n\n");
          await createSnapshot(
            "5_diagrams",
            diagramSummary,
            `${a5.diagrams.length} Diagrams Generated`,
            void 0,
            { diagramCount: a5.diagrams.length }
          );
        }
      }
      res.json({
        message: "Snapshots backfilled successfully",
        snapshotCount: createdSnapshots.length,
        snapshots: createdSnapshots
      });
    } catch (error) {
      console.error("Backfill snapshots error:", error);
      res.status(500).json({ message: "Failed to backfill snapshots" });
    }
  });
  app2.get("/api/projects/:id/source-code", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json({
        files: project.sourceCodeFiles || [],
        updatedAt: project.updatedAt
      });
    } catch (error) {
      console.error("Get source code error:", error);
      res.status(500).json({ message: "Failed to fetch source code" });
    }
  });
  app2.post("/api/projects/:id/source-code", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { sourceCode, fileName, codeDescription } = req.body;
      if (!sourceCode || typeof sourceCode !== "string") {
        return res.status(400).json({ message: "sourceCode is required" });
      }
      const existingFiles = project.sourceCodeFiles || [];
      const newFile = {
        id: `code-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        fileName: fileName || `code-${existingFiles.length + 1}.txt`,
        description: codeDescription || "",
        code: sourceCode,
        addedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const updatedFiles = [...existingFiles, newFile];
      await storage.updateProject(req.params.id, {
        sourceCodeFiles: updatedFiles
      });
      res.json({
        message: "Source code added successfully",
        file: newFile,
        files: updatedFiles
      });
    } catch (error) {
      console.error("Save source code error:", error);
      res.status(500).json({ message: "Failed to save source code" });
    }
  });
  app2.delete("/api/projects/:id/source-code/:fileId", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const existingFiles = project.sourceCodeFiles || [];
      const updatedFiles = existingFiles.filter((f) => f.id !== req.params.fileId);
      if (updatedFiles.length === existingFiles.length) {
        return res.status(404).json({ message: "File not found" });
      }
      await storage.updateProject(req.params.id, {
        sourceCodeFiles: updatedFiles
      });
      res.json({ message: "Source code file removed successfully", files: updatedFiles });
    } catch (error) {
      console.error("Delete source code file error:", error);
      res.status(500).json({ message: "Failed to delete source code file" });
    }
  });
  app2.delete("/api/projects/:id/source-code", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      if (project.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.updateProject(req.params.id, {
        sourceCodeFiles: []
      });
      res.json({ message: "All source code removed successfully" });
    } catch (error) {
      console.error("Delete source code error:", error);
      res.status(500).json({ message: "Failed to delete source code" });
    }
  });
  app2.get("/api/projects/:id/agent/:agentNumber", isAuthenticated, async (req, res) => {
    try {
      const agentNumber = parseInt(req.params.agentNumber);
      const data = await storage.getAgentData(req.params.id, agentNumber);
      res.json(data || { data: {} });
    } catch (error) {
      console.error("Get agent data error:", error);
      res.status(500).json({ message: "Failed to fetch agent data" });
    }
  });
  app2.post("/api/projects/:id/agent/1", isAuthenticated, async (req, res) => {
    try {
      const savedData = await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: req.body
      });
      res.json(savedData);
    } catch (error) {
      console.error("Save agent 1 data error:", error);
      res.status(500).json({ message: "Failed to save data" });
    }
  });
  app2.post("/api/projects/:id/agent/1/rounds", isAuthenticated, async (req, res) => {
    try {
      const { idea, message } = req.body;
      const existingData = await storage.getAgentData(req.params.id, 1);
      const currentData = existingData?.data || {};
      const rounds = currentData.rounds || [];
      if (rounds.length === 0 && (!idea || typeof idea !== "string" || idea.trim().length === 0)) {
        return res.status(400).json({ message: "Idea is required for first brainstorming round" });
      }
      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({ message: "Message is required" });
      }
      const ideaSummary = rounds.length === 0 ? idea.trim() : currentData.ideaSummary;
      const sessionId = rounds.length === 0 ? `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}` : currentData.sessionId;
      let latestSnapshot = await storage.getLatestIdeaSnapshot(req.params.id);
      if (rounds.length === 0 && !latestSnapshot) {
        const rootVersion = await storage.getNextSnapshotVersion(req.params.id);
        await storage.createIdeaSnapshot({
          projectId: req.params.id,
          version: rootVersion,
          snapshotType: "root",
          title: "Initial Idea",
          content: ideaSummary,
          metadata: { source: "initial_submission" }
        });
        latestSnapshot = await storage.getLatestIdeaSnapshot(req.params.id);
      }
      const currentIdea = latestSnapshot?.content || ideaSummary;
      const forceReview = req.body.forceReview === true;
      const forceMechanic = req.body.forceMechanic === true;
      const intent = detectMechanicIntent(message);
      const existingSnapshots = await storage.getIdeaSnapshots(req.params.id);
      const hasBaseSnapshot = existingSnapshots.length > 0;
      const isMechanicRequest = rounds.length > 0 && hasBaseSnapshot && !forceReview && (forceMechanic || intent.isMechanic);
      let n8nResponse;
      let roundType = "brainstorm";
      if (isMechanicRequest) {
        roundType = "mechanic";
        console.log(`[Agent 1B - Mechanic] Processing command: ${intent.command}`);
        n8nResponse = await callN8nWebhook(N8N_MECHANIC_WEBHOOK, {
          projectId: req.params.id,
          currentIdea,
          // The idea after Advocate/Examiner debate
          userRequest: message,
          // User's refinement request (e.g., "add encryption")
          sessionId
        });
      } else {
        const brainstormIdea = forceReview ? currentIdea : ideaSummary;
        n8nResponse = await runDebate({
          idea: brainstormIdea,
          category: (await storage.getProject(req.params.id))?.category
        });
      }
      if (!n8nResponse.success) {
        console.error("n8n webhook failed:", n8nResponse.error);
        const userMessage = n8nResponse.error?.includes("empty response") ? "The AI service is temporarily unavailable. Please wait a moment and try again." : n8nResponse.error?.includes("timed out") ? "The AI service took too long to respond. Please try again." : isMechanicRequest ? "AI mechanic service failed. Please try again." : "AI brainstorming service failed. Please try again.";
        return res.status(503).json({
          success: false,
          message: userMessage,
          error: n8nResponse.error
        });
      }
      let agentsDebate;
      let transcript;
      let updatedIdea;
      let qualityScore;
      if (isMechanicRequest) {
        const mechanicResponse = n8nResponse.data || {};
        let rawUpdatedIdea = mechanicResponse.modifiedIdea || mechanicResponse.updatedIdea || currentIdea;
        const examinerIndex = rawUpdatedIdea.indexOf("**Examiner Challenges");
        if (examinerIndex > 0) {
          rawUpdatedIdea = rawUpdatedIdea.substring(0, examinerIndex).trim();
        }
        updatedIdea = rawUpdatedIdea;
        qualityScore = mechanicResponse.qualityScore || null;
        const changesApplied = mechanicResponse.changesApplied || null;
        agentsDebate = [{
          speaker: "Mechanic",
          message: changesApplied || mechanicResponse.explanation || `Updated idea based on your request to ${intent.command}.`
        }];
        if (mechanicResponse.validation) {
          agentsDebate.push({
            speaker: "Quality Check",
            message: mechanicResponse.validation
          });
        }
        transcript = mechanicResponse.transcript;
        const nextVersion = await storage.getNextSnapshotVersion(req.params.id);
        await storage.createIdeaSnapshot({
          projectId: req.params.id,
          version: nextVersion,
          snapshotType: `mechanic_${intent.command}`,
          title: `${intent.command?.charAt(0).toUpperCase()}${intent.command?.slice(1)} update`,
          content: updatedIdea,
          command: message,
          qualityScore: qualityScore?.toString(),
          metadata: {
            previousVersion: latestSnapshot?.version || 0,
            command: intent.command,
            changesApplied
          }
        });
      } else {
        const data = n8nResponse.data || {};
        const fullDebate = data.fullDebate || [];
        transcript = data.transcript;
        if (fullDebate.length > 0) {
          agentsDebate = fullDebate.map((entry) => ({
            speaker: entry.speaker || entry.role || "Unknown",
            message: entry.message || entry.content || ""
          }));
        } else {
          agentsDebate = [];
        }
        const advocateInsights = agentsDebate.filter((d) => d.speaker === "Advocate").map((d) => d.message).join("\n\n");
        const examinerChallenges = agentsDebate.filter((d) => d.speaker === "Examiner").map((d) => d.message).join("\n\n");
        if (advocateInsights || examinerChallenges) {
          const nextVersion = await storage.getNextSnapshotVersion(req.params.id);
          let debateContent = currentIdea;
          if (advocateInsights) {
            debateContent += `

**Advocate Additions:**
${advocateInsights}`;
          }
          if (examinerChallenges) {
            debateContent += `

**Examiner Challenges (addressed):**
${examinerChallenges}`;
          }
          await storage.createIdeaSnapshot({
            projectId: req.params.id,
            version: nextVersion,
            snapshotType: "debate",
            title: `Debate Round ${rounds.length + 1}`,
            content: debateContent,
            metadata: {
              roundNumber: rounds.length + 1,
              userMessage: message,
              advocateInsights: advocateInsights || null,
              examinerChallenges: examinerChallenges || null
            }
          });
        }
      }
      const newRound = {
        id: `round-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        userMessage: message.trim(),
        agentsDebate,
        transcript,
        roundType,
        command: intent.command,
        qualityScore,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const updatedRounds = [...rounds, newRound];
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...currentData,
          // Preserve all existing fields
          ideaSummary,
          sessionId,
          rounds: updatedRounds,
          status: "active",
          webhookLog: [...currentData.webhookLog || [], {
            roundId: newRound.id,
            timestamp: newRound.createdAt,
            success: true,
            type: roundType
          }]
        }
      });
      res.json({
        success: true,
        round: newRound,
        roundType,
        conversation: { ideaSummary, rounds: updatedRounds }
      });
    } catch (error) {
      console.error("Add round error:", error);
      res.status(500).json({ message: "Failed to process message" });
    }
  });
  app2.post("/api/projects/:id/agent/1/finalize", isAuthenticated, async (req, res) => {
    try {
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const rounds = agent1Data?.data?.rounds || [];
      if (rounds.length === 0) {
        return res.status(400).json({
          message: "Cannot finalize: no brainstorming conversation found. Please start a conversation first."
        });
      }
      const ideaSummary = agent1Data?.data?.ideaSummary;
      const sessionId = agent1Data?.data?.sessionId;
      if (!ideaSummary) {
        return res.status(400).json({
          message: "Cannot finalize: idea summary is missing. Please restart the brainstorming session."
        });
      }
      if (!sessionId) {
        return res.status(400).json({
          message: "Session ID is missing. Cannot finalize brainstorming."
        });
      }
      const latestSnapshot = await storage.getLatestIdeaSnapshot(req.params.id);
      const currentIdea = latestSnapshot?.content || ideaSummary;
      const comprehensiveSummary = {
        ideaSummary,
        // Original idea
        currentIdea,
        // Refined idea (from Mechanic updates)
        sessionId,
        totalRounds: rounds.length,
        conversationDetails: rounds.map((round) => ({
          userMessage: round.userMessage,
          advocateInsights: round.agentsDebate?.filter((msg) => msg.speaker === "Advocate").map((msg) => msg.message) || [],
          examinerChallenges: round.agentsDebate?.filter((msg) => msg.speaker === "Examiner").map((msg) => msg.message) || [],
          mechanicUpdates: round.agentsDebate?.filter((msg) => msg.speaker === "Mechanic").map((msg) => msg.message) || [],
          transcript: round.transcript
        })),
        fullTranscript: rounds.map((r) => r.transcript).join("\n\n")
      };
      if (!agent1Data) {
        return res.status(400).json({ message: "Agent 1 data not found" });
      }
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...agent1Data.data,
          status: "finalized",
          finalizedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          comprehensiveSummary,
          status: "pending_draft",
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      await storage.updateProject(req.params.id, { currentStage: 2, currentSubstage: "2a" });
      res.json({
        success: true,
        message: "Brainstorming finalized. Moving to concept expansion."
      });
    } catch (error) {
      console.error("Finalize agent 1 error:", error);
      res.status(500).json({ message: error.message || "Failed to finalize brainstorming session" });
    }
  });
  app2.post("/api/projects/:id/agent/1/reanalyze", isAuthenticated, async (req, res) => {
    try {
      const { idea } = req.body;
      if (!idea || typeof idea !== "string" || !idea.trim()) {
        return res.status(400).json({ message: "Idea text is required" });
      }
      await clearDownstreamData(req.params.id, "1a-reanalyze");
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const existingData = agent1Data?.data;
      const mainIdea = existingData?.ideaSummary || "";
      const existingRounds = existingData?.rounds || [];
      let previousAdvocate = "";
      let previousExaminer = "";
      if (existingRounds.length > 0) {
        const lastRound = existingRounds[existingRounds.length - 1];
        const agentsDebate2 = lastRound.agentsDebate || [];
        for (const entry of agentsDebate2) {
          if (entry.speaker === "Advocate") {
            previousAdvocate = entry.message || "";
          } else if (entry.speaker === "Examiner") {
            previousExaminer = entry.message || "";
          }
        }
      }
      const sessionId = existingData?.sessionId || `session-${Date.now()}`;
      console.log("Re-analyzing idea through Advocate/Examiner (v2)...");
      const webhookResponse = await runReanalyze({
        mainIdea,
        previousAdvocate,
        previousExaminer,
        newIdea: idea.trim(),
        category: project.category || "software",
        projectId: req.params.id,
        sessionId
      });
      if (!webhookResponse.success) {
        return res.status(500).json({
          message: "Failed to re-analyze idea."
        });
      }
      const agentsDebate = webhookResponse.auditResults.map((result) => ({
        speaker: result.speaker,
        message: result.message
      }));
      const advocateMsg = agentsDebate.find((a) => a.speaker === "Advocate")?.message || "No response";
      const examinerMsg = agentsDebate.find((a) => a.speaker === "Examiner")?.message || "No response";
      const newRound = {
        id: `round-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        userMessage: idea.trim(),
        agentsDebate,
        transcript: `Re-analysis of improved idea:

${idea}

Advocate: ${advocateMsg}

Examiner: ${examinerMsg}`,
        roundType: "brainstorm",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const existingWebhookLog = agent1Data?.data?.webhookLog || [];
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...agent1Data?.data,
          ideaSummary: idea.trim(),
          sessionId,
          rounds: [...existingRounds, newRound],
          extractedIdeas: null,
          // Clear old extracted ideas
          webhookLog: [...existingWebhookLog, {
            roundId: newRound.id,
            timestamp: newRound.createdAt,
            success: true,
            type: newRound.roundType
          }]
        }
      });
      const existingSnapshots = await storage.getIdeaSnapshots(req.params.id);
      const nextVersion = existingSnapshots.length + 1;
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: nextVersion,
        snapshotType: "root",
        content: idea.trim(),
        metadata: { reanalysis: true, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      });
      res.json({
        success: true,
        message: "Idea re-analyzed successfully. View the new Advocate/Examiner analysis.",
        round: newRound
      });
    } catch (error) {
      console.error("Reanalyze idea error:", error);
      res.status(500).json({ message: "Failed to re-analyze idea" });
    }
  });
  function parseAuditDataServer(message) {
    if (!message) return null;
    try {
      let cleanedMessage = message.trim();
      if (cleanedMessage.includes("```")) {
        cleanedMessage = cleanedMessage.replace(/^```(?:json|javascript)?\s*/m, "").replace(/\s*```$/m, "");
      }
      const jsonMatch = cleanedMessage.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        cleanedMessage = jsonMatch[0];
      }
      const parsed = JSON.parse(cleanedMessage);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && item.audit_log && Array.isArray(item.audit_log)) {
            return item;
          }
        }
        if (parsed.length > 0 && parsed[0] && typeof parsed[0] === "object" && "status" in parsed[0]) {
          const validItems = parsed.filter((item) => item.status !== "DISMISSED");
          if (validItems.length > 0) {
            return { audit_log: validItems };
          }
          return null;
        }
        return null;
      }
      if (parsed && typeof parsed === "object" && parsed.audit_log && Array.isArray(parsed.audit_log)) {
        return parsed;
      }
      return null;
    } catch (e) {
      return null;
    }
  }
  const extractIdeasInProgress = /* @__PURE__ */ new Set();
  app2.post("/api/projects/:id/agent/1/extract-ideas", isAuthenticated, async (req, res) => {
    const projectId = req.params.id;
    if (extractIdeasInProgress.has(projectId)) {
      console.log(`Extract ideas already in progress for project ${projectId}, ignoring duplicate request`);
      return res.status(409).json({
        message: "Extraction already in progress. Please wait.",
        inProgress: true
      });
    }
    extractIdeasInProgress.add(projectId);
    try {
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const rounds = agent1Data?.data?.rounds || [];
      const existingExtractedIdeas = agent1Data?.data?.extractedIdeas || [];
      if (rounds.length === 0) {
        return res.status(400).json({
          message: "No brainstorming data found. Please complete Advocate/Examiner analysis first."
        });
      }
      const brainstormRounds = rounds.filter((r) => r.roundType !== "mechanic");
      const latestRound = brainstormRounds[brainstormRounds.length - 1];
      if (!latestRound?.agentsDebate) {
        return res.status(400).json({
          message: "No Advocate/Examiner analysis found."
        });
      }
      const isRound2Plus = brainstormRounds.length > 1 && existingExtractedIdeas.length > 0;
      if (isRound2Plus) {
        console.log("=== ROUND 2+ DETECTED - FILTERING BASED ON AUDIT ===");
        const needsWorkItems = [];
        const needsWorkDetailed = [];
        for (const agent of latestRound.agentsDebate) {
          const isAdvocate = agent.speaker === "Advocate";
          const auditData = parseAuditDataServer(agent.message);
          if (auditData?.audit_log) {
            for (const item of auditData.audit_log) {
              if (item.status === "YET TO FIX" || item.status === "NEEDS WORK") {
                const itemText = (item.item || item.point || item.original_point || item.original_praise || item.original_criticism || item.original_objection || "").trim();
                if (itemText) {
                  needsWorkItems.push(itemText.toLowerCase());
                  console.log(`Needs work item: ${itemText.substring(0, 80)}...`);
                  needsWorkDetailed.push({
                    original: itemText,
                    advocate: isAdvocate ? itemText : "",
                    examiner: !isAdvocate ? itemText : "",
                    reasoning: item.reasoning || ""
                  });
                }
              }
            }
          }
        }
        console.log(`Found ${needsWorkItems.length} items that need work`);
        const coreIdea = brainstormRounds[0]?.userMessage || "";
        let aiFixes = [];
        if (needsWorkDetailed.length > 0 && coreIdea) {
          console.log("=== ROUND 3: CALLING R3 FIXES (direct AI) ===");
          try {
            const r3Response = await runR3Fixes({
              coreIdea,
              needsWorkItems: needsWorkDetailed
            });
            if (r3Response.success && Array.isArray(r3Response.data)) {
              aiFixes = r3Response.data;
              console.log(`Got ${aiFixes.length} AI fixes from Round 3`);
            }
          } catch (err) {
            console.error("R3 fixes error:", err);
          }
        }
        const filteredIdeas = existingExtractedIdeas.map((idea, index) => {
          if (idea.status === "discarded") {
            return idea;
          }
          const ideaText = (idea.item || "").toLowerCase().trim();
          let matchingNeedsWorkIndex = -1;
          const matchesNeedsWork = needsWorkItems.some((nwItem, nwIndex) => {
            const matches = ideaText.includes(nwItem) || nwItem.includes(ideaText) || // Check for keyword overlap (at least 3 significant words match)
            (() => {
              const ideaWords = ideaText.split(/\s+/).filter((w) => w.length > 3);
              const nwWords = nwItem.split(/\s+/).filter((w) => w.length > 3);
              const matchedWords = ideaWords.filter((w) => nwWords.includes(w));
              return matchedWords.length >= 3;
            })();
            if (matches) {
              matchingNeedsWorkIndex = nwIndex;
            }
            return matches;
          });
          if (matchesNeedsWork) {
            const aiFix = aiFixes[matchingNeedsWorkIndex] || null;
            return {
              ...idea,
              status: "pending",
              needsWork: true,
              aiFix: aiFix?.ai_fix || aiFix?.fix || aiFix?.suggestion || aiFix?.revised || aiFix || null,
              aiFixReason: aiFix?.reason || aiFix?.reasoning || null
            };
          } else if (idea.status === "pending") {
            return {
              ...idea,
              status: "approved",
              autoApproved: true,
              autoApprovalReason: "Addressed in Round 2 improvements"
            };
          }
          return idea;
        });
        const pendingCount = filteredIdeas.filter((i) => i.status === "pending").length;
        const autoApprovedCount = filteredIdeas.filter((i) => i.autoApproved).length;
        console.log(`After filtering: ${pendingCount} pending, ${autoApprovedCount} auto-approved`);
        await storage.upsertAgentData({
          projectId: req.params.id,
          agentNumber: 1,
          data: {
            ...agent1Data?.data,
            extractedIdeas: filteredIdeas,
            extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
            round2Filtered: true,
            aiFixes,
            aiFixesGeneratedAt: aiFixes.length > 0 ? (/* @__PURE__ */ new Date()).toISOString() : null
          }
        });
        const ideasWithFixes = filteredIdeas.filter((i) => i.aiFix).length;
        console.log(`Ideas with AI fixes: ${ideasWithFixes}`);
        return res.json({
          success: true,
          ideas: filteredIdeas,
          round2Filtered: true,
          needsWorkCount: needsWorkItems.length,
          aiFixesCount: aiFixes.length
        });
      }
      const ideaSummary = agent1Data?.data?.ideaSummary || "";
      const allSnapshots = await storage.getIdeaSnapshots(req.params.id);
      const rootSnapshot = allSnapshots.find((s) => s.snapshotType === "root");
      const originalText = rootSnapshot?.content || ideaSummary;
      const advocateText = latestRound.agentsDebate.filter((a) => a.speaker === "Advocate").map((a) => a.message).join("\n\n");
      const examinerText = latestRound.agentsDebate.filter((a) => a.speaker === "Examiner").map((a) => a.message).join("\n\n");
      const sessionId = agent1Data?.data?.sessionId || `session-${Date.now()}`;
      console.log("=== LIST-CREATOR WEBHOOK PAYLOAD (Round 1) ===");
      console.log("Original text length:", originalText.length);
      console.log("Advocate text length:", advocateText.length);
      console.log("Examiner text length:", examinerText.length);
      console.log("Advocate preview:", advocateText.substring(0, 200));
      console.log("Examiner preview:", examinerText.substring(0, 200));
      const webhookResponse = await runListCreator({
        projectId: req.params.id,
        sessionId,
        original: originalText,
        goodCop: advocateText,
        // Internal: advocateText
        badCop: examinerText
        // Internal: examinerText
      });
      if (!webhookResponse.success) {
        return res.status(500).json({
          message: "Failed to extract ideas from AI.",
          error: webhookResponse.error
        });
      }
      let keptIdeas = [];
      let removedIdeas = [];
      const responseData = webhookResponse.data;
      if (Array.isArray(responseData) && responseData.length > 0 && responseData[0].kept) {
        keptIdeas = responseData[0].kept || [];
        removedIdeas = responseData[0].removed || [];
        console.log(`New format: ${keptIdeas.length} kept, ${removedIdeas.length} removed`);
      } else if (responseData?.kept) {
        keptIdeas = responseData.kept || [];
        removedIdeas = responseData.removed || [];
        console.log(`New format (unwrapped): ${keptIdeas.length} kept, ${removedIdeas.length} removed`);
      } else {
        const legacy = responseData;
        keptIdeas = legacy?.ideas || legacy?.items || legacy || [];
        console.log(`Old format: ${keptIdeas.length} ideas`);
      }
      const cleanItemText = (text2) => {
        if (!text2) return "";
        let cleaned = text2.split(/Advocate (Additions|Analysis):/i)[0];
        cleaned = cleaned.split(/Examiner (Challenges|Analysis):/i)[0];
        cleaned = cleaned.replace(/^Your Idea\s*/i, "");
        cleaned = cleaned.trim();
        if (cleaned.length > 500) {
          const firstPara = cleaned.split(/\n\n/)[0];
          cleaned = firstPara.length > 50 ? firstPara : cleaned.substring(0, 500) + "...";
        }
        return cleaned;
      };
      const pendingIdeas = (Array.isArray(keptIdeas) ? keptIdeas : []).map((idea, idx) => ({
        id: `idea-${Date.now()}-${idx}`,
        item: cleanItemText(idea.item || idea.label || idea.title || `Idea ${idx + 1}`),
        fromOriginal: idea.fromOriginal || idea.original || "Not mentioned",
        fromAdvocate: idea.fromGoodCop || idea.advocate || "Not mentioned",
        fromExaminer: idea.fromBadCop || idea.examiner || "Not mentioned",
        status: "pending"
      }));
      const autoApprovedIdeas = (Array.isArray(removedIdeas) ? removedIdeas : []).map((idea, idx) => ({
        id: `idea-auto-${Date.now()}-${idx}`,
        item: cleanItemText(idea.item || idea.label || idea.title || `Idea ${idx + 1}`),
        fromOriginal: idea.fromOriginal || idea.original || "Not mentioned",
        fromAdvocate: idea.fromGoodCop || idea.advocate || "Not mentioned",
        fromExaminer: idea.fromBadCop || idea.examiner || "Not mentioned",
        status: "approved",
        autoApproved: true,
        autoApprovalReason: idea.reason || "All sources agree or no unique insights"
      }));
      const unifiedIdeas = [...autoApprovedIdeas, ...pendingIdeas];
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...agent1Data?.data,
          extractedIdeas: unifiedIdeas,
          extractedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      res.json({
        success: true,
        ideas: unifiedIdeas
      });
    } catch (error) {
      console.error("Extract ideas error:", error);
      res.status(500).json({ message: "Failed to extract ideas" });
    } finally {
      extractIdeasInProgress.delete(projectId);
    }
  });
  app2.get("/api/projects/:id/agent/1/extracted-ideas", isAuthenticated, async (req, res) => {
    try {
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const extractedIdeas = agent1Data?.data?.extractedIdeas || [];
      res.json({ ideas: extractedIdeas });
    } catch (error) {
      console.error("Get extracted ideas error:", error);
      res.status(500).json({ message: "Failed to get extracted ideas" });
    }
  });
  app2.patch("/api/projects/:id/agent/1/ideas/:ideaId", isAuthenticated, async (req, res) => {
    try {
      const { ideaId } = req.params;
      const updates = req.body;
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const extractedIdeas = agent1Data?.data?.extractedIdeas || [];
      const updatedIdeas = extractedIdeas.map((idea) => {
        if (idea.id === ideaId) {
          return { ...idea, ...updates };
        }
        return idea;
      });
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...agent1Data?.data,
          extractedIdeas: updatedIdeas
        }
      });
      res.json({ success: true, idea: updatedIdeas.find((i) => i.id === ideaId) });
    } catch (error) {
      console.error("Update idea error:", error);
      res.status(500).json({ message: "Failed to update idea" });
    }
  });
  app2.post("/api/projects/:id/agent/1/ideas", isAuthenticated, async (req, res) => {
    try {
      const { item } = req.body;
      if (!item || !item.trim()) {
        return res.status(400).json({ message: "Idea content is required" });
      }
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const extractedIdeas = agent1Data?.data?.extractedIdeas || [];
      const newIdea = {
        id: `idea-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        item: item.trim(),
        fromOriginal: "User added this idea manually",
        fromGoodCop: "",
        fromBadCop: "",
        status: "pending"
      };
      const updatedIdeas = [...extractedIdeas, newIdea];
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...agent1Data?.data,
          extractedIdeas: updatedIdeas
        }
      });
      res.json({ success: true, idea: newIdea });
    } catch (error) {
      console.error("Add idea error:", error);
      res.status(500).json({ message: "Failed to add idea" });
    }
  });
  app2.post("/api/projects/:id/agent/1/ask-ai-modifier", isAuthenticated, async (req, res) => {
    try {
      const { ideaId, item, fromOriginal, fromGoodCop, fromBadCop, originalUserPrompt } = req.body;
      if (!ideaId || !item) {
        return res.status(400).json({ message: "Idea ID and item are required" });
      }
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const sessionId = agent1Data?.data?.sessionId || `session-${Date.now()}`;
      const mainIdea = agent1Data?.data?.ideaSummary || originalUserPrompt || "";
      const originalIdeaContent = [
        fromOriginal && fromOriginal !== "Not mentioned." ? `From Original: ${fromOriginal}` : null,
        fromGoodCop && fromGoodCop !== "Not mentioned." ? `From Advocate: ${fromGoodCop}` : null
      ].filter(Boolean).join("\n\n");
      const webhookResponse = await runAiModifier({
        projectId: req.params.id,
        sessionId,
        mainIdea,
        item,
        fromOriginal: originalIdeaContent || fromOriginal,
        fromGoodCop,
        fromBadCop
      });
      if (!webhookResponse.success) {
        return res.status(500).json({
          message: "Failed to get AI suggestion.",
          error: webhookResponse.error
        });
      }
      let improvedIdea = "";
      let improvementsMade = "";
      const data = webhookResponse.data;
      if (Array.isArray(data) && data[0]?.json) {
        improvedIdea = data[0].json.improvedIdea || "";
        improvementsMade = data[0].json.improvementsMade || "";
      } else if (data?.improvedIdea) {
        improvedIdea = data.improvedIdea || "";
        improvementsMade = data.improvementsMade || "";
      } else {
        const legacy = data;
        const suggestion = legacy?.suggestion || legacy?.recommendation || legacy?.response || legacy;
        improvedIdea = typeof suggestion === "string" ? suggestion : JSON.stringify(suggestion);
      }
      const extractedIdeas = agent1Data?.data?.extractedIdeas || [];
      const updatedIdeas = extractedIdeas.map((idea) => {
        if (idea.id === ideaId) {
          return { ...idea, improvedIdea, improvementsMade };
        }
        return idea;
      });
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...agent1Data?.data,
          extractedIdeas: updatedIdeas
        }
      });
      res.json({
        success: true,
        ideaId,
        improvedIdea,
        improvementsMade
      });
    } catch (error) {
      console.error("Ask AI modifier error:", error);
      res.status(500).json({ message: "Failed to get AI suggestion" });
    }
  });
  app2.post("/api/projects/:id/agent/1/save-refined-ideas", isAuthenticated, async (req, res) => {
    try {
      const { ideas } = req.body;
      if (!ideas || !Array.isArray(ideas) || ideas.length === 0) {
        return res.status(400).json({ message: "At least one approved idea is required" });
      }
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const ideaSummary = agent1Data?.data?.ideaSummary;
      const sessionId = agent1Data?.data?.sessionId;
      const refinedContent = ideas.map((idea) => {
        const content = idea.editedContent || idea.item;
        return `- ${content}`;
      }).join("\n");
      const nextVersion = await storage.getNextSnapshotVersion(req.params.id);
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: nextVersion,
        snapshotType: "refined_ideas",
        title: "Refined Ideas from Inspection",
        content: refinedContent,
        metadata: {
          approvedCount: ideas.length,
          ideas
        }
      });
      const latestSnapshot = await storage.getLatestIdeaSnapshot(req.params.id);
      const currentIdea = latestSnapshot?.content || ideaSummary;
      const comprehensiveSummary = {
        ideaSummary,
        currentIdea,
        refinedIdeas: ideas,
        sessionId,
        totalRounds: (agent1Data?.data?.rounds || []).length
      };
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...agent1Data?.data,
          refinedIdeas: ideas,
          status: "finalized",
          finalizedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          comprehensiveSummary,
          status: "pending_draft",
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      await storage.updateProject(req.params.id, { currentStage: 2, currentSubstage: "2a" });
      res.json({
        success: true,
        message: "Ideas saved. Moving to concept expansion."
      });
    } catch (error) {
      console.error("Save refined ideas error:", error);
      res.status(500).json({ message: "Failed to save refined ideas" });
    }
  });
  app2.post("/api/projects/:id/agent/2", isAuthenticated, async (req, res) => {
    try {
      const existingData = await storage.getAgentData(req.params.id, 2);
      const savedData = await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: { ...existingData?.data || {}, ...req.body }
      });
      res.json(savedData);
    } catch (error) {
      console.error("Save agent 2 data error:", error);
      res.status(500).json({ message: "Failed to save data" });
    }
  });
  app2.post("/api/projects/:id/agent/2/draft", isAuthenticated, async (req, res) => {
    try {
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      if (!agent2Data?.data) {
        return res.status(400).json({
          message: "Agent 2 data not found. Please complete Agent 1 first."
        });
      }
      const comprehensiveSummary = agent2Data.data.comprehensiveSummary;
      if (!comprehensiveSummary) {
        return res.status(400).json({
          message: "Comprehensive summary not found. Please finalize Agent 1 brainstorming first."
        });
      }
      if (!comprehensiveSummary.ideaSummary || !comprehensiveSummary.sessionId) {
        return res.status(400).json({
          message: "Invalid summary data. Missing idea summary or session ID."
        });
      }
      const additionalNotes = req.body.additionalNotes || agent2Data.data.additionalNotes || "";
      const refinementFeedback = req.body.refinementFeedback || "";
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...agent2Data.data,
          additionalNotes,
          refinementFeedback
        }
      });
      const allAdvocateInsights = comprehensiveSummary.conversationDetails?.flatMap((round) => round.advocateInsights || []) || [];
      const allExaminerChallenges = comprehensiveSummary.conversationDetails?.flatMap((round) => round.examinerChallenges || []) || [];
      const webhookPayload = {
        sessionId: comprehensiveSummary.sessionId,
        ideaSummary: comprehensiveSummary.ideaSummary,
        goodCopInsights: allAdvocateInsights,
        // Internal: advocateInsights
        badCopChallenges: allExaminerChallenges,
        // Internal: examinerChallenges
        fullTranscript: comprehensiveSummary.fullTranscript,
        additionalNotes: additionalNotes || "",
        refinementFeedback: refinementFeedback || "",
        category: comprehensiveSummary.category || "Software"
      };
      const isRefinement = !!refinementFeedback;
      console.log(isRefinement ? "Regenerating draft with refinement feedback" : "Generating initial provisional draft");
      console.log("Calling Module 2 draft agent to generate provisional draft...");
      const draftResponse = await runDraft(webhookPayload);
      if (!draftResponse.success) {
        return res.status(503).json({
          message: `Failed to generate draft: ${draftResponse.error}. Please try again.`
        });
      }
      const result = {
        provisionalDraft: draftResponse.provisionalDraft,
        patentableIdeas: draftResponse.provisionalDraft
      };
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...agent2Data.data,
          provisionalDraft: result.patentableIdeas || result.draftSpecification || result.provisionalDraft,
          status: "draft_complete",
          draftedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      const draftContent = result.patentableIdeas || result.draftSpecification || result.provisionalDraft;
      const nextVersion = await storage.getNextSnapshotVersion(req.params.id);
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: nextVersion,
        snapshotType: "2a_concept_expansion",
        title: "Concept Expanded",
        content: typeof draftContent === "string" ? draftContent : `**Expanded Concept**

${JSON.stringify(draftContent, null, 2)}`,
        metadata: {
          stage: 2,
          substage: "2a",
          draftedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      res.json({
        success: true,
        provisionalDraft: result.patentableIdeas || result.draftSpecification || result.provisionalDraft
      });
    } catch (error) {
      console.error("Draft generation error:", error);
      res.status(500).json({ message: "An unexpected error occurred. Please try again." });
    }
  });
  app2.post("/api/projects/:id/agent/2/extract-ideas", isAuthenticated, async (req, res) => {
    try {
      await clearDownstreamData(req.params.id, "2b");
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      console.log("Agent 2 data keys:", agent2Data?.data ? Object.keys(agent2Data.data) : "no data");
      const provisionalDraft = agent2Data?.data?.provisionalDraft || agent2Data?.data?.patentableIdeas;
      if (!agent2Data?.data || !provisionalDraft) {
        console.log("No draft found. Available fields:", Object.keys(agent2Data?.data || {}));
        return res.status(400).json({
          message: "Provisional draft not found. Please generate the draft first."
        });
      }
      const comprehensiveSummary = agent2Data.data.comprehensiveSummary;
      const project = await storage.getProject(req.params.id);
      let codeFromTheUser = "";
      const sourceCodeFiles = project?.sourceCodeFiles || [];
      if (sourceCodeFiles.length > 0) {
        codeFromTheUser = sourceCodeFiles.map((file, index) => {
          const fileName = file.fileName || `Code File ${index + 1}`;
          const description = file.description || "No description provided";
          return `=== ${fileName} ===
Description: ${description}

Code:
${file.code}`;
        }).join("\n\n---\n\n");
      }
      console.log("Calling Module 2/2b extract-concepts agent...");
      const extractResult = await runExtractConcepts({
        sessionId: comprehensiveSummary?.sessionId,
        detailedConcept: provisionalDraft,
        codeFromTheUser: codeFromTheUser || void 0,
        category: comprehensiveSummary?.category || "Software"
      });
      if (!extractResult.success) {
        return res.status(503).json({ message: extractResult.error });
      }
      const ideas = extractResult.ideas.map((text2, index) => ({
        id: `concept-${index + 1}-${Date.now()}`,
        text: text2
      }));
      console.log(`Extracted ${ideas.length} patentable concepts`);
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...agent2Data.data,
          extractedIdeas: ideas,
          status: "ideas_extracted",
          ideasExtractedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      await storage.updateProject(req.params.id, {
        currentStage: 2,
        currentSubstage: "2b"
      });
      res.json({
        success: true,
        ideas
      });
    } catch (error) {
      console.error("Extract ideas error:", error);
      res.status(500).json({ message: error.message || "Failed to extract ideas. Please try again." });
    }
  });
  app2.post("/api/projects/:id/agent/2/add-custom-idea", isAuthenticated, async (req, res) => {
    try {
      const { text: text2 } = req.body;
      if (!text2 || !text2.trim()) {
        return res.status(400).json({ message: "Idea text is required" });
      }
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      if (!agent2Data?.data) {
        return res.status(400).json({ message: "Agent 2 data not found. Please extract ideas first." });
      }
      const extractedIdeas = agent2Data.data.extractedIdeas || [];
      const customIdea = {
        id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: text2.trim(),
        isCustom: true
        // Flag to identify manually added ideas
      };
      const updatedIdeas = [...extractedIdeas, customIdea];
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...agent2Data.data,
          extractedIdeas: updatedIdeas
        }
      });
      res.json({
        success: true,
        idea: customIdea
      });
    } catch (error) {
      console.error("Add custom idea error:", error);
      res.status(500).json({ message: error.message || "Failed to add idea" });
    }
  });
  app2.post("/api/projects/:id/agent/2/proceed", isAuthenticated, async (req, res) => {
    try {
      const { selectedIdeaIds } = req.body;
      if (!selectedIdeaIds || !Array.isArray(selectedIdeaIds) || selectedIdeaIds.length === 0) {
        return res.status(400).json({ message: "Please select at least one idea to proceed." });
      }
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      if (!agent2Data?.data) {
        return res.status(400).json({ message: "Agent 2 data not found" });
      }
      const extractedIdeas = agent2Data.data.extractedIdeas || [];
      const updatedIdeas = extractedIdeas.map((idea) => ({
        ...idea,
        selected: selectedIdeaIds.includes(idea.id)
      }));
      const selectedIdeas = updatedIdeas.filter((idea) => idea.selected);
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...agent2Data.data,
          extractedIdeas: updatedIdeas,
          status: "ideas_approved"
        }
      });
      const comprehensiveSummary = agent2Data.data.comprehensiveSummary;
      console.log("Starting prior art search...");
      const webhookUrl = N8N_MULTI_CONCEPT_SEARCH_WEBHOOK;
      const webhookPayload = {
        sessionId: comprehensiveSummary?.sessionId,
        category: comprehensiveSummary?.category || "Software",
        concepts: selectedIdeas.map((idea) => ({
          id: idea.id,
          concept: idea.text || idea.title || idea.description || "Untitled Concept"
        }))
      };
      console.log("Prior art webhook payload:", JSON.stringify(webhookPayload, null, 2));
      const result = await sendWebhook(webhookUrl, webhookPayload);
      console.log("Prior art search complete:", JSON.stringify(result).substring(0, 200));
      const rawResults = Array.isArray(result) ? result[0] : result;
      const conceptResults = rawResults?.results || {};
      const priorArtResults = selectedIdeas.map((idea) => {
        const conceptText = idea.text || idea.title || idea.description;
        const patents = conceptResults[conceptText] || [];
        return {
          conceptId: idea.id,
          conceptTitle: conceptText,
          priorArt: patents.map((patent) => ({
            title: patent.title || "",
            url: patent.patent_url || "",
            relevanceScore: parseFloat(patent.distance_score) || 0,
            summary: patent.abstract || "",
            publicationDate: patent.publication_number || "",
            publicationNumber: patent.publication_number || "",
            rank: patent.rank || 0
          }))
        };
      });
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 3,
        data: {
          selectedIdeas,
          status: "search_complete",
          priorArtResults,
          searchMetadata: {
            timestamp: rawResults?.timestamp,
            totalConcepts: rawResults?.total_concepts,
            totalPatents: rawResults?.total_patents,
            searchedAt: (/* @__PURE__ */ new Date()).toISOString()
          },
          searchedAt: (/* @__PURE__ */ new Date()).toISOString(),
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      await storage.updateProject(req.params.id, { currentStage: 3 });
      res.json({
        success: true,
        selectedCount: selectedIdeas.length,
        priorArtResults: result.priorArtResults || []
      });
    } catch (error) {
      console.error("Proceed to Agent 3 error:", error);
      res.status(500).json({ message: error.message || "Failed to proceed to prior art research" });
    }
  });
  app2.post("/api/projects/:id/substage/proceed", isAuthenticated, async (req, res) => {
    try {
      const { substage } = req.body;
      if (!substage) {
        return res.status(400).json({ message: "Substage is required" });
      }
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const currentSubstage = project.currentSubstage || "";
      if (currentSubstage === substage) {
        return res.json({ success: true, substage, alreadyAtSubstage: true });
      }
      const validTransitions = {
        "2a": ["2b"],
        "2b": [],
        // Goes to Agent 3 via /agent/2/proceed
        "4a": ["4b"],
        "4b": ["4c"],
        "4c": []
        // Goes to Agent 5 via /agent/4/proceed
      };
      const allowedNext = validTransitions[currentSubstage] || [];
      if (!allowedNext.includes(substage)) {
        return res.status(400).json({
          message: `Invalid substage progression. Cannot move from ${currentSubstage} to ${substage}. Expected one of: ${allowedNext.join(", ") || "none"}`
        });
      }
      await storage.updateProject(req.params.id, { currentSubstage: substage });
      res.json({ success: true, substage });
    } catch (error) {
      console.error("Substage proceed error:", error);
      res.status(500).json({ message: error.message || "Failed to proceed to next substage" });
    }
  });
  app2.post("/api/projects/:id/agent/2/submit", isAuthenticated, async (req, res) => {
    try {
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      if (!agent1Data?.data) {
        return res.status(400).json({ message: "Agent 1 data not found" });
      }
      const { ideaSummary, rounds } = agent1Data.data;
      const advocateMessages = [];
      const examinerMessages = [];
      if (rounds && Array.isArray(rounds)) {
        rounds.forEach((round) => {
          if (round.agentsDebate && Array.isArray(round.agentsDebate)) {
            round.agentsDebate.forEach((msg) => {
              if (msg.speaker === "Advocate") {
                advocateMessages.push(msg.message);
              } else if (msg.speaker === "Examiner") {
                examinerMessages.push(msg.message);
              }
            });
          }
        });
      }
      const advocateAnalysis = advocateMessages.join("\n\n");
      const examinerAnalysis = examinerMessages.join("\n\n");
      const webhookPayload = {
        idea: ideaSummary,
        goodCopAnalysis: advocateAnalysis,
        // Internal: advocateAnalysis
        badCopAnalysis: examinerAnalysis
        // Internal: examinerAnalysis
      };
      console.log("Calling Agent 2 webhook with payload:", webhookPayload);
      const webhookData = await sendWebhook(N8N_DRAFT_PROVISIONAL_WEBHOOK, webhookPayload);
      console.log("Agent 2 webhook response:", webhookData);
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          draftSpecification: webhookData.draftSpecification || webhookData.draft || "Processing...",
          firstPassPriorArt: webhookData.firstPassPriorArt || webhookData.priorArt || [],
          webhookResponse: webhookData,
          processedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      await storage.updateProject(req.params.id, { currentStage: 3 });
      res.json({ success: true, data: webhookData });
    } catch (error) {
      console.error("Submit agent 2 error:", error);
      res.status(500).json({ message: error.message || "Failed to process submission" });
    }
  });
  app2.post("/api/projects/:id/agent/3/search", isAuthenticated, async (req, res) => {
    try {
      await clearDownstreamData(req.params.id, "3");
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      if (!agent2Data?.data) {
        return res.status(400).json({ message: "No Agent 2 data found" });
      }
      const agent2DataObj = agent2Data.data;
      const selectedIdeas = agent2DataObj.extractedIdeas?.filter((idea) => idea.selected) || [];
      if (selectedIdeas.length === 0) {
        return res.status(400).json({ message: "No ideas selected for prior art research" });
      }
      const comprehensiveSummary = agent2DataObj.comprehensiveSummary;
      const webhookUrl = N8N_MULTI_CONCEPT_SEARCH_WEBHOOK;
      const webhookPayload = {
        sessionId: comprehensiveSummary?.sessionId,
        category: comprehensiveSummary?.category || "Software",
        concepts: selectedIdeas.map((idea) => ({
          id: idea.id,
          concept: idea.text || idea.title || idea.description || "Untitled Concept"
        }))
      };
      console.log("Calling prior art search webhook...");
      console.log("Payload:", JSON.stringify(webhookPayload, null, 2));
      const result = await sendWebhook(webhookUrl, webhookPayload);
      console.log("Prior art search response received:", JSON.stringify(result).substring(0, 200));
      const rawResults = Array.isArray(result) ? result[0] : result;
      const conceptResults = rawResults?.results || {};
      const priorArtResults = selectedIdeas.map((idea) => {
        const conceptText = idea.text || idea.title || idea.description;
        const patents = conceptResults[conceptText] || [];
        return {
          conceptId: idea.id,
          conceptTitle: conceptText,
          priorArt: patents.map((patent) => ({
            title: patent.title || "",
            url: patent.patent_url || "",
            relevanceScore: parseFloat(patent.distance_score) || 0,
            summary: patent.abstract || "",
            publicationDate: patent.publication_number || "",
            publicationNumber: patent.publication_number || "",
            rank: patent.rank || 0
          }))
        };
      });
      const selectedIdeasVersion = await storage.getNextSnapshotVersion(req.params.id);
      const selectedIdeasContent = selectedIdeas.map(
        (idea, i) => `${i + 1}. **${idea.text || idea.title || "Untitled"}**`
      ).join("\n");
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: selectedIdeasVersion,
        snapshotType: "2b_selected_ideas",
        title: `${selectedIdeas.length} Ideas Selected`,
        content: `**Selected Ideas for Patent Protection:**

${selectedIdeasContent}`,
        metadata: {
          stage: 2,
          substage: "2b",
          selectedCount: selectedIdeas.length,
          selectedIds: selectedIdeas.map((i) => i.id)
        }
      });
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 3,
        data: {
          status: "search_complete",
          priorArtResults,
          searchMetadata: {
            timestamp: rawResults?.timestamp,
            totalConcepts: rawResults?.total_concepts,
            totalPatents: rawResults?.total_patents,
            searchedAt: (/* @__PURE__ */ new Date()).toISOString()
          },
          searchedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      const priorArtVersion = await storage.getNextSnapshotVersion(req.params.id);
      const totalPatentsFound = priorArtResults.reduce((sum, r) => sum + (r.priorArt?.length || 0), 0);
      const priorArtContent = priorArtResults.map((result2) => {
        const patentCount = result2.priorArt?.length || 0;
        return `**${result2.conceptTitle}**: ${patentCount} prior art references found`;
      }).join("\n");
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: priorArtVersion,
        snapshotType: "3_prior_art",
        title: `Prior Art Research Complete`,
        content: `**Prior Art Analysis:**

${priorArtContent}

_Total: ${totalPatentsFound} patents analyzed across ${priorArtResults.length} concepts_`,
        metadata: {
          stage: 3,
          totalPatents: totalPatentsFound,
          conceptCount: priorArtResults.length,
          priorArtResults: priorArtResults.map((r) => ({
            conceptId: r.conceptId,
            conceptTitle: r.conceptTitle,
            patentCount: r.priorArt?.length || 0
          }))
        }
      });
      res.json({
        success: true,
        results: priorArtResults
      });
    } catch (error) {
      console.error("Prior art search error:", error);
      res.status(500).json({ message: error.message || "Failed to search prior art. Please try again." });
    }
  });
  app2.post("/api/projects/:id/agent/3", isAuthenticated, async (req, res) => {
    try {
      const existingData = await storage.getAgentData(req.params.id, 3);
      const savedData = await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 3,
        data: { ...existingData?.data || {}, ...req.body }
      });
      res.json(savedData);
    } catch (error) {
      console.error("Save agent 3 data error:", error);
      res.status(500).json({ message: "Failed to save data" });
    }
  });
  app2.post("/api/projects/:id/agent/3/submit", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const sessionId = agent1Data?.data?.sessionId || req.params.id;
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent2DataObj = agent2Data?.data;
      const expandedConcept = agent2DataObj?.provisionalDraft || agent2DataObj?.draftSpecification || "";
      const selectedIdeas = (agent2DataObj?.extractedIdeas || []).filter((idea) => idea.selected).map((idea) => ({
        id: idea.id,
        text: idea.text
      }));
      const agent3Data = await storage.getAgentData(req.params.id, 3);
      const priorArtResults = agent3Data?.data?.priorArtResults || [];
      const webhookPayload = {
        sessionId,
        category: project.category,
        expandedConcept,
        selectedIdeas,
        priorArtResults: priorArtResults.map((result) => ({
          conceptId: result.conceptId,
          conceptTitle: result.conceptTitle,
          priorArt: result.priorArt || []
        }))
      };
      console.log("Calling Module 4/4a whitespace agent...");
      const whitespaceResult = await runWhitespace(webhookPayload);
      if (!whitespaceResult.success) {
        return res.status(503).json({ message: whitespaceResult.error });
      }
      const webhookResponse = whitespaceResult;
      console.log("White space analysis response:", webhookResponse);
      const enrichedConceptAnalyses = (webhookResponse.conceptAnalyses || []).map((concept, index) => {
        const matchingPriorArt = priorArtResults[index];
        return {
          ...concept,
          conceptTitle: concept.conceptTitle || matchingPriorArt?.conceptTitle || ""
        };
      });
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          status: "analysis_complete",
          ...webhookResponse,
          conceptAnalyses: enrichedConceptAnalyses.length > 0 ? enrichedConceptAnalyses : void 0,
          analyzedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      const whiteSpaceVersion = await storage.getNextSnapshotVersion(req.params.id);
      const whiteSpaceContent = enrichedConceptAnalyses.map((concept, idx) => {
        const patentCount = concept.patentAnalyses?.length || 0;
        return `**Concept ${idx + 1}: ${concept.conceptTitle || "Untitled"}**
- Risk Level: ${concept.overallRiskLevel || "Unknown"}
- Patents Analyzed: ${patentCount}`;
      }).join("\n\n");
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: whiteSpaceVersion,
        snapshotType: "4a_white_space",
        title: "White Space Analysis Complete",
        content: `**Strategic Direction:**
${webhookResponse?.strategicDirective || "Analysis complete"}

**Concept Analysis:**

${whiteSpaceContent}`,
        metadata: {
          stage: 4,
          substage: "4a",
          conceptCount: enrichedConceptAnalyses.length,
          strategicDirective: webhookResponse?.strategicDirective
        }
      });
      await storage.updateProject(req.params.id, { currentStage: 4, currentSubstage: "4a" });
      res.json({ success: true, results: webhookResponse });
    } catch (error) {
      console.error("White space analysis error:", error);
      res.status(500).json({ message: error.message || "Failed to complete white space analysis. Please try again." });
    }
  });
  app2.post("/api/projects/:id/agent/4b/generate-claims", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const agent1DataObj = agent1Data?.data;
      const sessionId = agent1DataObj?.sessionId || req.params.id;
      const mainIdea = agent1DataObj?.ideaSummary || "";
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent2DataObj = agent2Data?.data;
      const expandedConcept = agent2DataObj?.provisionalDraft || agent2DataObj?.draftSpecification || "";
      const selectedIdeas = (agent2DataObj?.extractedIdeas || []).filter((idea) => idea.selected).map((idea) => ({
        id: idea.id,
        text: idea.text
      }));
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent4DataObj = agent4Data?.data;
      const analysisResults = Array.isArray(agent4DataObj) ? agent4DataObj[0] : agent4DataObj || {};
      const webhookPayload = {
        sessionId,
        category: project.category,
        mainIdea,
        expandedConcept,
        selectedIdeas,
        whiteSpaceAnalysis: {
          strategicDirective: analysisResults.strategicDirective || "",
          nuggetAnalyses: analysisResults.nuggetAnalyses || []
        }
      };
      console.log("Calling Module 4/4b claims agent...");
      const claimsResult = await runClaims(webhookPayload);
      if (!claimsResult.success) {
        return res.status(503).json({ message: claimsResult.error });
      }
      const webhookResponse = { data: claimsResult.data };
      let claimVariations = claimsResult.data;
      const parseRawOutput = (rawOutput) => {
        if (!rawOutput) return null;
        try {
          const cleaned = rawOutput.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          return JSON.parse(cleaned);
        } catch (e) {
        }
        try {
          const text2 = rawOutput.trim();
          const conceptMatch = text2.match(/(?:\*\*)?Inventive Concept[^)]*\)?(?:\*\*)?\s*\n+([\s\S]*?)(?=\n\s*(?:\*\*)?(?:Exemplary Claim|Claim\s*\d))/i);
          const inventiveConcept = conceptMatch ? conceptMatch[1].trim() : "";
          const claimPattern = /(?:\*\*)?Claim\s*(\d+)\s*\(([^)]+)\)(?:\*\*)?\s*\n+([\s\S]*?)(?=(?:\n\s*(?:\*\*)?Claim\s*\d)|(?:\n\s*Claims?\s*\d+-?\d*\s*\()|$)/gi;
          const claims = [];
          let match;
          while ((match = claimPattern.exec(text2)) !== null) {
            const claimNumber = parseInt(match[1]);
            const claimType = match[2].toLowerCase();
            const claimText = match[3].trim();
            const isIndependent = claimType.includes("independent");
            const isDependent = claimType.includes("dependent");
            claims.push({
              number: claimNumber,
              type: isIndependent ? "independent" : "dependent",
              label: `Claim ${claimNumber} (${match[2].trim()})`,
              text: claimText,
              claimType: isIndependent ? "independent" : "dependent"
            });
          }
          const independentClaims = claims.filter((c) => c.type === "independent");
          const dependentClaims = claims.filter((c) => c.type === "dependent");
          if (claims.length > 0) {
            return {
              inventive_concept: inventiveConcept,
              independent_claim: independentClaims[0]?.text || "",
              dependent_claims: dependentClaims.map((c) => c.text),
              claims,
              claims_count: claims.length,
              statutory_class: independentClaims[0]?.label?.match(/System|Method|Medium/i)?.[0] || "System"
            };
          }
          return null;
        } catch (e) {
          console.error("Failed to parse text claims format:", e);
          return null;
        }
      };
      const normalizedVariations = claimVariations.map((variation) => {
        if (variation.raw_output && !variation.independent_claim && !variation.claims) {
          const parsed = parseRawOutput(variation.raw_output);
          if (parsed) {
            return { ...variation, ...parsed };
          }
        }
        return variation;
      }).filter((v) => {
        const hasValidClaims = v && (v.claims && v.claims.length > 0 || (v.independent_claim || v.independentClaim));
        return hasValidClaims;
      }).map((variation, index) => {
        console.log(`Processing variation ${index}:`, {
          hasClaims: !!variation.claims,
          claimsCount: variation.claims?.length,
          hasInventiveConcept: !!variation.inventive_concept,
          claimType: variation.claim_type
        });
        const allClaims = variation.claims || [];
        let independentClaimText = "";
        const independentClaimObj = allClaims.find((c) => c.type === "independent");
        if (independentClaimObj?.text) {
          independentClaimText = independentClaimObj.text;
        } else {
          independentClaimText = variation.independent_claim || variation.independentClaim || "";
        }
        let dependentClaimsArray = [];
        const dependentClaimObjs = allClaims.filter((c) => c.type === "dependent");
        if (dependentClaimObjs.length > 0) {
          dependentClaimsArray = dependentClaimObjs.sort((a, b) => (a.number || 0) - (b.number || 0)).map((c) => c.text);
        } else {
          const rawDependentClaims = variation.dependent_claims || variation.dependentClaims || [];
          dependentClaimsArray = rawDependentClaims.map((claim) => {
            if (typeof claim === "string") return claim;
            if (typeof claim === "object" && claim.text) return claim.text;
            return String(claim);
          });
        }
        const statutoryClass = variation.claim_type || variation.statutory_class || variation.statutoryClass || independentClaimObj?.claimType || "system";
        return {
          id: `variation-${index}`,
          index,
          inventiveConcept: variation.inventive_concept || variation.inventiveConcept || "",
          statutoryClass: statutoryClass.charAt(0).toUpperCase() + statutoryClass.slice(1),
          // Capitalize
          strategySummary: variation.strategy_summary || variation.strategySummary || variation.inventive_concept || "",
          claimsCount: variation.claims_count || variation.claimsCount || allClaims.length || 0,
          independentClaim: independentClaimText,
          dependentClaims: dependentClaimsArray,
          claims: allClaims,
          // Include full claims array with all metadata
          claimType: variation.claim_type || "system",
          // Preserve claim type (system/method)
          dependencyTree: variation.dependency_tree || null,
          // Preserve dependency tree
          timestamp: variation.timestamp || (/* @__PURE__ */ new Date()).toISOString()
        };
      });
      const existingData = agent4Data?.data || {};
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          ...existingData,
          status: "claims_generated",
          claimVariations: normalizedVariations,
          selectedVariationId: null,
          // User hasn't selected yet
          selectedClaims: null,
          // Clear old selections - user must re-select from new claims
          editedClaims: null,
          // No edits yet
          rawClaimsResponse: webhookResponse,
          // Keep raw response for debugging
          claimsGeneratedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      res.json({
        success: true,
        variationsCount: normalizedVariations.length,
        variations: normalizedVariations
      });
    } catch (error) {
      console.error("Claims generation error:", error);
      res.status(500).json({ message: error.message || "Failed to generate claims. Please try again." });
    }
  });
  app2.post("/api/projects/:id/agent/4b/select-claims", isAuthenticated, async (req, res) => {
    try {
      const { selectedClaims } = req.body;
      if (!selectedClaims || !Array.isArray(selectedClaims)) {
        return res.status(400).json({ message: "Selected claims array is required" });
      }
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const existingData = agent4Data?.data || {};
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          ...existingData,
          selectedClaims,
          // Array of individual claims chosen by user
          claimsSelectedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      const claimsVersion = await storage.getNextSnapshotVersion(req.params.id);
      const independentClaims = selectedClaims.filter(
        (c) => c.type === "independent" || c.claimType === "independent" || c.label?.includes("Independent")
      );
      const dependentClaims = selectedClaims.filter(
        (c) => c.type === "dependent" || c.claimType === "dependent" || c.label?.includes("Dependent")
      );
      const claimsContent = `**Patent Claims Selected:**

**Independent Claims (${independentClaims.length}):**
${independentClaims.map((c, i) => `${i + 1}. ${c.text?.substring(0, 150)}...`).join("\n")}

**Dependent Claims (${dependentClaims.length}):**
${dependentClaims.map((c, i) => `${i + 1}. ${c.text?.substring(0, 100)}...`).join("\n")}`;
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: claimsVersion,
        snapshotType: "4b_claims",
        title: `${selectedClaims.length} Claims Selected`,
        content: claimsContent,
        metadata: {
          stage: 4,
          substage: "4b",
          totalClaims: selectedClaims.length,
          independentCount: independentClaims.length,
          dependentCount: dependentClaims.length
        }
      });
      res.json({ success: true, selectedClaimsCount: selectedClaims.length });
    } catch (error) {
      console.error("Select claims error:", error);
      res.status(500).json({ message: error.message || "Failed to save selected claims" });
    }
  });
  app2.post("/api/projects/:id/agent/4b/generate-provisional", isAuthenticated, async (req, res) => {
    try {
      await clearDownstreamData(req.params.id, "4c");
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const agent1DataObj = agent1Data?.data;
      const sessionId = agent1DataObj?.sessionId || req.params.id;
      const mainIdea = agent1DataObj?.ideaSummary || "";
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent2DataObj = agent2Data?.data;
      const expandedConcept = agent2DataObj?.provisionalDraft || agent2DataObj?.draftSpecification || "";
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent4DataObj = agent4Data?.data;
      const selectedClaims = agent4DataObj?.selectedClaims || [];
      if (selectedClaims.length === 0) {
        return res.status(400).json({ message: "No claims selected. Please select at least one claim." });
      }
      let dependentCount = 0;
      const formattedClaims = selectedClaims.map((claim) => {
        let claimLabel;
        if (claim.type === "independent") {
          claimLabel = "independent claim";
        } else {
          dependentCount++;
          claimLabel = `dependent claim ${dependentCount}`;
        }
        return {
          type: claimLabel,
          text: claim.text,
          number: claim.number,
          // Preserve original claim number (1, 2, 3...)
          parentClaim: claim.parentClaim || null
          // Preserve dependency info
        };
      });
      const webhookPayload = {
        sessionId,
        category: project.category,
        coreIdea: mainIdea,
        expandedConcept,
        selectedClaims: formattedClaims
      };
      console.log("Calling provisional patent writing webhook...");
      const rawWebhookResponse = await runProvisional(webhookPayload);
      if (rawWebhookResponse && rawWebhookResponse.success === false) {
        return res.status(503).json({ message: rawWebhookResponse.error || "Provisional generation failed" });
      }
      console.log("Provisional webhook response received");
      console.log("Provisional response structure:", JSON.stringify(rawWebhookResponse, null, 2));
      const webhookResponse = Array.isArray(rawWebhookResponse) ? rawWebhookResponse[0] : rawWebhookResponse;
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          ...agent4DataObj,
          provisionalDraft: webhookResponse,
          // Store complete structured response (unwrapped)
          provisionalGeneratedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      const provisionalVersion = await storage.getNextSnapshotVersion(req.params.id);
      const claimsCount = webhookResponse?.claims_count || webhookResponse?.claims?.length || 0;
      const provisionalContent = `**${webhookResponse?.title || "Provisional Patent Application"}**

**Abstract:**
${webhookResponse?.abstract?.substring(0, 300) || "Generated"}...

**Claims:** ${claimsCount} claims included

_Full specification includes: Background, Summary, Detailed Description, and Ramifications_`;
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: provisionalVersion,
        snapshotType: "4c_provisional",
        title: "Provisional Draft Complete",
        content: provisionalContent,
        metadata: {
          stage: 4,
          substage: "4c",
          title: webhookResponse?.title,
          claimsCount,
          timestamp: webhookResponse?.timestamp
        }
      });
      res.json({
        success: true,
        provisionalDraft: webhookResponse
      });
    } catch (error) {
      console.error("Provisional generation error:", error);
      res.status(500).json({ message: error.message || "Failed to generate provisional patent. Please try again." });
    }
  });
  app2.post("/api/projects/:id/regenerate-draft", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const sessionId = project.sessionId || `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent1DataObj = agent1Data?.data;
      const agent2DataObj = agent2Data?.data;
      const agent4DataObj = agent4Data?.data;
      const mainIdea = agent1DataObj?.ideaSummary || agent1DataObj?.currentIdea || "";
      const expandedConcept = agent2DataObj?.provisionalDraft || agent2DataObj?.draftSpecification || "";
      const selectedClaims = agent4DataObj?.selectedClaims || [];
      if (selectedClaims.length === 0) {
        return res.status(400).json({ message: "No claims found. Cannot regenerate draft." });
      }
      console.log("Regenerating provisional patent draft...");
      let dependentCount = 0;
      const formattedClaims = selectedClaims.map((claim) => {
        let claimLabel;
        if (claim.type === "independent") {
          claimLabel = "independent claim";
        } else {
          dependentCount++;
          claimLabel = `dependent claim ${dependentCount}`;
        }
        return {
          type: claimLabel,
          text: claim.text,
          number: claim.number,
          parentClaim: claim.parentClaim || null
        };
      });
      const webhookPayload = {
        sessionId,
        category: project.category,
        coreIdea: mainIdea,
        expandedConcept,
        selectedClaims: formattedClaims
      };
      console.log("Calling provisional patent writing webhook for regeneration...");
      const rawWebhookResponse = await runProvisional(webhookPayload);
      if (rawWebhookResponse && rawWebhookResponse.success === false) {
        return res.status(503).json({ message: rawWebhookResponse.error || "Provisional generation failed" });
      }
      const provisionalDraft = Array.isArray(rawWebhookResponse) ? rawWebhookResponse[0] : rawWebhookResponse;
      if (!provisionalDraft || Object.keys(provisionalDraft).length === 0) {
        console.error("Webhook returned empty response");
        return res.status(500).json({
          message: "The draft generation service returned empty data. Please check your n8n workflow configuration and try again."
        });
      }
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          ...agent4DataObj,
          provisionalDraft,
          provisionalRegeneratedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      if (agent5Data) {
        const agent5DataObj = agent5Data.data;
        await storage.upsertAgentData({
          projectId: req.params.id,
          agentNumber: 5,
          data: {
            ...agent5DataObj,
            provisionalDraft
            // Update the draft but keep diagrams
          }
        });
      }
      console.log("Provisional draft regenerated successfully");
      res.json({
        success: true,
        provisionalDraft
      });
    } catch (error) {
      console.error("Regenerate draft error:", error);
      res.status(500).json({ message: error.message || "Failed to regenerate draft. Please try again." });
    }
  });
  app2.post("/api/projects/:id/generate-broader-claims", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      console.log("Generate broader claims requested for project:", req.params.id);
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5DataObj = agent5Data?.data;
      let provisionalDraft = agent5DataObj?.provisionalDraft;
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent4DataObj = agent4Data?.data;
      if (!provisionalDraft) {
        provisionalDraft = agent4DataObj?.provisionalDraft;
      }
      if (!provisionalDraft) {
        return res.status(400).json({ message: "No provisional draft found. Please complete the earlier stages first." });
      }
      const parsedDraft = parseProvisionalDraft(provisionalDraft);
      const formatClaims = (claims) => {
        if (!claims || claims.length === 0) return "";
        return claims.map((claim, index) => {
          const claimText = typeof claim === "string" ? claim : claim.text || "";
          const claimNumber = claim.number || index + 1;
          const trimmed = claimText.trim();
          if (/^(Claim\s+\d+[:.:]|^\d+[.)])/i.test(trimmed)) {
            return trimmed;
          }
          return `${claimNumber}. ${trimmed}`;
        }).join("\n\n");
      };
      const fullSpecification = [
        `TITLE: ${parsedDraft.title || "Provisional Patent Application"}`,
        "",
        "--- BACKGROUND ---",
        parsedDraft.background || "",
        "",
        "--- SUMMARY OF THE INVENTION ---",
        parsedDraft.summary || "",
        "",
        "--- DETAILED DESCRIPTION ---",
        parsedDraft.detailed_description || "",
        "",
        "--- RAMIFICATIONS AND SCOPE ---",
        parsedDraft.ramifications_and_scope || "",
        "",
        "--- ABSTRACT ---",
        parsedDraft.abstract || ""
      ].join("\n");
      const broadClaims = parsedDraft.claims || [];
      const currentClaims = formatClaims(broadClaims);
      const diagrams = agent5DataObj?.diagrams || [];
      let drawingDescriptions = "";
      if (diagrams.length > 0) {
        drawingDescriptions = diagrams.map((diagram, index) => {
          const chartNum = diagram.chartNumber || index + 1;
          const title = diagram.title || `Diagram ${chartNum}`;
          const markdown = diagram.markdown || diagram.diagramCode || "";
          return `Figure ${chartNum}: ${title}
${markdown}`;
        }).join("\n\n");
      }
      const priorArtSource = agent4DataObj?.conceptAnalyses || agent4DataObj?.nuggetAnalyses || null;
      const priorArtNotes = priorArtSource ? JSON.stringify(priorArtSource) : "";
      const webhookPayload = {
        patent_title: parsedDraft.title || "Provisional Patent Application",
        one_sentence_summary: parsedDraft.summary || parsedDraft.abstract || "Patent application for software invention",
        current_claims: currentClaims,
        full_specification: fullSpecification,
        drawing_descriptions_and_reference_numerals: drawingDescriptions || "No diagrams generated yet",
        deep_research_notes: "",
        prior_art_notes: priorArtNotes,
        important_claim_sets: ""
      };
      console.log("Calling Module 5/5c broader claims agent pipeline...");
      console.log("prior_art_notes length:", webhookPayload.prior_art_notes?.length || 0);
      const agentResult = await runBroaderClaims(webhookPayload);
      if (!agentResult.success) {
        return res.status(503).json({ message: agentResult.error });
      }
      const response = { summary: agentResult.summary, claims: agentResult.claims };
      console.log("Saving broader claims to database for project:", req.params.id);
      console.log("Existing agent5 keys:", agent5DataObj ? Object.keys(agent5DataObj) : "none");
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          ...agent5DataObj,
          specificClaims: broadClaims,
          // Original claims from provisional (specific/narrow)
          broadClaims: response,
          // New claims from webhook (broader scope)
          broaderClaimsGeneratedAt: (/* @__PURE__ */ new Date()).toISOString(),
          // Keep selectedClaimType if already set, default to 'specific'
          selectedClaimType: agent5DataObj?.selectedClaimType || "specific"
        }
      });
      console.log("Broader claims saved to database successfully");
      const version = await storage.getNextSnapshotVersion(req.params.id);
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version,
        snapshotType: "5_broader_claims",
        title: "Broader Claims Generated",
        content: `Broader claims generated with expanded scope and defensibility analysis.`,
        metadata: {
          stage: 5,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      res.json({
        success: true,
        specificClaims: broadClaims,
        broadClaims: response,
        message: "Broader claims generated! Choose which claims to use in your final draft."
      });
    } catch (error) {
      console.error("Generate broader claims error:", error);
      res.status(500).json({ message: error.message || "Failed to generate broader claims." });
    }
  });
  app2.post("/api/projects/:id/select-claim-type", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const { claimType } = req.body;
      if (!claimType || !["specific", "broad"].includes(claimType)) {
        return res.status(400).json({ message: "Invalid claim type. Must be 'specific' or 'broad'." });
      }
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5DataObj = agent5Data?.data;
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          ...agent5DataObj,
          selectedClaimType: claimType
        }
      });
      console.log(`Claim type updated to '${claimType}' for project ${req.params.id}`);
      res.json({
        success: true,
        selectedClaimType: claimType,
        message: `${claimType === "broad" ? "Broader" : "Specific"} claims selected for your final draft.`
      });
    } catch (error) {
      console.error("Select claim type error:", error);
      res.status(500).json({ message: error.message || "Failed to update claim type." });
    }
  });
  app2.post("/api/projects/:id/practitioner-match", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const userId = req.session.userId;
      const user = await storage.getUser(userId);
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5DataObj = agent5Data?.data;
      let provisionalDraft = agent5DataObj?.provisionalDraft;
      if (!provisionalDraft) {
        const agent4Data = await storage.getAgentData(req.params.id, 4);
        provisionalDraft = agent4Data?.data?.provisionalDraft;
      }
      if (!provisionalDraft) {
        return res.status(400).json({ message: "No provisional draft found. Please complete the earlier stages first." });
      }
      const parsedDraft = parseProvisionalDraft(provisionalDraft);
      const abstract = parsedDraft.abstract || "";
      if (!abstract) {
        return res.status(400).json({ message: "No abstract found in provisional draft." });
      }
      const webhookPayload = {
        query: abstract,
        userId: userId?.toString() || "",
        userEmail: user?.email || "",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      console.log("Calling practitioner match webhook...");
      const webhookResponse = await sendWebhook(N8N_PRACTITIONER_MATCH_WEBHOOK, webhookPayload);
      const response = Array.isArray(webhookResponse) ? webhookResponse[0] : webhookResponse;
      const matches = response?.matches || response?.practitioners || (Array.isArray(response) ? response : null);
      console.log("Practitioner match: found", Array.isArray(matches) ? matches.length : 0, "matches");
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          ...agent5DataObj,
          practitionerMatchResults: matches,
          practitionerMatchedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      res.json({ success: true, results: matches, count: Array.isArray(matches) ? matches.length : 0 });
    } catch (error) {
      console.error("Practitioner match error:", error);
      res.status(500).json({ message: error.message || "Failed to find practitioners. Please try again." });
    }
  });
  app2.post("/api/projects/:id/finalize-provisional", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const sessionId = project.sessionId || `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent4DataObj = agent4Data?.data;
      const selectedClaims = agent4DataObj?.selectedClaims || [];
      if (selectedClaims.length === 0) {
        return res.status(400).json({ message: "No claims selected. Please select at least one claim." });
      }
      console.log("Generating provisional patent (no diagrams)...");
      const agent1DataObj = agent1Data?.data;
      const mainIdea = agent1DataObj?.ideaSummary || agent1DataObj?.currentIdea || "";
      const agent2DataObj = agent2Data?.data;
      const expandedConcept = agent2DataObj?.provisionalDraft || agent2DataObj?.draftSpecification || "";
      let dependentCount = 0;
      const formattedClaims = selectedClaims.map((claim) => {
        let claimLabel;
        if (claim.type === "independent") {
          claimLabel = "independent claim";
        } else {
          dependentCount++;
          claimLabel = `dependent claim ${dependentCount}`;
        }
        return {
          type: claimLabel,
          text: claim.text,
          number: claim.number,
          parentClaim: claim.parentClaim || null
        };
      });
      const webhookPayload = {
        sessionId,
        category: project.category,
        coreIdea: mainIdea,
        expandedConcept,
        selectedClaims: formattedClaims
      };
      console.log("Calling provisional patent writing webhook...");
      const rawWebhookResponse = await runProvisional(webhookPayload);
      if (rawWebhookResponse && rawWebhookResponse.success === false) {
        return res.status(503).json({ message: rawWebhookResponse.error || "Provisional generation failed" });
      }
      const provisionalDraft = Array.isArray(rawWebhookResponse) ? rawWebhookResponse[0] : rawWebhookResponse;
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          ...agent4DataObj,
          provisionalDraft,
          provisionalGeneratedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          provisionalDraft,
          diagrams: []
          // Empty - user will generate on demand
        }
      });
      const provisionalVersion = await storage.getNextSnapshotVersion(req.params.id);
      const claimsCount = provisionalDraft?.claims_count || provisionalDraft?.claims?.length || 0;
      const provisionalContent = `**${provisionalDraft?.title || "Provisional Patent Application"}**

**Abstract:**
${provisionalDraft?.abstract?.substring(0, 300) || "Generated"}...

**Claims:** ${claimsCount} claims included

_Full specification includes: Background, Summary, Detailed Description, and Ramifications_`;
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: provisionalVersion,
        snapshotType: "4c_provisional",
        title: "Provisional Draft Complete",
        content: provisionalContent,
        metadata: {
          stage: 4,
          substage: "4c",
          title: provisionalDraft?.title,
          claimsCount,
          timestamp: provisionalDraft?.timestamp
        }
      });
      console.log("Provisional patent generated successfully");
      await storage.updateProject(req.params.id, { currentStage: 5 });
      res.json({
        success: true,
        provisionalDraft,
        message: "Provisional ready! You can generate diagrams from The Showcase."
      });
    } catch (error) {
      console.error("Finalize provisional error:", error);
      res.status(500).json({ message: error.message || "Failed to generate provisional patent. Please try again." });
    }
  });
  app2.post("/api/projects/:id/generate-showcase", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5DataObj = agent5Data?.data;
      let provisionalDraft = agent5DataObj?.provisionalDraft;
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent4DataObj = agent4Data?.data;
      if (!provisionalDraft) {
        provisionalDraft = agent4DataObj?.provisionalDraft;
      }
      if (!provisionalDraft) {
        return res.status(400).json({ message: "No provisional draft found. Please complete the earlier stages first." });
      }
      const parsedDraft = parseProvisionalDraft(provisionalDraft);
      const selectedClaimType = agent5DataObj?.selectedClaimType || "specific";
      let claimsForDiagrams = "";
      if (parsedDraft.claims) {
        if (Array.isArray(parsedDraft.claims)) {
          claimsForDiagrams = parsedDraft.claims.map((c, i) => {
            const trimmed = (typeof c === "string" ? c : "").trim();
            if (/^(Claim\s+\d+[:.:]|\d+[.)])/i.test(trimmed)) return trimmed;
            return `${i + 1}. ${trimmed}`;
          }).filter((c) => c.length > 5).join("\n\n");
        } else {
          claimsForDiagrams = String(parsedDraft.claims);
        }
      }
      if (selectedClaimType === "broad" && agent5DataObj?.broadClaims) {
        const claimsArr = extractClaimsFromBroadData(agent5DataObj.broadClaims);
        if (claimsArr.length > 0) {
          claimsForDiagrams = claimsArr.map((c, i) => `${i + 1}. ${c}`).join("\n\n");
        }
      }
      console.log("Generating diagrams...");
      console.log(`Using ${selectedClaimType} claims for diagrams (from edited specification)`);
      const formattedDocument = [
        `TITLE: ${parsedDraft.title || "Provisional Patent Application"}`,
        "",
        "--- BACKGROUND ---",
        parsedDraft.background || "",
        "",
        "--- SUMMARY OF THE INVENTION ---",
        parsedDraft.summary || "",
        "",
        "--- DETAILED DESCRIPTION ---",
        parsedDraft.detailed_description || "",
        "",
        "--- RAMIFICATIONS AND SCOPE ---",
        parsedDraft.ramifications_and_scope || "",
        "",
        "--- CLAIMS ---",
        claimsForDiagrams,
        "",
        "--- ABSTRACT ---",
        parsedDraft.abstract || ""
      ].join("\n");
      const sourceCodeFiles = project?.sourceCodeFiles || [];
      const codeFromTheUser = {};
      sourceCodeFiles.forEach((file, index) => {
        codeFromTheUser[`code${index + 1}`] = {
          text: file.description || "",
          code: file.code || ""
        };
      });
      const diagramsPayload = {
        title: parsedDraft.title || "Provisional Patent Application",
        detailed_description: formattedDocument
      };
      if (Object.keys(codeFromTheUser).length > 0) {
        diagramsPayload.codeFromTheUser = codeFromTheUser;
      }
      console.log("Calling diagrams generation webhook with full document...");
      const diagramsResponse = await runDiagrams(diagramsPayload);
      let diagrams = [];
      let totalFlowcharts = 0, successfulFlowcharts = 0, failedFlowcharts = 0;
      if (Array.isArray(diagramsResponse) && diagramsResponse.length > 0 && diagramsResponse[0]?.flowcharts) {
        const responseData = diagramsResponse[0];
        totalFlowcharts = responseData.totalFlowcharts || 0;
        successfulFlowcharts = responseData.successful || 0;
        failedFlowcharts = responseData.failed || 0;
        diagrams = responseData.flowcharts || [];
      } else if (diagramsResponse?.flowcharts && Array.isArray(diagramsResponse.flowcharts)) {
        totalFlowcharts = diagramsResponse.totalFlowcharts || 0;
        successfulFlowcharts = diagramsResponse.successful || 0;
        failedFlowcharts = diagramsResponse.failed || 0;
        diagrams = diagramsResponse.flowcharts;
      } else if (Array.isArray(diagramsResponse)) {
        diagrams = diagramsResponse;
      } else if (diagramsResponse?.diagrams) {
        diagrams = diagramsResponse.diagrams;
      } else if (diagramsResponse?.text || diagramsResponse?.diagramType) {
        diagrams = [diagramsResponse];
      }
      console.log(`Diagrams generated: ${diagrams.length} (${successfulFlowcharts} successful, ${failedFlowcharts} failed)`);
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          ...agent5DataObj,
          // Preserve existing fields (broadClaims, selectedClaimType, etc.)
          provisionalDraft,
          diagrams,
          diagramsGeneratedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      const diagramVersion = await storage.getNextSnapshotVersion(req.params.id);
      const diagramContent = `**Technical Diagrams Generated:**

` + diagrams.map((d, i) => `${i + 1}. **${d.diagramType || d.type || d.title || "Figure " + (i + 1)}**`).join("\n") + `

_${diagrams.length} diagram(s) ready for patent application_`;
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: diagramVersion,
        snapshotType: "5_diagrams",
        title: `${diagrams.length} Diagrams Generated`,
        content: diagramContent,
        metadata: {
          stage: 5,
          diagramCount: diagrams.length,
          diagramTypes: diagrams.map((d) => d.diagramType || d.type || d.title)
        }
      });
      await storage.updateProject(req.params.id, { currentStage: 5 });
      res.json({
        success: true,
        provisionalDraft,
        diagrams,
        message: "Showcase ready!"
      });
    } catch (error) {
      console.error("Generate showcase error:", error);
      res.status(500).json({ message: error.message || "Failed to generate showcase. Please try again." });
    }
  });
  app2.post("/api/projects/:id/agent/4", isAuthenticated, async (req, res) => {
    try {
      const existingData = await storage.getAgentData(req.params.id, 4);
      const savedData = await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: { ...existingData?.data || {}, ...req.body }
      });
      res.json(savedData);
    } catch (error) {
      console.error("Save agent 4 data error:", error);
      res.status(500).json({ message: "Failed to save data" });
    }
  });
  app2.post("/api/projects/:id/agent/4/proceed", isAuthenticated, async (req, res) => {
    try {
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent4DataObj = agent4Data?.data;
      const provisionalDraft = agent4DataObj?.provisionalDraft;
      const specificClaims = agent4DataObj?.selectedClaims || [];
      if (!provisionalDraft) {
        return res.status(400).json({ message: "Provisional draft not found. Please generate the draft first." });
      }
      const parsedDraft = parseProvisionalDraft(provisionalDraft);
      const formatSpecificClaims = (claims) => {
        if (!claims || claims.length === 0) return "";
        return claims.map((claim, index) => {
          const claimText = typeof claim === "string" ? claim : claim.text || "";
          const claimNumber = claim.number || index + 1;
          const trimmed = claimText.trim();
          if (/^(Claim\s+\d+[:.:]|^\d+[.)])/i.test(trimmed)) {
            return trimmed;
          }
          return `${claimNumber}. ${trimmed}`;
        }).join("\n\n");
      };
      console.log(`Using ${specificClaims.length} Specific Claims for diagrams (not Broad Claims from provisional)`);
      const formattedDocument = [
        `TITLE: ${parsedDraft.title || "Provisional Patent Application"}`,
        "",
        "--- BACKGROUND ---",
        parsedDraft.background || "",
        "",
        "--- SUMMARY OF THE INVENTION ---",
        parsedDraft.summary || "",
        "",
        "--- DETAILED DESCRIPTION ---",
        parsedDraft.detailed_description || "",
        "",
        "--- RAMIFICATIONS AND SCOPE ---",
        parsedDraft.ramifications_and_scope || "",
        "",
        "--- CLAIMS ---",
        formatSpecificClaims(specificClaims),
        // Use Specific Claims for diagrams
        "",
        "--- ABSTRACT ---",
        parsedDraft.abstract || ""
      ].join("\n");
      const project4 = await storage.getProject(req.params.id);
      const sourceCodeFiles4 = project4?.sourceCodeFiles || [];
      const codeFromTheUser4 = {};
      sourceCodeFiles4.forEach((file, index) => {
        codeFromTheUser4[`code${index + 1}`] = {
          text: file.description || "",
          code: file.code || ""
        };
      });
      const diagramsPayload = {
        title: parsedDraft.title || "Provisional Patent Application",
        detailed_description: formattedDocument
      };
      if (Object.keys(codeFromTheUser4).length > 0) {
        diagramsPayload.codeFromTheUser = codeFromTheUser4;
      }
      console.log("Calling diagrams generation webhook with full document...");
      const webhookResponse = await runDiagrams(diagramsPayload);
      console.log("Diagrams webhook response received");
      console.log("Webhook response:", JSON.stringify(webhookResponse, null, 2));
      let diagrams = [];
      let totalFlowcharts = 0;
      let successfulFlowcharts = 0;
      let failedFlowcharts = 0;
      if (Array.isArray(webhookResponse) && webhookResponse.length > 0 && webhookResponse[0]?.flowcharts) {
        const responseData = webhookResponse[0];
        totalFlowcharts = responseData.totalFlowcharts || 0;
        successfulFlowcharts = responseData.successful || 0;
        failedFlowcharts = responseData.failed || 0;
        diagrams = responseData.flowcharts || [];
        console.log(`Parsed ${diagrams.length} flowcharts (${successfulFlowcharts} successful, ${failedFlowcharts} failed)`);
      } else if (webhookResponse?.flowcharts && Array.isArray(webhookResponse.flowcharts)) {
        totalFlowcharts = webhookResponse.totalFlowcharts || 0;
        successfulFlowcharts = webhookResponse.successful || 0;
        failedFlowcharts = webhookResponse.failed || 0;
        diagrams = webhookResponse.flowcharts;
        console.log(`Parsed ${diagrams.length} flowcharts (${successfulFlowcharts} successful, ${failedFlowcharts} failed)`);
      } else if (Array.isArray(webhookResponse)) {
        diagrams = webhookResponse;
      } else if (webhookResponse?.diagrams) {
        diagrams = webhookResponse.diagrams;
      } else if (webhookResponse?.text || webhookResponse?.diagramType) {
        diagrams = [webhookResponse];
      }
      console.log(`Storing ${diagrams.length} diagrams in Agent 5 data`);
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          provisionalDraft,
          // Keep the full draft for reference
          diagrams,
          diagramsGeneratedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
      const diagramVersion = await storage.getNextSnapshotVersion(req.params.id);
      const diagramTypes = diagrams.map((d) => d.diagramType || d.type || "Diagram").join(", ");
      const diagramContent = `**Technical Diagrams Generated:**

` + diagrams.map((d, i) => `${i + 1}. **${d.diagramType || d.type || "Figure " + (i + 1)}**`).join("\n") + `

_${diagrams.length} diagram(s) ready for patent application_`;
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: diagramVersion,
        snapshotType: "5_diagrams",
        title: `${diagrams.length} Diagrams Generated`,
        content: diagramContent,
        metadata: {
          stage: 5,
          diagramCount: diagrams.length,
          diagramTypes: diagrams.map((d) => d.diagramType || d.type)
        }
      });
      await storage.updateProject(req.params.id, { currentStage: 5 });
      res.json({ success: true, diagrams });
    } catch (error) {
      console.error("Diagram generation error:", error);
      res.status(500).json({ message: error.message || "Failed to generate diagrams. Please try again." });
    }
  });
  app2.post("/api/projects/:id/agent/5", isAuthenticated, async (req, res) => {
    try {
      const savedData = await storage.mergeAgentData(req.params.id, 5, req.body);
      res.json(savedData);
    } catch (error) {
      console.error("Save agent 5 data error:", error);
      res.status(500).json({ message: "Failed to save data" });
    }
  });
  app2.post("/api/projects/:id/update-specification-section", isAuthenticated, async (req, res) => {
    try {
      const { section, content } = req.body;
      const validSections = ["title", "background", "summary", "detailed_description", "ramifications_and_scope", "abstract", "claims"];
      if (!section || !validSections.includes(section)) {
        return res.status(400).json({ message: `Invalid section. Must be one of: ${validSections.join(", ")}` });
      }
      if (content === void 0 || content === null) {
        return res.status(400).json({ message: "Content is required" });
      }
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5Obj = agent5Data?.data;
      let provisionalDraft = agent5Obj?.provisionalDraft;
      if (!provisionalDraft) {
        const agent4Data = await storage.getAgentData(req.params.id, 4);
        const agent4Obj = agent4Data?.data;
        provisionalDraft = agent4Obj?.provisionalDraft;
      }
      if (!provisionalDraft) {
        return res.status(400).json({ message: "No provisional draft found" });
      }
      const parsedDraft = parseProvisionalDraft(provisionalDraft);
      if (section === "claims") {
        const claimsArray = content.split(/\n\n+/).map((c) => c.trim()).filter((c) => c.length > 0);
        parsedDraft.claims = claimsArray;
      } else {
        parsedDraft[section] = content;
      }
      await storage.mergeAgentData(req.params.id, 5, { provisionalDraft: parsedDraft });
      res.json({ success: true, section, updatedDraft: parsedDraft });
    } catch (error) {
      console.error("Update specification section error:", error);
      res.status(500).json({ message: "Failed to update section" });
    }
  });
  app2.get("/api/projects/:id/specification-sections", isAuthenticated, async (req, res) => {
    try {
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5Obj = agent5Data?.data;
      let provisionalDraft = agent5Obj?.provisionalDraft;
      if (!provisionalDraft) {
        const agent4Data = await storage.getAgentData(req.params.id, 4);
        const agent4Obj = agent4Data?.data;
        provisionalDraft = agent4Obj?.provisionalDraft;
      }
      if (!provisionalDraft) {
        return res.status(404).json({ message: "No provisional draft found" });
      }
      const parsedDraft = parseProvisionalDraft(provisionalDraft);
      let claimsContent = Array.isArray(parsedDraft.claims) ? parsedDraft.claims.join("\n\n") : parsedDraft.claims || "";
      const selectedClaimType = agent5Obj?.selectedClaimType || "specific";
      if (selectedClaimType === "broad" && agent5Obj?.broadClaims) {
        const claimsArr = extractClaimsFromBroadData(agent5Obj.broadClaims);
        if (claimsArr.length > 0) {
          claimsContent = claimsArr.map((c, i) => `Claim ${i + 1}: ${c}`).join("\n\n");
        }
      }
      const sections = [
        { key: "title", label: "Title", content: parsedDraft.title || "" },
        { key: "background", label: "Background of the Invention", content: parsedDraft.background || "" },
        { key: "summary", label: "Summary of the Invention", content: parsedDraft.summary || "" },
        { key: "detailed_description", label: "Detailed Description", content: parsedDraft.detailed_description || "" },
        { key: "ramifications_and_scope", label: "Ramifications & Scope", content: parsedDraft.ramifications_and_scope || "" },
        { key: "abstract", label: "Abstract", content: parsedDraft.abstract || "" },
        { key: "claims", label: "Claims", content: claimsContent }
      ];
      res.json(sections);
    } catch (error) {
      console.error("Get specification sections error:", error);
      res.status(500).json({ message: "Failed to get specification sections" });
    }
  });
  app2.get("/api/projects/:id/pannu", isAuthenticated, async (req, res) => {
    try {
      const records = await storage.getPannuRecords(req.params.id);
      res.json(records);
    } catch (error) {
      console.error("Get Pannu records error:", error);
      res.status(500).json({ message: "Failed to get Pannu records" });
    }
  });
  app2.post("/api/projects/:id/pannu/generate-questions", isAuthenticated, async (req, res) => {
    try {
      const { conceptId, claimText, strategyContext } = req.body;
      if (!conceptId || !claimText) {
        return res.status(400).json({ message: "Missing required fields: conceptId, claimText" });
      }
      const existingRecords = await storage.getPannuRecords(req.params.id);
      let pannuRecord = existingRecords.find((r) => r.conceptId === conceptId);
      if (pannuRecord) {
        await storage.updatePannuRecord(pannuRecord.id, {
          claimText,
          strategyContext: strategyContext || null,
          questions: null,
          answers: null,
          certificationStatus: null,
          confidenceScore: null,
          pannuRecordText: null
        });
      } else {
        pannuRecord = await storage.createPannuRecord({
          projectId: req.params.id,
          conceptId,
          claimText,
          strategyContext: strategyContext || null
        });
      }
      const webhookPayload = {
        claim_text: claimText,
        concept_id: conceptId,
        strategy_context: strategyContext || ""
      };
      console.log("Calling Pannu questions webhook:", JSON.stringify(webhookPayload, null, 2));
      const defaultQuestions = [
        {
          factor: "conception",
          question: "Describe your specific contribution to conceiving this invention. What original ideas or insights did you personally develop?",
          hint: "Focus on the 'aha moment' - what novel concept did you come up with that makes this invention work?"
        },
        {
          factor: "quality",
          question: "Explain the quality and significance of your contribution. How did your input shape the core functionality of the invention?",
          hint: "Describe how your contribution is essential to the invention, not just a minor enhancement."
        },
        {
          factor: "known_concepts",
          question: "How does your contribution go beyond applying well-known concepts? What makes your approach novel?",
          hint: "Explain what you developed that wasn't already standard practice or commonly known in the field."
        }
      ];
      let questions = defaultQuestions;
      try {
        const agentResponse = await runPannuQuestions(webhookPayload);
        if (agentResponse.success && Array.isArray(agentResponse.questions) && agentResponse.questions.length > 0) {
          questions = agentResponse.questions;
        } else {
          console.log("Using default Pannu questions \u2014 agent returned no questions:", "error" in agentResponse ? agentResponse.error : "unknown");
        }
      } catch (agentError) {
        console.log("Using default Pannu questions due to agent error:", agentError);
      }
      await storage.updatePannuRecord(pannuRecord.id, {
        questions
      });
      res.json({
        success: true,
        pannuRecordId: pannuRecord.id,
        conceptId,
        questions
      });
    } catch (error) {
      console.error("Generate Pannu questions error:", error);
      res.status(500).json({ message: error.message || "Failed to generate Pannu questions" });
    }
  });
  app2.post("/api/projects/:id/pannu/validate-answers", isAuthenticated, async (req, res) => {
    try {
      const { pannuRecordId, conceptId, claimText, answers } = req.body;
      if (!conceptId || !claimText || !answers) {
        return res.status(400).json({ message: "Missing required fields: conceptId, claimText, answers" });
      }
      const webhookPayload = {
        claim_text: claimText,
        concept_id: conceptId,
        human_answers: answers
      };
      console.log("Calling Module 4/4c Pannu scorer agent...");
      const scorerResponse = await runPannuScorer(webhookPayload);
      const certificationStatus = scorerResponse.certification_status;
      const confidenceScore = scorerResponse.confidence_score;
      const pannuRecordText = scorerResponse.pannu_record_text;
      if (pannuRecordId) {
        await storage.updatePannuRecord(pannuRecordId, {
          answers,
          certificationStatus,
          confidenceScore: String(confidenceScore),
          pannuRecordText
        });
      } else {
        const existingRecord = await storage.getPannuRecord(req.params.id, conceptId);
        if (existingRecord) {
          await storage.updatePannuRecord(existingRecord.id, {
            answers,
            certificationStatus,
            confidenceScore: String(confidenceScore),
            pannuRecordText
          });
        } else {
          await storage.createPannuRecord({
            projectId: req.params.id,
            conceptId,
            claimText,
            answers,
            certificationStatus,
            confidenceScore: String(confidenceScore),
            pannuRecordText
          });
        }
      }
      res.json({
        success: true,
        conceptId,
        certificationStatus,
        confidenceScore,
        pannuRecordText
      });
    } catch (error) {
      console.error("Validate Pannu answers error:", error);
      res.status(500).json({ message: error.message || "Failed to validate Pannu answers" });
    }
  });
  app2.post("/api/projects/:id/pannu/ai-suggestion", isAuthenticated, async (req, res) => {
    try {
      const { claimText, question, factor } = req.body;
      const webhookPayload = {
        claimText,
        question,
        factor
      };
      console.log("Calling Module 4/4d Pannu suggestion agent...");
      const agentResponse = await runPannuSuggestion(webhookPayload);
      const suggestion = agentResponse.success ? agentResponse.suggestion : "Unable to generate suggestion at this time.";
      res.json({
        success: true,
        suggestion
      });
    } catch (error) {
      console.error("Pannu AI suggestion error:", error);
      res.status(500).json({ message: error.message || "Failed to generate AI suggestion" });
    }
  });
  app2.post("/api/projects/:id/qa-assistant", isAuthenticated, async (req, res) => {
    try {
      const { message, conversationHistory, currentLocation } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "Message is required" });
      }
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const [agent1Data, agent2Data, agent3Data, agent4Data, agent5Data] = await Promise.all([
        storage.getAgentData(req.params.id, 1),
        storage.getAgentData(req.params.id, 2),
        storage.getAgentData(req.params.id, 3),
        storage.getAgentData(req.params.id, 4),
        storage.getAgentData(req.params.id, 5)
      ]);
      const agent1Obj = agent1Data?.data;
      const agent2Obj = agent2Data?.data;
      const agent3Obj = agent3Data?.data;
      const agent4Obj = agent4Data?.data;
      const agent5Obj = agent5Data?.data;
      const projectContext = {
        projectTitle: project.title,
        category: project.category,
        currentStage: project.currentStage,
        // Module 1 data
        ideaSummary: agent1Obj?.ideaSummary || agent1Obj?.currentIdea || "",
        advocatePoints: agent1Obj?.advocatePoints || [],
        examinerPoints: agent1Obj?.examinerPoints || [],
        extractedIdeas: agent1Obj?.extractedIdeas || agent1Obj?.unifiedIdeas || [],
        approvedIdeas: agent1Obj?.approvedIdeas || [],
        // Module 2 data
        expandedConcepts: agent2Obj?.expandedConcepts || [],
        selectedConcepts: agent2Obj?.selectedConcepts || [],
        // Module 3 data
        priorArtResults: agent3Obj?.priorArtResults ? "Prior art research completed" : "Not yet completed",
        // Module 4 data
        whiteSpaceAnalysis: agent4Obj?.nuggetAnalyses ? "White space analysis completed" : "Not yet completed",
        claimsGenerated: agent4Obj?.selectedClaims?.length || 0,
        provisionalDraftStatus: agent4Obj?.provisionalDraft ? "Draft generated" : "Not yet generated",
        // Module 5 data
        hasProvisionalDraft: !!agent5Obj?.provisionalDraft,
        specificClaims: agent5Obj?.specificClaims || [],
        broaderClaims: agent5Obj?.broaderClaims || [],
        hasDiagrams: !!(agent5Obj?.diagrams?.length > 0),
        diagramCount: agent5Obj?.diagrams?.length || 0
      };
      const webhookPayload = {
        message,
        conversationHistory: conversationHistory || [],
        projectContext,
        currentLocation: currentLocation || "Unknown",
        sessionId: req.session?.id || ""
      };
      console.log("Calling Q&A Assistant AI with currentLocation:", currentLocation);
      const response = await runQAAssistant(webhookPayload);
      console.log("\u2705 YES IS THIS ONE \u2014 QA Assistant responded via direct AI call");
      console.log("Q&A Assistant response:", response?.substring(0, 100));
      res.json({
        success: true,
        response
      });
    } catch (error) {
      console.error("Q&A Assistant error:", error);
      res.status(500).json({ message: error.message || "Failed to get response from Q&A Assistant" });
    }
  });
  const extractClaimsFromBroadData = (broadClaims) => {
    if (!broadClaims) return [];
    if (broadClaims.claims && Array.isArray(broadClaims.claims) && broadClaims.claims.length > 0 && broadClaims.claims[0]?.text) {
      return broadClaims.claims.sort((a, b) => (a.number || 0) - (b.number || 0)).map((c) => c.text);
    }
    if (broadClaims.output && typeof broadClaims.output === "string") {
      return extractClaimsFromBroadText(broadClaims.output);
    }
    if (broadClaims.claims_only && typeof broadClaims.claims_only === "string") {
      return extractClaimsFromBroadText(broadClaims.claims_only);
    }
    if (typeof broadClaims === "string") {
      return extractClaimsFromBroadText(broadClaims);
    }
    if (Array.isArray(broadClaims)) {
      if (broadClaims.length > 0 && typeof broadClaims[0] === "object" && broadClaims[0]?.text) {
        return broadClaims.sort((a, b) => (a.number || 0) - (b.number || 0)).map((c) => c.text);
      }
      return broadClaims.map((c) => typeof c === "string" ? c : c.text || JSON.stringify(c));
    }
    if (broadClaims.claims) {
      return extractClaimsFromBroadData(broadClaims.claims);
    }
    return [];
  };
  const extractClaimsFromBroadText = (text2) => {
    if (!text2) return [];
    let cleanText = text2.replace(/\\n/g, "\n");
    const sectionCutoffs = [
      /\n#{1,4}\s*\d*\.?\s*Support\s*Map/i,
      /\n#{1,4}\s*\d*\.?\s*Risk\s*Analysis/i,
      /\n#{1,4}\s*\d*\.?\s*Broadening\s*Rationale/i,
      /\n#{1,4}\s*\d*\.?\s*Execution\s*Notes/i,
      /\n#{1,4}\s*\d*\.?\s*Processing\s*Status/i,
      /\n---+\s*\n/
    ];
    for (const pattern of sectionCutoffs) {
      const idx = cleanText.search(pattern);
      if (idx > 0) {
        cleanText = cleanText.substring(0, idx);
      }
    }
    const claimStartPatterns = [
      /\*\*Claim\s*1/i,
      /Claim\s*1[:.]\s/i,
      /^\s*1\.\s+/m
    ];
    for (const pattern of claimStartPatterns) {
      const idx = cleanText.search(pattern);
      if (idx > 0 && idx < cleanText.length * 0.5) {
        cleanText = cleanText.substring(idx);
        break;
      }
    }
    let claims = [];
    if (/\*\*Claim\s*\d+/i.test(cleanText)) {
      claims = cleanText.split(/\*\*Claim\s*\d+[:.]\*?\*?\s*/i).filter((c) => c.trim().length > 20).map((c) => c.replace(/\*\*/g, "").trim());
    } else if (/(?:^|\n)Claim\s*\d+\s*:/i.test(cleanText)) {
      claims = cleanText.split(/(?:^|\n)Claim\s*\d+\s*:\s*/i).filter((c) => c.trim().length > 20).map((c) => c.trim());
    } else if (/^\s*1\.\s+/m.test(cleanText)) {
      claims = cleanText.split(/(?=^\s*\d+\.\s+)/m).map((c) => c.replace(/^\s*\d+\.\s+/, "").trim()).filter((c) => c.length > 20);
    } else {
      claims = cleanText.split(/\n\n+/).filter((c) => c.trim().length > 20);
    }
    return claims;
  };
  const parseProvisionalDraft = (rawDraft) => {
    if (!rawDraft) return {};
    if (rawDraft.title && rawDraft.background) {
      return rawDraft;
    }
    if (Array.isArray(rawDraft) && rawDraft[0]?.title) {
      return rawDraft[0];
    }
    const textBlob = JSON.stringify(rawDraft);
    const extractField = (fieldName) => {
      const regex = new RegExp(`<${fieldName}>([\\s\\S]*?)<\\/${fieldName}>`, "i");
      const match = textBlob.match(regex);
      if (match) {
        let text2 = match[1].trim();
        text2 = text2.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "	").replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/^"|"$/g, "");
        return text2;
      }
      return null;
    };
    const extractClaims = () => {
      const claimsMatch = textBlob.match(/<CLAIMS>([\s\S]*?)<\/CLAIMS>/i);
      if (claimsMatch) {
        let claimsText = claimsMatch[1];
        claimsText = claimsText.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "	").replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/^"|"$/g, "");
        const claims2 = claimsText.split(/\n\n+/).map((c) => c.trim()).filter((c) => c.length > 0);
        return claims2;
      }
      return [];
    };
    const parsedDraft = {};
    const title = extractField("TITLE");
    if (title) parsedDraft.title = title;
    const background = extractField("BACKGROUND");
    if (background) parsedDraft.background = background;
    const summary = extractField("SUMMARY");
    if (summary) parsedDraft.summary = summary;
    const detailedDescription = extractField("DETAILED_DESCRIPTION");
    if (detailedDescription) parsedDraft.detailed_description = detailedDescription;
    const ramifications = extractField("RAMIFICATIONS_AND_SCOPE");
    if (ramifications) parsedDraft.ramifications_and_scope = ramifications;
    const abstract = extractField("ABSTRACT");
    if (abstract) parsedDraft.abstract = abstract;
    const claims = extractClaims();
    if (claims.length > 0) parsedDraft.claims = claims;
    return Object.keys(parsedDraft).length > 0 ? parsedDraft : rawDraft;
  };
  const cleanClaimFormatting = (text2) => {
    if (!text2) return "";
    return text2.replace(/;\s*\*\s+/g, "; ").replace(/:\s*\*\s+/g, ": ").replace(/\s+\*\s+/g, " ").replace(/\s{2,}/g, " ").replace(/\s+;/g, ";").replace(/\s+,/g, ",").trim();
  };
  const sanitizeForPDF = (text2) => {
    if (!text2) return "";
    let processed = text2.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => {
      return String.fromCharCode(parseInt(code, 16));
    });
    processed = processed.normalize("NFC");
    processed = processed.replace(/\|[^|]*\|/g, "").replace(/^\s*\|.*\|.*$/gm, "").replace(/^[-:|]+$/gm, "").replace(/-{5,}/g, "").replace(/## \d+\.\s*Support Map.*$/gm, "").replace(/Claim Limitation.*Reference Numerals.*$/gm, "").replace(/Supporting Specification Excerpt.*$/gm, "").replace(/\n{3,}/g, "\n\n");
    return processed.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/[\u2000-\u200F]/g, " ").replace(/[\uFFF0-\uFFFF]/g, "").trim();
  };
  const sanitizeAbstractForUSPTO = (text2) => {
    if (!text2) return "";
    let cleaned = text2.replace(/\bFigure\s*\d+\b/gi, "").replace(/\bFIG\.\s*\d+\b/gi, "").replace(/\bFIG\s*\d+\b/gi, "").replace(/\bdiagram\s*\d+\b/gi, "").replace(/\bas shown in.*?(?:\.|$)/gi, ".").replace(/\bas illustrated in.*?(?:\.|$)/gi, ".").replace(/\brefer(?:ring)? to.*?(?:figure|fig|diagram).*?(?:\.|$)/gi, ".").replace(/!\[.*?\]\(.*?\)/g, "").replace(/\[(?:fig|figure|diagram).*?\]/gi, "").replace(/\s{2,}/g, " ").replace(/\.{2,}/g, ".").replace(/\.\s*\./g, ".").trim();
    const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
    if (words.length > 150) {
      cleaned = words.slice(0, 147).join(" ") + "...";
    }
    return cleaned;
  };
  const fixClaimReferences = (claims) => {
    let currentIndependentClaimNum = 0;
    return claims.map((claim) => {
      const trimmed = claim.trim();
      const independentMatch = trimmed.match(/^(\d+)\.\s+(?!\d)/);
      const dependentMatch = trimmed.match(/^(\d+)\.(\d+)\./);
      if (independentMatch) {
        currentIndependentClaimNum = parseInt(independentMatch[1], 10);
        return claim;
      } else if (dependentMatch) {
        const parentClaimNum = parseInt(dependentMatch[1], 10);
        if (currentIndependentClaimNum > 0 && parentClaimNum === currentIndependentClaimNum) {
          return claim.replace(/claim\s+1\b/gi, `claim ${currentIndependentClaimNum}`);
        }
        return claim;
      }
      return claim;
    });
  };
  const renderMarkdownToPDF = async (doc, text2, options = {}) => {
    const { marked } = await import("marked");
    const fontSize = options.fontSize || 11;
    const lineGap = options.lineGap || 4;
    if (!text2) return;
    let preprocessed = text2.replace(/\[SECTION:\s*([^\]]+)\]/g, "\n\n## $1\n\n").replace(/^\s*\*\s+(?!\*)/gm, "\u2022 ").replace(/\n\s*\*\s+(?!\*)/g, "\n\u2022 ").replace(/\n{3,}/g, "\n\n");
    const tokens = marked.lexer(preprocessed);
    const cleanText = (text3, preserveSpaces = true) => {
      let cleaned = text3.replace(/\*\*/g, "").replace(/^\*\s*/g, "\u2022 ").replace(/\s+/g, " ");
      return preserveSpaces ? cleaned : cleaned.trim();
    };
    const renderInlineTokens = (inlineTokens, continued = false) => {
      inlineTokens.forEach((token, idx) => {
        const isLast = idx === inlineTokens.length - 1;
        const shouldContinue = continued || !isLast;
        if (token.type === "strong") {
          let boldText = token.tokens ? token.tokens.map((t) => t.raw || t.text || "").join("") : token.text || "";
          boldText = cleanText(boldText, true);
          if (boldText && boldText.trim()) {
            doc.font("Helvetica-Bold").text(boldText, { continued: shouldContinue, lineGap });
          }
        } else if (token.type === "em") {
          let italicText = token.tokens ? token.tokens.map((t) => t.raw || t.text || "").join("") : token.text || "";
          italicText = cleanText(italicText, true);
          if (italicText && italicText.trim()) {
            doc.font("Helvetica-Oblique").text(italicText, { continued: shouldContinue, lineGap });
          }
        } else if (token.type === "text" || token.type === "codespan") {
          const textContent = cleanText(token.text || token.raw || "", true);
          if (textContent) {
            doc.font("Helvetica").text(textContent, { continued: shouldContinue, lineGap });
          }
        } else if (token.type === "escape") {
          doc.font("Helvetica").text(token.text || "", { continued: shouldContinue, lineGap });
        } else if (token.tokens && Array.isArray(token.tokens)) {
          renderInlineTokens(token.tokens, shouldContinue);
        } else if (token.raw) {
          const rawContent = cleanText(token.raw, true);
          if (rawContent) {
            doc.font("Helvetica").text(rawContent, { continued: shouldContinue, lineGap });
          }
        }
      });
    };
    tokens.forEach((token, blockIdx) => {
      doc.fontSize(fontSize);
      if (token.type === "heading") {
        const headingSize = token.depth === 1 ? 14 : token.depth === 2 ? 13 : 12;
        doc.moveDown(0.5);
        doc.fontSize(headingSize).font("Helvetica-Bold");
        if (token.tokens) {
          renderInlineTokens(token.tokens, false);
        } else {
          doc.text(token.text || "");
        }
        doc.moveDown(0.5);
      } else if (token.type === "paragraph") {
        doc.fontSize(fontSize);
        if (token.tokens) {
          renderInlineTokens(token.tokens, false);
        } else {
          doc.font("Helvetica").text(token.text || "", { lineGap });
        }
        doc.moveDown(0.8);
      } else if (token.type === "list") {
        token.items.forEach((item, itemIdx) => {
          const prefix = token.ordered ? `${token.start + itemIdx}. ` : "\u2022 ";
          doc.fontSize(fontSize).font("Helvetica").text(prefix, { continued: true, lineGap });
          if (item.tokens) {
            const firstPara = item.tokens.find((t) => t.type === "text" || t.type === "paragraph");
            if (firstPara && firstPara.tokens) {
              renderInlineTokens(firstPara.tokens, false);
            } else if (firstPara) {
              doc.text(firstPara.text || "", { lineGap });
            } else {
              doc.text("", { lineGap });
            }
          } else {
            doc.text(item.text || "", { lineGap });
          }
          doc.moveDown(0.4);
        });
        doc.moveDown(0.4);
      } else if (token.type === "space") {
        doc.moveDown(0.5);
      } else if (token.type === "code") {
        doc.font("Courier").fontSize(10).text(token.text || "", { lineGap: 2 });
        doc.moveDown(0.8);
      } else if (token.raw) {
        doc.fontSize(fontSize).font("Helvetica").text(token.raw.trim(), { lineGap });
        doc.moveDown(0.5);
      }
    });
  };
  app2.get("/api/projects/:id/export-pdf", isAuthenticated, async (req, res) => {
    try {
      const PDFDocument = (await import("pdfkit")).default;
      const project = await storage.getProject(req.params.id);
      const agent4cData = await storage.getAgentData(req.params.id, 4);
      const agent5DataForPdf = await storage.getAgentData(req.params.id, 5);
      if (!project || !agent4cData) {
        return res.status(404).json({ message: "Project or draft not found" });
      }
      const rawDraft = agent4cData.data?.provisionalDraft || {};
      const parsedDraft = parseProvisionalDraft(rawDraft);
      const agent5DataObj = agent5DataForPdf?.data;
      const selectedClaimType = agent5DataObj?.selectedClaimType || "specific";
      let claimsToUse = [];
      if (selectedClaimType === "broad" && agent5DataObj?.broadClaims) {
        claimsToUse = extractClaimsFromBroadData(agent5DataObj.broadClaims);
        if (!claimsToUse || claimsToUse.length === 0) {
          claimsToUse = parsedDraft.claims || [];
        }
      } else {
        claimsToUse = parsedDraft.claims || [];
      }
      const sanitizedClaims = Array.isArray(claimsToUse) ? claimsToUse.map((c) => {
        const rawText = typeof c === "string" ? c : c.text || JSON.stringify(c);
        return cleanClaimFormatting(sanitizeForPDF(rawText));
      }) : [];
      const fixedClaims = fixClaimReferences(sanitizedClaims);
      const draft = {
        title: sanitizeForPDF(parsedDraft.title),
        background: sanitizeForPDF(parsedDraft.background),
        summary: sanitizeForPDF(parsedDraft.summary),
        detailed_description: sanitizeForPDF(parsedDraft.detailed_description),
        ramifications_and_scope: sanitizeForPDF(parsedDraft.ramifications_and_scope),
        abstract: sanitizeForPDF(parsedDraft.abstract),
        claims: fixedClaims
      };
      const doc = new PDFDocument({
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        size: "LETTER"
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=patent-${project.title || req.params.id}.pdf`);
      doc.pipe(res);
      let pdfParaCounter = 1;
      const formatPdfParaNumber = () => {
        const num = pdfParaCounter++;
        return `[${num.toString().padStart(4, "0")}] `;
      };
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const diagrams = agent5Data?.data?.diagrams || [];
      const successfulDiagrams = diagrams.filter((d) => d.imageUrl && d.success !== false);
      doc.fontSize(16).font("Helvetica-Bold").text(draft.title || "Provisional Patent Application", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).font("Helvetica").text(`Category: ${project.category}`, { align: "center" });
      doc.moveDown(1.5);
      if (draft.background) {
        doc.fontSize(14).font("Helvetica-Bold").text("BACKGROUND");
        doc.moveDown(0.5);
        const bgParagraphs = draft.background.split(/\n\n+/).filter((p) => p.trim());
        for (const para of bgParagraphs) {
          doc.font("Helvetica").fontSize(11).text(`${formatPdfParaNumber()}${para.trim()}`, { lineGap: 4 });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }
      if (draft.summary) {
        doc.fontSize(14).font("Helvetica-Bold").text("SUMMARY OF THE INVENTION");
        doc.moveDown(0.5);
        const sumParagraphs = draft.summary.split(/\n\n+/).filter((p) => p.trim());
        for (const para of sumParagraphs) {
          doc.font("Helvetica").fontSize(11).text(`${formatPdfParaNumber()}${para.trim()}`, { lineGap: 4 });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }
      if (successfulDiagrams.length > 0) {
        doc.fontSize(14).font("Helvetica-Bold").text("BRIEF DESCRIPTION OF THE DRAWINGS");
        doc.moveDown(0.5);
        doc.font("Helvetica").fontSize(11).text(
          `${formatPdfParaNumber()}The accompanying drawings, which are incorporated in and form a part of this specification, illustrate embodiments of the invention and, together with the description, serve to explain the principles of the invention.`,
          { lineGap: 4 }
        );
        doc.moveDown(0.5);
        for (let i = 0; i < successfulDiagrams.length; i++) {
          const diagram = successfulDiagrams[i];
          const figNum = diagram.chartNumber || i + 1;
          const figTitle = diagram.title || `Figure ${figNum}`;
          let description = "illustrates";
          if (diagram.chartType) {
            const chartTypeDescriptions = {
              "flowchart": "is a flowchart illustrating",
              "sequence-diagram": "is a sequence diagram showing",
              "entity-relationship-diagram": "is an entity-relationship diagram depicting",
              "cloud-architecture-diagram": "is a cloud architecture diagram showing"
            };
            description = chartTypeDescriptions[diagram.chartType] || "illustrates";
          }
          doc.font("Helvetica").fontSize(11).text(
            `${formatPdfParaNumber()}`,
            { continued: true, lineGap: 4 }
          );
          doc.font("Helvetica-Bold").text(`FIG. ${figNum} `, { continued: true });
          doc.font("Helvetica").text(
            `${description} ${figTitle.toLowerCase()}, in accordance with an embodiment of the present invention.`,
            { lineGap: 4 }
          );
          doc.moveDown(0.5);
        }
        for (let i = 0; i < successfulDiagrams.length; i++) {
          const diagram = successfulDiagrams[i];
          try {
            doc.addPage();
            const imageResponse = await fetch(diagram.imageUrl);
            if (!imageResponse.ok) continue;
            const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
            const diagramTitle = diagram.title || `Figure ${i + 1}`;
            doc.fontSize(14).font("Helvetica-Bold").text(`Figure ${diagram.chartNumber || i + 1}: ${diagramTitle}`, {
              align: "center"
            });
            doc.moveDown(1);
            const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
            const pageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 80;
            doc.image(imageBuffer, {
              fit: [pageWidth, pageHeight],
              align: "center"
            });
          } catch (imgError) {
            console.error(`Failed to add diagram ${i + 1}:`, imgError);
          }
        }
      }
      if (draft.detailed_description) {
        doc.addPage();
        doc.fontSize(14).font("Helvetica-Bold").text("DETAILED DESCRIPTION");
        doc.moveDown(0.5);
        const detParagraphs = draft.detailed_description.split(/\n\n+/).filter((p) => p.trim());
        for (const para of detParagraphs) {
          doc.font("Helvetica").fontSize(11).text(`${formatPdfParaNumber()}${para.trim()}`, { lineGap: 4 });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }
      if (draft.ramifications_and_scope) {
        doc.fontSize(14).font("Helvetica-Bold").text("RAMIFICATIONS AND SCOPE");
        doc.moveDown(0.5);
        const ramParagraphs = draft.ramifications_and_scope.split(/\n\n+/).filter((p) => p.trim());
        for (const para of ramParagraphs) {
          doc.font("Helvetica").fontSize(11).text(`${formatPdfParaNumber()}${para.trim()}`, { lineGap: 4 });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }
      if (draft.claims && Array.isArray(draft.claims) && draft.claims.length > 0) {
        doc.addPage();
        doc.fontSize(14).font("Helvetica-Bold").text("CLAIMS");
        doc.moveDown(0.5);
        doc.font("Helvetica-Oblique").fontSize(11).text("What is claimed is:", { lineGap: 4 });
        doc.moveDown(0.5);
        for (let index = 0; index < draft.claims.length; index++) {
          const claim = draft.claims[index];
          const claimNumber = index + 1;
          let cleanedClaim = claim.trim().replace(/^(?:\*\*)?Claim\s*\d+[:.]\*?\*?\s*/i, "").replace(/^\d+\.\s*/, "").trim();
          const isDependent = /system of claim|method of claim|medium of claim/i.test(cleanedClaim);
          const indent = isDependent ? 20 : 0;
          const numberedClaim = `${claimNumber}. (Original) ${cleanedClaim}`;
          doc.font("Helvetica").fontSize(11).text(numberedClaim, {
            lineGap: 4,
            indent,
            align: "left"
          });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }
      if (draft.abstract) {
        doc.addPage();
        doc.fontSize(14).font("Helvetica-Bold").text("ABSTRACT");
        doc.moveDown(0.5);
        const absParagraphs = draft.abstract.split(/\n\n+/).filter((p) => p.trim());
        for (const para of absParagraphs) {
          doc.font("Helvetica").fontSize(11).text(`${formatPdfParaNumber()}${para.trim()}`, { lineGap: 4 });
          doc.moveDown(0.5);
        }
      }
      doc.end();
    } catch (error) {
      console.error("Export PDF error:", error);
      res.status(500).json({ message: "Failed to export PDF" });
    }
  });
  app2.get("/api/projects/:id/export-docx", isAuthenticated, async (req, res) => {
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import("docx");
      const { marked } = await import("marked");
      const project = await storage.getProject(req.params.id);
      const agent4cData = await storage.getAgentData(req.params.id, 4);
      const agent5DataForDocx = await storage.getAgentData(req.params.id, 5);
      if (!project || !agent4cData) {
        return res.status(404).json({ message: "Project or draft not found" });
      }
      const rawDraft = agent4cData.data?.provisionalDraft || {};
      const parsedDraft = parseProvisionalDraft(rawDraft);
      const processTextForDocx = (text2) => {
        if (!text2) return "";
        let processed = text2.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => {
          return String.fromCharCode(parseInt(code, 16));
        });
        processed = processed.replace(/\|[^|]*\|/g, "").replace(/^\s*\|.*\|.*$/gm, "").replace(/^[-:|]+$/gm, "").replace(/-{5,}/g, "").replace(/## \d+\.\s*Support Map.*$/gm, "").replace(/Claim Limitation.*Reference Numerals.*$/gm, "").replace(/Supporting Specification Excerpt.*$/gm, "").replace(/\n{3,}/g, "\n\n");
        return processed.trim();
      };
      const agent5DocxObj = agent5DataForDocx?.data;
      const selectedClaimType = agent5DocxObj?.selectedClaimType || "specific";
      let claimsToUse = [];
      if (selectedClaimType === "broad" && agent5DocxObj?.broadClaims) {
        claimsToUse = extractClaimsFromBroadData(agent5DocxObj.broadClaims);
        if (!claimsToUse || claimsToUse.length === 0) {
          claimsToUse = parsedDraft.claims || [];
        }
      } else {
        claimsToUse = parsedDraft.claims || [];
      }
      const processedClaims = Array.isArray(claimsToUse) ? claimsToUse.map((c) => {
        const rawText = typeof c === "string" ? c : c.text || JSON.stringify(c);
        return cleanClaimFormatting(processTextForDocx(rawText));
      }) : [];
      const fixedClaims = fixClaimReferences(processedClaims);
      const draft = {
        ...parsedDraft,
        title: processTextForDocx(parsedDraft.title),
        background: processTextForDocx(parsedDraft.background),
        summary: processTextForDocx(parsedDraft.summary),
        detailed_description: processTextForDocx(parsedDraft.detailed_description),
        ramifications_and_scope: processTextForDocx(parsedDraft.ramifications_and_scope),
        abstract: processTextForDocx(parsedDraft.abstract),
        claims: fixedClaims
      };
      const preprocessMarkdown = (text2) => {
        if (!text2) return "";
        return text2.replace(/\[SECTION:\s*([^\]]+)\]/g, "\n\n## $1\n\n").replace(/([.!?)])(\d+)\.\s+/g, "$1\n\n$2. ").replace(/([.!?)])(\*\*[A-Z])/g, "$1\n\n$2").replace(/\n{3,}/g, "\n\n");
      };
      const tokensToTextRuns = (inlineTokens) => {
        const runs = [];
        inlineTokens.forEach((token) => {
          if (token.type === "strong") {
            const text2 = token.tokens ? token.tokens.map((t) => t.text || t.raw || "").join("") : token.text || "";
            if (text2.trim()) {
              runs.push(new TextRun({ text: text2, bold: true }));
            }
          } else if (token.type === "em") {
            const text2 = token.tokens ? token.tokens.map((t) => t.text || t.raw || "").join("") : token.text || "";
            if (text2.trim()) {
              runs.push(new TextRun({ text: text2, italics: true }));
            }
          } else if (token.type === "text" || token.type === "codespan") {
            const text2 = (token.text || token.raw || "").replace(/\*\*/g, "");
            if (text2) {
              runs.push(new TextRun({ text: text2 }));
            }
          } else if (token.tokens && Array.isArray(token.tokens)) {
            runs.push(...tokensToTextRuns(token.tokens));
          } else if (token.raw) {
            const text2 = token.raw.replace(/\*\*/g, "");
            if (text2.trim()) {
              runs.push(new TextRun({ text: text2 }));
            }
          }
        });
        return runs;
      };
      const bodyFontSize = 24;
      const lineSpacing = 288;
      const tokensToTextRunsWithSize = (inlineTokens, fontSize = bodyFontSize) => {
        const runs = [];
        inlineTokens.forEach((token) => {
          if (token.type === "strong") {
            const text2 = token.tokens ? token.tokens.map((t) => t.text || t.raw || "").join("") : token.text || "";
            if (text2.trim()) {
              runs.push(new TextRun({ text: text2, bold: true, size: fontSize }));
            }
          } else if (token.type === "em") {
            const text2 = token.tokens ? token.tokens.map((t) => t.text || t.raw || "").join("") : token.text || "";
            if (text2.trim()) {
              runs.push(new TextRun({ text: text2, italics: true, size: fontSize }));
            }
          } else if (token.type === "text" || token.type === "codespan") {
            const text2 = (token.text || token.raw || "").replace(/\*\*/g, "");
            if (text2) {
              runs.push(new TextRun({ text: text2, size: fontSize }));
            }
          } else if (token.tokens && Array.isArray(token.tokens)) {
            runs.push(...tokensToTextRunsWithSize(token.tokens, fontSize));
          } else if (token.raw) {
            const text2 = token.raw.replace(/\*\*/g, "");
            if (text2.trim()) {
              runs.push(new TextRun({ text: text2, size: fontSize }));
            }
          }
        });
        return runs;
      };
      let usptoParaCounter = 1;
      const formatParaNumber = () => {
        const num = usptoParaCounter++;
        return `[${num.toString().padStart(4, "0")}] `;
      };
      const markdownToParagraphs = (text2, afterSpacing = 240, addNumbering = true) => {
        const paras = [];
        const preprocessed = preprocessMarkdown(text2);
        const tokens = marked.lexer(preprocessed);
        tokens.forEach((token) => {
          if (token.type === "heading") {
            const headingSize = 26;
            paras.push(new Paragraph({
              children: token.tokens ? tokensToTextRunsWithSize(token.tokens, headingSize).map((r) => {
                r.bold = true;
                return r;
              }) : [new TextRun({ text: token.text || "", bold: true, size: headingSize })],
              spacing: { before: 240, after: 120, line: lineSpacing }
            }));
          } else if (token.type === "paragraph") {
            const runs = [];
            if (addNumbering) {
              runs.push(new TextRun({ text: formatParaNumber(), size: bodyFontSize }));
            }
            const contentRuns = token.tokens ? tokensToTextRunsWithSize(token.tokens, bodyFontSize) : [new TextRun({ text: token.text || "", size: bodyFontSize })];
            runs.push(...contentRuns);
            if (runs.length > 0) {
              paras.push(new Paragraph({
                children: runs,
                spacing: { after: afterSpacing, line: lineSpacing }
              }));
            }
          } else if (token.type === "list") {
            token.items.forEach((item, itemIdx) => {
              const prefix = token.ordered ? `${token.start + itemIdx}. ` : "\u2022 ";
              const itemRuns = [];
              if (addNumbering) {
                itemRuns.push(new TextRun({ text: formatParaNumber(), size: bodyFontSize }));
              }
              itemRuns.push(new TextRun({ text: prefix, size: bodyFontSize }));
              if (item.tokens) {
                const firstPara = item.tokens.find((t) => t.type === "text" || t.type === "paragraph");
                if (firstPara && firstPara.tokens) {
                  itemRuns.push(...tokensToTextRunsWithSize(firstPara.tokens, bodyFontSize));
                } else if (firstPara) {
                  itemRuns.push(new TextRun({ text: firstPara.text || "", size: bodyFontSize }));
                }
              } else if (item.text) {
                itemRuns.push(new TextRun({ text: item.text, size: bodyFontSize }));
              }
              paras.push(new Paragraph({
                children: itemRuns,
                spacing: { after: 120, line: lineSpacing },
                indent: { left: 360 }
              }));
            });
          } else if (token.type === "space") {
          } else if (token.raw && token.raw.trim()) {
            const runs = [];
            if (addNumbering) {
              runs.push(new TextRun({ text: formatParaNumber(), size: bodyFontSize }));
            }
            runs.push(new TextRun({ text: token.raw.replace(/\*\*/g, "").trim(), size: bodyFontSize }));
            paras.push(new Paragraph({
              children: runs,
              spacing: { after: afterSpacing, line: lineSpacing }
            }));
          }
        });
        return paras;
      };
      const paragraphs = [];
      const { ImageRun, PageBreak } = await import("docx");
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const diagrams = agent5Data?.data?.diagrams || [];
      const successfulDiagrams = diagrams.filter((d) => d.imageUrl && d.success !== false);
      paragraphs.push(
        new Paragraph({
          text: draft.title || "Provisional Patent Application",
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 }
        }),
        new Paragraph({
          text: `Category: ${project.category}`,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 }
        })
      );
      if (draft.background) {
        paragraphs.push(
          new Paragraph({
            text: "BACKGROUND",
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing }
          }),
          ...markdownToParagraphs(draft.background, 240)
        );
      }
      if (draft.summary) {
        paragraphs.push(
          new Paragraph({
            text: "SUMMARY OF THE INVENTION",
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing }
          }),
          ...markdownToParagraphs(draft.summary, 240)
        );
      }
      if (successfulDiagrams.length > 0) {
        paragraphs.push(
          new Paragraph({
            text: "BRIEF DESCRIPTION OF THE DRAWINGS",
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing }
          })
        );
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: formatParaNumber(), size: bodyFontSize }),
              new TextRun({
                text: "The accompanying drawings, which are incorporated in and form a part of this specification, illustrate embodiments of the invention and, together with the description, serve to explain the principles of the invention.",
                size: bodyFontSize
              })
            ],
            spacing: { after: 240, line: lineSpacing }
          })
        );
        successfulDiagrams.forEach((diagram, i) => {
          const figNum = diagram.chartNumber || i + 1;
          const figTitle = diagram.title || `Figure ${figNum}`;
          let description = "";
          if (diagram.chartType) {
            const chartTypeDescriptions = {
              "flowchart": "is a flowchart illustrating",
              "sequence-diagram": "is a sequence diagram showing",
              "entity-relationship-diagram": "is an entity-relationship diagram depicting",
              "cloud-architecture-diagram": "is a cloud architecture diagram showing"
            };
            description = chartTypeDescriptions[diagram.chartType] || "illustrates";
          } else {
            description = "illustrates";
          }
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: formatParaNumber(), size: bodyFontSize }),
                new TextRun({ text: `FIG. ${figNum} `, bold: true, size: bodyFontSize }),
                new TextRun({ text: `${description} ${figTitle.toLowerCase()}, in accordance with an embodiment of the present invention.`, size: bodyFontSize })
              ],
              spacing: { after: 240, line: lineSpacing }
            })
          );
        });
        const getPngDimensions = (buffer2) => {
          try {
            if (buffer2.length < 24) return null;
            const width = buffer2.readUInt32BE(16);
            const height = buffer2.readUInt32BE(20);
            return { width, height };
          } catch {
            return null;
          }
        };
        for (let i = 0; i < successfulDiagrams.length; i++) {
          const diagram = successfulDiagrams[i];
          try {
            const imageResponse = await fetch(diagram.imageUrl);
            if (!imageResponse.ok) continue;
            const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
            const dimensions = getPngDimensions(imageBuffer);
            let imgWidth = 550;
            let imgHeight = 700;
            if (dimensions) {
              const maxWidth = 550;
              const maxHeight = 700;
              const widthRatio = maxWidth / dimensions.width;
              const heightRatio = maxHeight / dimensions.height;
              const scale = Math.min(widthRatio, heightRatio, 1);
              imgWidth = Math.round(dimensions.width * scale);
              imgHeight = Math.round(dimensions.height * scale);
            }
            const diagramTitle = diagram.title || `Figure ${i + 1}`;
            paragraphs.push(
              new Paragraph({
                children: [new PageBreak()]
              }),
              new Paragraph({
                children: [new TextRun({
                  text: `Figure ${diagram.chartNumber || i + 1}: ${diagramTitle}`,
                  bold: true,
                  size: 28
                })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400, line: lineSpacing }
              }),
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imageBuffer,
                    transformation: { width: imgWidth, height: imgHeight },
                    type: "png"
                  })
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 }
              })
            );
          } catch (imgError) {
            console.error(`Failed to add diagram ${i + 1} to DOCX:`, imgError);
          }
        }
      }
      if (draft.detailed_description) {
        paragraphs.push(
          new Paragraph({
            children: [new PageBreak()]
          }),
          new Paragraph({
            text: "DETAILED DESCRIPTION",
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing }
          }),
          ...markdownToParagraphs(draft.detailed_description, 240)
        );
      }
      if (draft.ramifications_and_scope) {
        paragraphs.push(
          new Paragraph({
            text: "RAMIFICATIONS AND SCOPE",
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing }
          }),
          ...markdownToParagraphs(draft.ramifications_and_scope, 240)
        );
      }
      if (draft.claims && Array.isArray(draft.claims) && draft.claims.length > 0) {
        paragraphs.push(
          new Paragraph({
            children: [new PageBreak()]
          }),
          new Paragraph({
            text: "CLAIMS",
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing }
          })
        );
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: "What is claimed is:", size: bodyFontSize, italics: true })],
            spacing: { after: 240, line: lineSpacing }
          })
        );
        draft.claims.forEach((claim, index) => {
          const claimNumber = index + 1;
          let cleanedClaim = claim.trim().replace(/^(?:\*\*)?Claim\s*\d+[:.]\*?\*?\s*/i, "").replace(/^\d+\.\s*/, "").replace(/\*\*/g, "").trim();
          const isDependent = /system of claim|method of claim|medium of claim/i.test(cleanedClaim);
          const numberedClaim = `${claimNumber}. (Original) ${cleanedClaim}`;
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: numberedClaim, size: bodyFontSize })],
              spacing: { after: 240, line: lineSpacing },
              indent: isDependent ? { left: 360 } : void 0
              // Indent dependent claims
            })
          );
        });
      }
      if (draft.abstract) {
        paragraphs.push(
          new Paragraph({
            children: [new PageBreak()]
          }),
          new Paragraph({
            text: "ABSTRACT",
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing }
          }),
          ...markdownToParagraphs(draft.abstract, 240)
        );
      }
      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs
        }]
      });
      const buffer = await Packer.toBuffer(doc);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename=patent-${project.title || req.params.id}.docx`);
      res.send(buffer);
    } catch (error) {
      console.error("Export DOCX error:", error);
      res.status(500).json({ message: "Failed to export DOCX" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/app.ts
var app = express();
app.set("trust proxy", 1);
if (process.env.NODE_ENV === "development") {
  app.use(cors({
    origin: "http://localhost:5000",
    credentials: true
  }));
}
app.use(express.json({
  limit: "10mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: "10mb" }));
app.use((req, res, next) => {
  const start = Date.now();
  const path2 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path2.startsWith("/api")) {
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 2e3) {
        logLine = logLine.slice(0, 1999) + "\u2026";
      }
      console.log(logLine);
    }
  });
  next();
});
var initialized = false;
var initPromise = null;
async function ensureInitialized() {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await registerRoutes(app);
    app.use((err, _req, res, _next) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
    });
    initialized = true;
  })();
  return initPromise;
}
ensureInitialized();

// server-entry/vercel.ts
async function handler(req, res) {
  await ensureInitialized();
  app(req, res);
}
export {
  handler as default
};
