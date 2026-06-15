import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import https from "https";
import crypto from "crypto";
import { storage } from "./storage";
import { pool, db } from "./db";
import { insertProjectSchema, aiUsageLog, provenanceEvents, provenanceStamps, provenanceAnchors } from "@shared/schema";
import { runWithUsageContext } from "./ai/request-context";
import { and as drizzleAnd, gte as drizzleGte, lte as drizzleLte, eq as drizzleEq, asc as drizzleAsc, desc as drizzleDesc, sql as drizzleSql } from "drizzle-orm";
import { TERMS_VERSION } from "@shared/terms";
import { applyDraftEdit, findDraftMatches } from "@shared/draft-match";
import { z } from "zod";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { generateSecret, generateURI, verify as verifyTOTP } from "otplib";
import QRCode from "qrcode";
import {
  runQAAssistant,
  getQAMessages,
  getQALog,
  getQAOpenQuestions,
  addManualLogEntry,
  patchLogEntry,
  patchOpenQuestion,
} from "./modules/module0/qa-assistant";
import { runDebate } from "./modules/module1/1a-debate/debate";
import { runMechanic } from "./modules/module1/mechanic/mechanic";
import { runReanalyze } from "./modules/module1/1b-reanalyze/reanalyze";
import { runR3Fixes } from "./modules/module1/1c-mechanical-fixes/r3-fixes";
import { runListCreator } from "./modules/module1/1d-list-creator/list-creator";
import { runAiModifier } from "./modules/module1/1e-ai-modifier/ai-modifier";
import { runDraft } from "./modules/module2/2a-draft/draft";
import { runExtractConcepts } from "./modules/module2/2b-extract-concepts/extract-concepts";
import { runWhitespace } from "./modules/module4/4a-whitespace/whitespace";
import { runClaims } from "./modules/module4/4b-key-concepts/claims";
import { runPannuQuestions, runPannuScorer } from "./modules/module4/4c-pannu/pannu";
import {
  createFamily,
  getFamily,
  listFamiliesByOwner,
  updateFamily,
  softDeleteFamily,
  attachProjectToFamily,
  attachManyProjectsToFamily,
  detachProjectFromFamily,
  listProjectsInFamily,
  getSiblingsReference,
  findOverlapsInFamily,
  sessionOwnsFamily,
} from "./lib/families";
import {
  uploadFamilyContextFile,
  listFamilyContextFiles,
  getFamilyContextFileExtractedText,
  getFamilyContextFileBytes,
  softDeleteFamilyContextFile,
  updateFamilyContextFileMetadata,
  validateUpload,
} from "./lib/family-context-files";
import { requireEnv, requireEnvList } from "./lib/env";
import { sendServerError } from "./lib/error-response";
import { createZipArchive } from "./lib/archiver-loader";
import {
  SALT_ROUNDS,
  getSession,
  isAuthenticated,
  loadAuthUser,
  withAuthUser,
  findUserByEmailAcrossTables,
  findUserByIdAcrossTables,
  update2FAByKind,
  updatePasswordByKind,
  sessionOwnsProject,
  ADMIN_EMAILS,
  isAdmin,
  isActiveSubscriber,
  type UserKind,
  type AuthUser,
  type AuthLookup,
} from "./lib/auth-middleware";
import { createCheckpointBackground } from "./lib/provenance/checkpoint";
import { verifyChain } from "./lib/provenance/hash-chain";
import { TSA_PROVIDERS } from "./lib/provenance/tsa-providers";
import { runDailyAnchor } from "./lib/provenance/anchor";
import { buildMerkleTree } from "./lib/provenance/merkle";
import { buildPoHCDocx } from "./lib/pohc-docx";
import { recordHumanInput, deleteHumanInput, listHumanInputs } from "./modules/human-inputs/ledger";
import { buildPannuPrefill } from "./modules/human-inputs/prefill";
import { HUMAN_INPUT_TAGS } from "./modules/human-inputs/tags";
import { runPannuSuggestion } from "./modules/module4/4d-suggestion/suggestion";
import { runDiagrams } from "./modules/module5/5b-diagrams/diagrams";
import { runBroaderClaims } from "./modules/module5/5c-broader-key-concepts/broader-claims";
import { runProvisional } from "./modules/module5/5a-provisional/provisional";

// RFC 4122 UUID v1–v5. Used to validate path params before DB lookups so
// we don't pass arbitrary user input through query layers or log noise.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const registerRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string(),
});

// Agent processing timeout - 15 minutes for complex AI operations
const AGENT_TIMEOUT = 900000; // 15 minutes in milliseconds

// Webhook URLs for the remaining n8n agents (prior-art + practitioner-match
// are the last two endpoints not yet migrated to direct AI calls).
//
// Migrated → live in server/modules/:
//   N8N_MECHANIC_WEBHOOK          → module1/mechanic/mechanic.ts
//   N8N_DRAFT_PROVISIONAL_WEBHOOK → module2/2a-draft/draft.ts (via /agent/2/draft)
//   N8N_QA_ASSISTANT_WEBHOOK      → module0/qa-assistant.ts
//
// Deleted (declared here historically but never read from routes.ts after
// migration): WHITESPACE, PROVISIONAL, DIAGRAMS, PANNU_QUESTIONS,
// PANNU_VALIDATE, PANNU_AI_SUGGESTION, CLAIMS, BROADER_CLAIMS. Remove the
// matching env vars from .env and Vercel.
const N8N_PRACTITIONER_MATCH_WEBHOOK = requireEnv("N8N_PRACTITIONER_MATCH_WEBHOOK");
const N8N_QUICK_PRIOR_ART_WEBHOOK = requireEnv("N8N_QUICK_PRIOR_ART_WEBHOOK");
const N8N_MULTI_CONCEPT_SEARCH_WEBHOOK = requireEnv("N8N_MULTI_CONCEPT_SEARCH_WEBHOOK");

// Intent detection patterns for routing messages to Mechanic (1B) vs Brainstorm (1A)
const MECHANIC_INTENT_PATTERNS = [
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
  /i (want|need|would like) (to\s+)?(add|fix|delete|remove|change|modify|update|improve|replace|include|discard)/i,
];

function detectMechanicIntent(message: string): { isMechanic: boolean; command?: string; target?: string } {
  const trimmed = message.trim().toLowerCase();
  
  for (const pattern of MECHANIC_INTENT_PATTERNS) {
    if (pattern.test(trimmed)) {
      // Extract the action word
      const actionMatch = trimmed.match(/\b(add|fix|delete|remove|change|modify|update|improve|replace|include|discard)\b/i);
      const action = actionMatch ? actionMatch[1] : 'modify';
      
      return {
        isMechanic: true,
        command: action,
        target: message, // The full message as the target
      };
    }
  }
  
  return { isMechanic: false };
}

// Helper function to send JSON webhooks using native https module
function sendWebhook(url: string, payload: any, timeout: number = AGENT_TIMEOUT): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const jsonPayload = JSON.stringify(payload);
    
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonPayload),
      },
      timeout: timeout,
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
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

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(jsonPayload);
    req.end();
  });
}

// Auth middleware (getSession, isAuthenticated, loadAuthUser, withAuthUser,
// find*AcrossTables, update*ByKind, sessionOwnsProject, ADMIN_EMAILS, isAdmin,
// isActiveSubscriber) and types (UserKind, AuthUser, AuthLookup) plus the
// bcrypt SALT_ROUNDS constant now live in ./lib/auth-middleware so each route
// domain can import a single canonical copy. See the import block at the top
// of this file.

// Helper function to clear downstream agent data when earlier stages are re-run
// This ensures users always see fresh data when they redo any part of the process
async function clearDownstreamData(projectId: string, fromStage: string) {
  console.log(`Clearing downstream data from stage: ${fromStage} for project: ${projectId}`);
  
  // Define what gets cleared based on which stage is being re-run
  const clearActions: Record<string, { agents: number[], agent4Fields?: string[] }> = {
    // Stage 1: Brainstorming - clears everything downstream
    '1': { agents: [2, 3, 4, 5] },
    '1a': { agents: [2, 3, 4, 5] },
    '1a-reanalyze': { agents: [2, 3, 4, 5] },
    '1-extract': { agents: [2, 3, 4, 5] },
    
    // Stage 2a: Concept expansion - clears 2b onwards
    '2a': { agents: [3, 4, 5] }, // 2b data is part of agent 2
    
    // Stage 2b: Extract/select ideas - clears 3 onwards
    '2b': { agents: [3, 4, 5] },
    
    // Stage 3: Prior art - clears 4 onwards  
    '3': { agents: [4, 5] },
    
    // Stage 4a: White space - clears claims, provisional, diagrams
    '4a': { 
      agents: [5], 
      agent4Fields: ['claimVariations', 'selectedKeyConcepts', 'selectedVariationId', 'editedClaims', 'rawClaimsResponse', 'claimsGeneratedAt', 'claimsSelectedAt', 'provisionalDraft', 'provisionalGeneratedAt']
    },
    
    // Stage 4 claims: Clears selected claims, provisional, diagrams
    '4-claims': { 
      agents: [5],
      agent4Fields: ['selectedKeyConcepts', 'selectedVariationId', 'editedClaims', 'claimsSelectedAt', 'provisionalDraft', 'provisionalGeneratedAt']
    },
    
    // Stage 4b: Select claims - clears provisional, diagrams
    '4b': { 
      agents: [5],
      agent4Fields: ['provisionalDraft', 'provisionalGeneratedAt']
    },
    
    // Stage 4c: Provisional - clears diagrams only
    '4c': { agents: [5] },
  };
  
  const action = clearActions[fromStage];
  if (!action) {
    console.log(`No clear action defined for stage: ${fromStage}`);
    return;
  }
  
  // Clear full agent data for specified agents
  for (const agentNum of action.agents) {
    try {
      await storage.deleteAgentData(projectId, agentNum);
      console.log(`Cleared agent ${agentNum} data for project ${projectId}`);
    } catch (err) {
      console.log(`No agent ${agentNum} data to clear or error:`, err);
    }
  }
  
  // Clear specific fields from agent 4 if specified
  if (action.agent4Fields && action.agent4Fields.length > 0) {
    try {
      const agent4Data = await storage.getAgentData(projectId, 4);
      if (agent4Data?.data) {
        const existingData = { ...agent4Data.data } as Record<string, any>;
        for (const field of action.agent4Fields) {
          delete existingData[field];
        }
        await storage.upsertAgentData({
          projectId,
          agentNumber: 4,
          data: existingData
        });
        console.log(`Cleared agent 4 fields: ${action.agent4Fields.join(', ')}`);
      }
    } catch (err) {
      console.log(`Error clearing agent 4 fields:`, err);
    }
  }
}

// Known real users — always seeded if whitelist is empty
const KNOWN_WHITELIST_EMAILS: { email: string; note: string }[] = [
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
  { email: "gazalew@gmail.com", note: "Gary" },
];

async function seedWhitelistIfEmpty() {
  try {
    const existing = await storage.getWhitelistedEmails();
    const existingEmails = new Set(existing.map(e => e.email.toLowerCase()));
    const missing = KNOWN_WHITELIST_EMAILS.filter(e => !existingEmails.has(e.email.toLowerCase()));
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

export async function registerRoutes(app: Express): Promise<Server> {
  // Seed whitelist in background — don't block cold start on DB round-trip
  seedWhitelistIfEmpty().catch(err => console.error("[whitelist] Seed error:", err));

  // Session middleware
  app.use(getSession());

  // Block AI/n8n actions for read-only (lapsed) subscribers
  // Applies to all POST requests under /api/projects and /api/prior-art-check
  app.use(["/api/projects", "/api/prior-art-check"], (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET") return next(); // reads always allowed
    const status = (req.session as any)?.whitelistStatus;
    if (status === "read_only") {
      return res.status(403).json({
        message: "Your subscription has lapsed. Please renew to continue building.",
        code: "SUBSCRIPTION_LAPSED",
      });
    }
    return next();
  });

  // ============================================
  // Authentication Routes
  // ============================================

  // Register new user
  app.post("/api/auth/register", async (req, res) => {
    try {
      if (req.body?.termsAccepted !== true || req.body?.termsVersion !== TERMS_VERSION) {
        return res.status(400).json({
          message: "You must accept the current Terms of Service before creating an account.",
        });
      }

      const { email, password } = registerRequestSchema.parse(req.body);
      // All public self-serve registration is now closed. Paid accounts must come
      // through the GHL checkout webhook; legacy accounts are admin-provisioned via
      // server-side scripts only. Both kinds are rejected here so the public
      // /api/auth/register endpoint can't be used to bypass the paywall.
      const kind: UserKind = req.body?.kind === "legacy" ? "legacy" : "paid";
      if (kind === "paid") {
        return res.status(403).json({
          message: "Paid accounts must be created through checkout. Please complete your purchase to receive access.",
        });
      }
      // Legacy registration also requires the admin secret to prevent paywall
      // bypass. Without it, public POSTs with kind=legacy are rejected.
      const adminSecret = req.headers["x-admin-secret"];
      if (kind === "legacy" && (!process.env.LEGACY_REGISTER_SECRET || adminSecret !== process.env.LEGACY_REGISTER_SECRET)) {
        return res.status(403).json({
          message: "Account creation is closed. Please complete your purchase to receive access.",
        });
      }

      const passwordRequirements = [
        { test: password.length >= 8, message: "Password must be at least 8 characters" },
        { test: /[A-Z]/.test(password), message: "Password must contain at least one uppercase letter" },
        { test: /[a-z]/.test(password), message: "Password must contain at least one lowercase letter" },
        { test: /\d/.test(password), message: "Password must contain at least one number" },
        { test: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password), message: "Password must contain at least one special character" },
      ];
      const failedRequirement = passwordRequirements.find(req => !req.test);
      if (failedRequirement) {
        return res.status(400).json({ message: failedRequirement.message });
      }

      // Cross-table uniqueness: an email exists in at most one of users / inventors_users.
      const existingLegacy = await storage.getUserByEmail(email);
      const existingInventor = await storage.getInventorUserByEmail(email);
      if (existingLegacy || existingInventor) {
        return res.status(400).json({ message: "User already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      let newId: string;
      // Cast defeats flow-narrowing: the paid guard above always returns, so TS
      // narrows `kind` to "legacy" here. The paid branch is intentionally kept
      // (latent path for if checkout-bypass registration is ever reopened).
      if ((kind as UserKind) === "paid") {
        const user = await storage.createInventorUser({ email, password: hashedPassword });
        newId = user.id;
      } else {
        const user = await storage.createUser({ email, password: hashedPassword });
        newId = user.id;
      }

      // Auto-whitelist: register open to everyone now, but preserve the whitelist as a
      // future gate we can re-enable without locking existing users out.
      try {
        const already = await storage.isEmailWhitelisted(email);
        if (!already) {
          await storage.addEmailToWhitelist(email, `auto-added on ${kind} signup`);
        }
      } catch (e) {
        console.error("Auto-whitelist failed (non-fatal):", e);
      }

      (req.session as any).userId = newId;
      (req.session as any).userKind = kind;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.json({ id: newId, email, kind });
    } catch (error: any) {
      console.error("Registration error:", error);
      sendServerError(res, error, "Registration failed", 400);
    }
  });

  // Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      // Whitelist gate is currently disabled (freemium). Kept in DB so we can re-enable later.
      // Try inventors_users first (PatentGeyser customers), fall back to shared users table.
      const inventorUser = await storage.getInventorUserByEmail(email);
      const legacyUser = inventorUser ? undefined : await storage.getUserByEmail(email);
      const matched = inventorUser
        ? { kind: "paid" as const, record: inventorUser }
        : legacyUser
          ? { kind: "legacy" as const, record: legacyUser }
          : null;

      if (!matched) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const isValid = await bcrypt.compare(password, matched.record.password);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const whitelistEntry = await storage.getWhitelistEntry(email);
      const whitelistStatus = whitelistEntry?.status || "active";

      (req.session as any).userId = matched.record.id;
      (req.session as any).userKind = matched.kind;
      (req.session as any).whitelistStatus = whitelistStatus;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      if (!matched.record.twoFactorEnabled) {
        if (matched.kind === "paid") {
          storage.updateInventorUserLastLogin(matched.record.id).catch(() => {});
        } else {
          storage.updateLastLogin(matched.record.id).catch(() => {});
        }
      }

      res.json({
        id: matched.record.id,
        email: matched.record.email,
        kind: matched.kind,
        requires2FA: matched.record.twoFactorEnabled || false,
      });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(400).json({ message: "Login failed" });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // ============================================
  // Admin Users Overview
  // ============================================

  app.get("/api/admin/users", isAdmin, async (req, res) => {
    try {
      const users = await storage.getAdminUsers();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // List PatentGeyser inventor users with their project usage.
  app.get("/api/admin/inventors-users", isAdmin, async (req, res) => {
    try {
      const list = await storage.getInventorUsersAdminView();
      res.json(list);
    } catch (error: any) {
      console.error("List inventor users error:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/admin/inventors-users/:id/project-limit", isAdmin, async (req, res) => {
    try {
      const { projectLimit } = req.body;
      const parsed = Number(projectLimit);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) {
        return res.status(400).json({ message: "projectLimit must be an integer between 0 and 10000" });
      }
      const user = await storage.setInventorUserProjectLimit(req.params.id, parsed);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({ id: user.id, projectLimit: user.projectLimit });
    } catch (error: any) {
      console.error("Set project limit error:", error);
      res.status(500).json({ message: "Failed to update project limit" });
    }
  });

  // ============================================
  // Email Whitelist Management (admin, authenticated)
  // ============================================

  // Get all whitelisted emails
  app.get("/api/admin/whitelist", isAdmin, async (req, res) => {
    try {
      const entries = await storage.getWhitelistedEmails();
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch whitelist" });
    }
  });

  // Add an email to the whitelist
  app.post("/api/admin/whitelist", isAdmin, async (req, res) => {
    try {
      const { email, note } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }
      const entry = await storage.addEmailToWhitelist(email, note);
      res.json(entry);
    } catch (error: any) {
      if (error.message?.includes("unique")) {
        return res.status(409).json({ message: "Email is already whitelisted" });
      }
      res.status(500).json({ message: "Failed to add email to whitelist" });
    }
  });

  // Remove an email from the whitelist
  app.delete("/api/admin/whitelist/:email", isAdmin, async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      await storage.removeEmailFromWhitelist(email);
      res.json({ message: "Email removed from whitelist" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to remove email from whitelist" });
    }
  });

  // Update whitelist status (active / read_only)
  app.patch("/api/admin/whitelist/:email/status", isAdmin, async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const { status } = req.body;
      if (!status || !["active", "read_only"].includes(status)) {
        return res.status(400).json({ message: "status must be 'active' or 'read_only'" });
      }
      const entry = await storage.updateWhitelistStatus(email, status);
      res.json(entry);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  // ============================================
  // AI Usage Log — admin observability for token spend
  // GET /api/admin/usage         → rows + summary for a filter window
  // GET /api/admin/usage/export  → CSV download of the same query
  // ============================================

  function parseUsageFilters(req: Request) {
    const q = req.query as Record<string, string | undefined>;
    const conds: any[] = [];

    // Date range. Defaults to last 7 days when neither is provided.
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const from = q.from ? new Date(q.from) : defaultFrom;
    const to = q.to ? new Date(q.to) : now;
    if (Number.isFinite(from.getTime())) {
      conds.push(drizzleGte(aiUsageLog.createdAt, from));
    }
    if (Number.isFinite(to.getTime())) {
      conds.push(drizzleLte(aiUsageLog.createdAt, to));
    }

    if (q.userEmail) conds.push(drizzleEq(aiUsageLog.userEmail, q.userEmail));
    if (q.agentLabel) conds.push(drizzleEq(aiUsageLog.agentLabel, q.agentLabel));
    if (q.model) conds.push(drizzleEq(aiUsageLog.model, q.model));
    if (q.status) conds.push(drizzleEq(aiUsageLog.status, q.status));

    return {
      where: conds.length ? drizzleAnd(...conds) : undefined,
      from,
      to,
    };
  }

  app.get("/api/admin/usage", isAdmin, async (req, res) => {
    try {
      const { where, from, to } = parseUsageFilters(req);
      const limit = Math.min(parseInt((req.query.limit as string) || "200", 10) || 200, 1000);
      const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0);

      const rowsQuery = db
        .select()
        .from(aiUsageLog)
        .orderBy(drizzleDesc(aiUsageLog.createdAt))
        .limit(limit)
        .offset(offset);
      const rows = where ? await rowsQuery.where(where) : await rowsQuery;

      // Aggregates over the same filter window (NOT limited to the page).
      // Returned alongside rows so the page can render summary cards.
      const aggBase = db
        .select({
          totalCalls: drizzleSql<number>`count(*)::int`,
          totalInput: drizzleSql<number>`coalesce(sum(${aiUsageLog.inputTokens}), 0)::bigint`,
          totalOutput: drizzleSql<number>`coalesce(sum(${aiUsageLog.outputTokens}), 0)::bigint`,
          totalCached: drizzleSql<number>`coalesce(sum(${aiUsageLog.cachedTokens}), 0)::bigint`,
          totalTokens: drizzleSql<number>`coalesce(sum(${aiUsageLog.totalTokens}), 0)::bigint`,
          totalDurationMs: drizzleSql<number>`coalesce(sum(${aiUsageLog.durationMs}), 0)::bigint`,
        })
        .from(aiUsageLog);
      const [summary] = where ? await aggBase.where(where) : await aggBase;

      const byModelBase = db
        .select({
          model: aiUsageLog.model,
          calls: drizzleSql<number>`count(*)::int`,
          inputTokens: drizzleSql<number>`coalesce(sum(${aiUsageLog.inputTokens}), 0)::bigint`,
          outputTokens: drizzleSql<number>`coalesce(sum(${aiUsageLog.outputTokens}), 0)::bigint`,
          totalTokens: drizzleSql<number>`coalesce(sum(${aiUsageLog.totalTokens}), 0)::bigint`,
        })
        .from(aiUsageLog)
        .groupBy(aiUsageLog.model);
      const byModel = where ? await byModelBase.where(where) : await byModelBase;

      const byAgentBase = db
        .select({
          agentLabel: aiUsageLog.agentLabel,
          calls: drizzleSql<number>`count(*)::int`,
          totalTokens: drizzleSql<number>`coalesce(sum(${aiUsageLog.totalTokens}), 0)::bigint`,
        })
        .from(aiUsageLog)
        .groupBy(aiUsageLog.agentLabel);
      const byAgent = where ? await byAgentBase.where(where) : await byAgentBase;

      const byUserBase = db
        .select({
          userEmail: aiUsageLog.userEmail,
          calls: drizzleSql<number>`count(*)::int`,
          totalTokens: drizzleSql<number>`coalesce(sum(${aiUsageLog.totalTokens}), 0)::bigint`,
        })
        .from(aiUsageLog)
        .groupBy(aiUsageLog.userEmail);
      const byUser = where ? await byUserBase.where(where) : await byUserBase;

      res.json({
        window: { from, to },
        summary,
        byModel,
        byAgent,
        byUser,
        rows,
        pagination: { limit, offset, returned: rows.length },
      });
    } catch (error: any) {
      console.error("[admin/usage] query failed:", error);
      sendServerError(res, error, "Failed to fetch usage");
    }
  });

  app.get("/api/admin/usage/export", isAdmin, async (req, res) => {
    try {
      const { where } = parseUsageFilters(req);
      const rowsQuery = db
        .select()
        .from(aiUsageLog)
        .orderBy(drizzleDesc(aiUsageLog.createdAt))
        .limit(50000); // hard cap to keep memory bounded
      const rows = where ? await rowsQuery.where(where) : await rowsQuery;

      const cols = [
        "createdAt", "userEmail", "projectId", "agentLabel", "model",
        "inputTokens", "outputTokens", "cachedTokens", "totalTokens",
        "durationMs", "status", "fallbackFrom", "usedSecondaryKey",
        "requestId", "errorMessage",
      ];
      const escape = (v: any): string => {
        if (v === null || v === undefined) return "";
        const s = v instanceof Date ? v.toISOString() : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [cols.join(",")];
      for (const r of rows as any[]) {
        lines.push(cols.map((c) => escape(r[c])).join(","));
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ai-usage-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(lines.join("\n"));
    } catch (error: any) {
      console.error("[admin/usage/export] failed:", error);
      sendServerError(res, error, "Failed to export usage");
    }
  });

  // Public webhook endpoint — add email to whitelist via API key (for GHL / n8n)
  // POST /api/webhook/whitelist-add
  // Headers: x-api-key: <WHITELIST_API_KEY>
  // Body: { "email": "user@example.com", "note": "optional label" }
  app.post("/api/webhook/whitelist-add", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.WHITELIST_API_KEY;

    if (!expectedKey) {
      return res.status(500).json({ message: "Webhook API key not configured on server" });
    }
    if (!apiKey || apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized — invalid or missing API key" });
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
    } catch (error: any) {
      if (error.message?.includes("unique")) {
        return res.status(409).json({ success: false, message: "Email is already whitelisted" });
      }
      console.error("[whitelist-webhook] Error:", error);
      return res.status(500).json({ success: false, message: "Failed to add email to whitelist" });
    }
  });

  // Webhook: suspend a user (set to read_only) — for subscription lapse automation
  // POST /api/webhook/whitelist-suspend
  // Headers: x-api-key: <WHITELIST_API_KEY>
  // Body: { "email": "user@example.com" }
  app.post("/api/webhook/whitelist-suspend", async (req, res) => {
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
    } catch (error: any) {
      console.error("[whitelist-webhook] Suspend error:", error);
      return res.status(404).json({ success: false, message: "Email not found in whitelist" });
    }
  });

  // Webhook: reactivate a user (set back to active)
  // POST /api/webhook/whitelist-reactivate
  // Headers: x-api-key: <WHITELIST_API_KEY>
  // Body: { "email": "user@example.com" }
  app.post("/api/webhook/whitelist-reactivate", async (req, res) => {
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
    } catch (error: any) {
      console.error("[whitelist-webhook] Reactivate error:", error);
      return res.status(404).json({ success: false, message: "Email not found in whitelist" });
    }
  });

  // Public endpoint — exposes the EPD/Collect.js tokenization key (NOT the security key)
  // so the /buy page can mount the inline card form. Tokenization keys are designed
  // to live in the browser; they cannot charge cards on their own.
  app.get("/api/public/epd-config", (_req, res) => {
    res.json({ publicKey: process.env.EPD_PUBLIC_KEY || null });
  });

  // Stateless signup-token helpers. Tokens are HMAC-signed strings of the form
  // `<base64url(payload)>.<hex hmac>` where payload = JSON({ e: email, x: exp_ms }).
  // No server-side storage — survives serverless cold starts, scales to N instances.
  // Single-use is approximated by clearing the user's throwaway password on
  // successful set; replays after that fail because the user already has a real password.
  const SIGNUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  function getSignupTokenSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (!s) throw new Error("SESSION_SECRET not configured — required for signup tokens");
    return s;
  }

  function issueSignupToken(email: string): string {
    const payload = JSON.stringify({ e: email, x: Date.now() + SIGNUP_TOKEN_TTL_MS });
    const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
    const sig = crypto
      .createHmac("sha256", getSignupTokenSecret())
      .update(payloadB64)
      .digest("hex");
    return `${payloadB64}.${sig}`;
  }

  function verifySignupToken(token: string): { email: string } | { error: string } {
    if (typeof token !== "string" || !token.includes(".")) {
      return { error: "Invalid token" };
    }
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return { error: "Invalid token" };

    const expectedSig = crypto
      .createHmac("sha256", getSignupTokenSecret())
      .update(payloadB64)
      .digest("hex");
    // Constant-time compare to avoid timing attacks.
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expectedSig, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { error: "Invalid token" };
    }

    let payload: { e?: unknown; x?: unknown };
    try {
      payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    } catch {
      return { error: "Invalid token" };
    }

    if (typeof payload.e !== "string" || typeof payload.x !== "number") {
      return { error: "Invalid token" };
    }
    if (payload.x < Date.now()) {
      return { error: "Token expired" };
    }
    return { email: payload.e };
  }

  // EPD / NMI checkout — native order form on /buy.
  // Browser tokenizes the card with Collect.js and POSTs us {email, packId, paymentToken}.
  // We map packId → {amount, credits} server-side (never trust client price), charge via
  // NMI's transact.php, and on approval provision the account exactly like the GHL webhook.
  // POST /api/checkout/epd
  const EPD_PACKS: Record<string, { amount: string; credits: number; label: string }> = {
    pack_1:  { amount: "299.00",  credits: 1, label: "1 Project Credit" },
    pack_5:  { amount: "1160.00", credits: 5, label: "5 Project Credits" },
  };

  app.post("/api/checkout/epd", async (req, res) => {
    try {
      const securityKey = process.env.EPD_SECURITY_KEY;
      if (!securityKey) {
        console.error("[epd] EPD_SECURITY_KEY not configured");
        return res.status(500).json({ message: "Checkout not configured." });
      }

      const body = req.body || {};
      const requiredFields = [
        "firstName", "lastName", "email", "phone",
        "cardholderName", "address", "city", "zip", "country",
        "packId", "paymentToken",
      ];
      for (const f of requiredFields) {
        if (typeof body[f] !== "string" || !body[f].trim()) {
          return res.status(400).json({ message: `${f} is required` });
        }
      }
      const {
        firstName, lastName, email, phone, cardholderName,
        address, city, zip, country, packId, paymentToken,
      } = body as Record<string, string>;

      const pack = EPD_PACKS[packId];
      if (!pack) return res.status(400).json({ message: "Invalid pack." });

      const normalizedEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ message: "Invalid email." });
      }
      if (country.trim().length !== 2) {
        return res.status(400).json({ message: "Country must be a 2-letter ISO code." });
      }

      // Block if email already exists as a legacy account — same rule as the GHL webhook.
      const existingLegacy = await storage.getUserByEmail(normalizedEmail);
      if (existingLegacy) {
        return res.status(409).json({
          message: "Email already exists as a legacy account. Contact support.",
        });
      }

      // Charge via NMI transact.php (form-encoded). All AVS/billing fields are
      // forwarded so NMI runs full AVS + CVV checks — anti-fraud wall.
      const params = new URLSearchParams({
        type: "sale",
        security_key: securityKey,
        amount: pack.amount,
        payment_token: paymentToken,
        currency: "USD",
        order_description: pack.label,
        first_name: firstName.trim().slice(0, 50),
        last_name: lastName.trim().slice(0, 50),
        email: normalizedEmail,
        phone: phone.trim().slice(0, 30),
        address1: address.trim().slice(0, 100),
        city: city.trim().slice(0, 50),
        zip: zip.trim().slice(0, 20),
        country: country.trim().toUpperCase(),
      });

      const nmiRes = await fetch("https://secure.nmi.com/api/transact.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const nmiText = await nmiRes.text();
      const nmi = Object.fromEntries(new URLSearchParams(nmiText));

      if (nmi.response !== "1") {
        // 2 = decline, 3 = error. Surface the gateway's reason if present, but
        // never the auth/security details.
        console.warn(
          `[epd] Charge failed for ${normalizedEmail} pack=${packId} response=${nmi.response} ` +
            `responsetext=${nmi.responsetext} response_code=${nmi.response_code}`,
        );
        const reason =
          nmi.responsetext && nmi.responsetext.length < 200
            ? nmi.responsetext
            : "Payment declined.";
        return res.status(402).json({ message: reason });
      }

      console.log(
        `[epd] Approved: ${normalizedEmail} $${pack.amount} txn=${nmi.transactionid} pack=${packId}`,
      );

      // Post-purchase webhook payload — personal info and order details only.
      // Sensitive payment data (card, CVV, token, security key) is intentionally
      // excluded. Fire-and-forget; failures must NOT break the checkout.
      const POST_PURCHASE_WEBHOOK = process.env.POST_PURCHASE_WEBHOOK || "";
      const firePostPurchaseWebhook = async (mode: "created" | "topup", userId: string) => {
        if (!POST_PURCHASE_WEBHOOK) {
          console.log("[epd] POST_PURCHASE_WEBHOOK not configured — skipping.");
          return;
        }
        try {
          await sendWebhook(
            POST_PURCHASE_WEBHOOK,
            {
              event: "purchase_completed",
              mode, // "created" (new account) or "topup" (existing account)
              user: {
                id: userId,
                email: normalizedEmail,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                phone: phone.trim(),
                address: address.trim(),
                city: city.trim(),
                zip: zip.trim(),
                country: country.trim().toUpperCase(),
              },
              order: {
                packId,
                packLabel: pack.label,
                credits: pack.credits,
                amount: pack.amount,
                currency: "USD",
                transactionId: nmi.transactionid || null,
                authCode: nmi.authcode || null,
              },
              timestamp: new Date().toISOString(),
            },
            30000,
          );
          console.log(`[epd] Post-purchase webhook fired (${mode}) for ${normalizedEmail}`);
        } catch (e) {
          console.error("[epd] Post-purchase webhook failed (non-fatal):", e);
        }
      };

      // Provision/top-up account.
      const existingInventor = await storage.getInventorUserByEmail(normalizedEmail);

      if (existingInventor) {
        const updated = await storage.incrementInventorUserProjectLimit(
          existingInventor.id,
          pack.credits,
        );
        console.log(
          `[epd] Top-up: ${normalizedEmail} +${pack.credits} → ${updated?.projectLimit}`,
        );
        await firePostPurchaseWebhook("topup", existingInventor.id);
        return res.json({
          success: true,
          mode: "topup",
          email: normalizedEmail,
          credits: pack.credits,
          projectLimit: updated?.projectLimit ?? null,
          // Existing user — they already have a password, send them to login.
          redirectUrl: "/auth/login",
        });
      }

      const throwawayPassword = crypto.randomBytes(32).toString("hex");
      const hashedPassword = await bcrypt.hash(throwawayPassword, SALT_ROUNDS);
      const user = await storage.createInventorUser({
        email: normalizedEmail,
        password: hashedPassword,
      });
      const updated = await storage.setInventorUserProjectLimit(user.id, pack.credits);

      try {
        const already = await storage.isEmailWhitelisted(normalizedEmail);
        if (!already) await storage.addEmailToWhitelist(normalizedEmail, "epd-checkout");
      } catch (e) {
        console.error("[epd] Auto-whitelist failed (non-fatal):", e);
      }

      // Issue the signup token so the inline /buy password form can authenticate
      // the just-paid user. We deliberately do NOT email a "set your password"
      // link — the user sets their password inline on /buy immediately after
      // payment, so emailing a setup link is redundant and confusing.
      const signupToken = issueSignupToken(normalizedEmail);
      const baseUrl = process.env.APP_BASE_URL || "https://inventor.patentgeyser.com";
      const setPasswordLink = `${baseUrl}/auth/set-password?token=${encodeURIComponent(signupToken)}`;

      await firePostPurchaseWebhook("created", user.id);

      return res.json({
        success: true,
        mode: "created",
        email: normalizedEmail,
        credits: pack.credits,
        projectLimit: updated?.projectLimit ?? pack.credits,
        // Frontend redirects here so the buyer goes straight to set-password
        // without waiting for email delivery.
        redirectUrl: setPasswordLink,
        setPasswordLink,
      });
    } catch (error: any) {
      console.error("[epd] Error:", error);
      return res.status(500).json({ message: "Checkout failed. Please try again." });
    }
  });

  // Set initial password using a one-time signup token (from the welcome email).
  // POST /api/auth/set-initial-password
  // Body: { token: string, password: string }
  app.post("/api/auth/set-initial-password", async (req, res) => {
    try {
      const { token, password } = req.body || {};
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "token is required" });
      }
      if (!password || typeof password !== "string") {
        return res.status(400).json({ message: "password is required" });
      }

      const passwordRequirements = [
        { test: password.length >= 8, message: "Password must be at least 8 characters" },
        { test: /[A-Z]/.test(password), message: "Password must contain at least one uppercase letter" },
        { test: /[a-z]/.test(password), message: "Password must contain at least one lowercase letter" },
        { test: /\d/.test(password), message: "Password must contain at least one number" },
        { test: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password), message: "Password must contain at least one special character" },
      ];
      const failed = passwordRequirements.find((r) => !r.test);
      if (failed) {
        return res.status(400).json({ message: failed.message });
      }

      const verified = verifySignupToken(token);
      if ("error" in verified) {
        const status = verified.error === "Token expired" ? 401 : 401;
        const message =
          verified.error === "Token expired"
            ? "Link has expired. Please contact support."
            : "Invalid or expired link. Please contact support.";
        return res.status(status).json({ message });
      }

      const user = await storage.getInventorUserByEmail(verified.email);
      if (!user) {
        return res.status(404).json({ message: "Account not found." });
      }

      const hashed = await bcrypt.hash(password, SALT_ROUNDS);
      await storage.updateInventorUserPassword(user.id, hashed);

      // Log the user straight in — they just proved control of the email + paid for the account.
      (req.session as any).userId = user.id;
      (req.session as any).userKind = "paid";
      (req.session as any).whitelistStatus = "active";
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      res.json({ success: true, email: user.email });
    } catch (error: any) {
      console.error("set-initial-password error:", error);
      res.status(500).json({ message: "Failed to set password" });
    }
  });

  // Get current user
  app.get("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      const session = req.session as any;
      const userId: string = session.userId;
      const kind: UserKind = session.userKind === "paid" ? "paid" : "legacy";
      const twoFactorVerified = session.twoFactorVerified || false;
      const subscriptionStatus = session.whitelistStatus || "active";

      if (kind === "paid") {
        const user = await storage.getInventorUser(userId);
        if (!user) return res.status(404).json({ message: "User not found" });
        const projectsUsed = await storage.countProjectsByInventorUserId(user.id);
        return res.json({
          id: user.id,
          email: user.email,
          kind: "paid",
          credits: user.projectLimit,
          creditsUsed: projectsUsed,
          creditsRemaining: Math.max(0, user.projectLimit - projectsUsed),
          twoFactorEnabled: user.twoFactorEnabled || false,
          twoFactorMethod: user.twoFactorMethod || null,
          twoFactorVerified,
          subscriptionStatus,
        });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      return res.json({
        id: user.id,
        email: user.email,
        kind: "legacy",
        projectLimit: null,
        projectsUsed: null,
        twoFactorEnabled: user.twoFactorEnabled || false,
        twoFactorMethod: user.twoFactorMethod || null,
        twoFactorVerified,
        subscriptionStatus,
      });
    } catch (error: any) {
      console.error("Get user error:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ============================================
  // Two-Factor Authentication (2FA) Routes
  // ============================================
  
  const GHL_EMAIL_WEBHOOK = process.env.GHL_EMAIL_WEBHOOK || "";

  // Generate a random 6-digit code
  function generateEmailCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Initiate 2FA setup
  app.post("/api/2fa/initiate", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const sessionKind: UserKind = (req.session as any).userKind === "paid" ? "paid" : "legacy";
      const { method } = req.body;

      if (!method || !['email', 'totp'].includes(method)) {
        return res.status(400).json({ message: "Invalid 2FA method" });
      }

      const lookup = await findUserByIdAcrossTables(sessionKind, userId);
      if (!lookup) {
        return res.status(404).json({ message: "User not found" });
      }
      const user = lookup.record;
      const userKind = lookup.kind;

      if (method === 'totp') {
        // Generate TOTP secret
        const secret = generateSecret();
        const otpauthUrl = generateURI({
          issuer: 'Patent Geyser',
          label: user.email,
          secret: secret,
          algorithm: 'sha1',
          digits: 6,
          period: 30
        });
        
        // Generate QR code
        const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);
        
        // Store secret temporarily (not enabled until verified)
        await update2FAByKind(userKind, userId, {
          twoFactorMethod: 'totp',
          totpSecret: secret,
          twoFactorEnabled: false
        });

        res.json({ qrCodeUrl, secret });
      } else {
        // Email method
        const code = generateEmailCode();
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Store code temporarily
        await update2FAByKind(userKind, userId, {
          twoFactorMethod: 'email',
          pendingTwoFactorCode: code,
          pendingTwoFactorExpiry: expiry,
          twoFactorEnabled: false
        });

        // Send email via GHL webhook
        if (GHL_EMAIL_WEBHOOK) {
          try {
            await sendWebhook(GHL_EMAIL_WEBHOOK, {
              email: user.email,
              code: code,
              type: '2fa_setup',
              subject: 'Patent Geyser - 2FA Setup Code',
              message: `Your verification code is: ${code}. This code will expire in 10 minutes.`
            }, 30000);
          } catch (emailError) {
            console.error("Failed to send 2FA email:", emailError);
            return res.status(500).json({ message: "Failed to send verification email" });
          }
        } else {
          console.log("GHL webhook not configured, 2FA code:", code);
        }

        res.json({ message: "Verification code sent to your email" });
      }
    } catch (error: any) {
      console.error("2FA initiate error:", error);
      res.status(500).json({ message: "Failed to initiate 2FA setup" });
    }
  });

  // Verify 2FA setup
  app.post("/api/2fa/verify-setup", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const sessionKind: UserKind = (req.session as any).userKind === "paid" ? "paid" : "legacy";
      const { code } = req.body;

      if (!code || typeof code !== 'string' || code.length !== 6) {
        return res.status(400).json({ message: "Invalid verification code" });
      }

      const lookup = await findUserByIdAcrossTables(sessionKind, userId);
      if (!lookup) {
        return res.status(404).json({ message: "User not found" });
      }
      const user = lookup.record;
      const userKind = lookup.kind;

      let isValid = false;

      if (user.twoFactorMethod === 'totp' && user.totpSecret) {
        // Verify TOTP code
        const verifyResult = await verifyTOTP({ token: code, secret: user.totpSecret });
        isValid = verifyResult.valid;
      } else if (user.twoFactorMethod === 'email') {
        // Verify email code
        if (user.pendingTwoFactorCode === code && user.pendingTwoFactorExpiry) {
          const now = new Date();
          isValid = now < user.pendingTwoFactorExpiry;
        }
      }

      if (!isValid) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }

      // Enable 2FA
      await update2FAByKind(userKind, userId, {
        twoFactorEnabled: true,
        pendingTwoFactorCode: null,
        pendingTwoFactorExpiry: null,
        twoFactorVerifiedAt: new Date()
      });

      // Mark 2FA as verified for this session
      (req.session as any).twoFactorVerified = true;

      res.json({ message: "2FA enabled successfully" });
    } catch (error: any) {
      console.error("2FA verify-setup error:", error);
      res.status(500).json({ message: "Failed to verify 2FA" });
    }
  });

  // Verify 2FA during login
  app.post("/api/2fa/verify", async (req, res) => {
    try {
      const { code, userId } = req.body;

      if (!code || typeof code !== 'string' || code.length !== 6) {
        return res.status(400).json({ message: "Invalid verification code" });
      }

      // Get user from pending 2FA session or userId
      const pendingUserId = (req.session as any).pending2FAUserId || userId;
      if (!pendingUserId) {
        return res.status(400).json({ message: "No pending 2FA verification" });
      }

      const sessionKind: UserKind = (req.session as any).userKind === "paid" ? "paid" : "legacy";
      const lookup = await findUserByIdAcrossTables(sessionKind, pendingUserId);
      if (!lookup) {
        return res.status(404).json({ message: "User not found" });
      }
      const user = lookup.record;
      const userKind = lookup.kind;

      let isValid = false;

      if (user.twoFactorMethod === 'totp' && user.totpSecret) {
        const verifyResult = await verifyTOTP({ token: code, secret: user.totpSecret });
        isValid = verifyResult.valid;
      } else if (user.twoFactorMethod === 'email') {
        if (user.pendingTwoFactorCode === code && user.pendingTwoFactorExpiry) {
          const now = new Date();
          isValid = now < user.pendingTwoFactorExpiry;
        }
      }

      if (!isValid) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }

      // Clear pending code if email method
      if (user.twoFactorMethod === 'email') {
        await update2FAByKind(userKind, pendingUserId, {
          pendingTwoFactorCode: null,
          pendingTwoFactorExpiry: null,
          twoFactorVerifiedAt: new Date()
        });
      }

      // Complete login
      (req.session as any).userId = pendingUserId;
      (req.session as any).twoFactorVerified = true;
      delete (req.session as any).pending2FAUserId;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      if (userKind === "paid") {
        storage.updateInventorUserLastLogin(pendingUserId).catch(() => {});
      } else {
        storage.updateLastLogin(pendingUserId).catch(() => {});
      }

      res.json({ id: user.id, email: user.email });
    } catch (error: any) {
      console.error("2FA verify error:", error);
      res.status(500).json({ message: "Failed to verify 2FA" });
    }
  });

  // Send 2FA code for login
  app.post("/api/2fa/send-code", async (req, res) => {
    try {
      const { userId } = req.body;
      const pendingUserId = (req.session as any).pending2FAUserId || userId;
      
      if (!pendingUserId) {
        return res.status(400).json({ message: "No pending 2FA verification" });
      }

      const sessionKind: UserKind = (req.session as any).userKind === "paid" ? "paid" : "legacy";
      const lookup = await findUserByIdAcrossTables(sessionKind, pendingUserId);
      if (!lookup || lookup.record.twoFactorMethod !== 'email') {
        return res.status(400).json({ message: "Email 2FA not configured for this user" });
      }
      const user = lookup.record;

      const code = generateEmailCode();
      const expiry = new Date(Date.now() + 10 * 60 * 1000);

      await update2FAByKind(lookup.kind, pendingUserId, {
        pendingTwoFactorCode: code,
        pendingTwoFactorExpiry: expiry
      });

      if (GHL_EMAIL_WEBHOOK) {
        try {
          await sendWebhook(GHL_EMAIL_WEBHOOK, {
            email: user.email,
            code: code,
            type: '2fa_login',
            subject: 'Patent Geyser - Login Verification Code',
            message: `Your login verification code is: ${code}. This code will expire in 10 minutes.`
          }, 30000);
        } catch (emailError) {
          console.error("Failed to send 2FA email:", emailError);
          return res.status(500).json({ message: "Failed to send verification email" });
        }
      } else {
        console.log("GHL webhook not configured, 2FA code:", code);
      }

      res.json({ message: "Verification code sent to your email" });
    } catch (error: any) {
      console.error("2FA send-code error:", error);
      res.status(500).json({ message: "Failed to send verification code" });
    }
  });

  // Disable 2FA
  app.post("/api/2fa/disable", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const sessionKind: UserKind = (req.session as any).userKind === "paid" ? "paid" : "legacy";

      await update2FAByKind(sessionKind, userId, {
        twoFactorEnabled: false,
        twoFactorMethod: null,
        totpSecret: null,
        pendingTwoFactorCode: null,
        pendingTwoFactorExpiry: null
      });

      res.json({ message: "2FA disabled successfully" });
    } catch (error: any) {
      console.error("2FA disable error:", error);
      res.status(500).json({ message: "Failed to disable 2FA" });
    }
  });

  // Check 2FA status
  app.get("/api/2fa/status", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const sessionKind: UserKind = (req.session as any).userKind === "paid" ? "paid" : "legacy";
      const lookup = await findUserByIdAcrossTables(sessionKind, userId);

      if (!lookup) {
        return res.status(404).json({ message: "User not found" });
      }
      const user = lookup.record;

      res.json({
        enabled: user.twoFactorEnabled || false,
        method: user.twoFactorMethod || null,
        verified: (req.session as any).twoFactorVerified || false
      });
    } catch (error: any) {
      console.error("2FA status error:", error);
      res.status(500).json({ message: "Failed to get 2FA status" });
    }
  });

  // ============================================
  // Password Management Routes
  // ============================================
  
  const GHL_PASSWORD_RESET_WEBHOOK = process.env.GHL_PASSWORD_RESET_WEBHOOK || "";

  // Change password (requires current password)
  app.post("/api/auth/change-password", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }

      const sessionKind: UserKind = (req.session as any).userKind === "paid" ? "paid" : "legacy";
      const lookup = await findUserByIdAcrossTables(sessionKind, userId);
      if (!lookup || !lookup.record.password) {
        return res.status(404).json({ message: "User not found" });
      }
      const user = lookup.record;

      // Verify current password
      const bcrypt = await import('bcryptjs');
      const isValid = await bcrypt.compare(currentPassword, user.password!);
      if (!isValid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      // Hash and save new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await updatePasswordByKind(lookup.kind, userId, hashedPassword);

      res.json({ message: "Password changed successfully" });
    } catch (error: any) {
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // Request password reset code (sends email via GHL webhook)
  app.post("/api/auth/request-password-reset", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const sessionKind: UserKind = (req.session as any).userKind === "paid" ? "paid" : "legacy";
      const lookup = await findUserByIdAcrossTables(sessionKind, userId);

      if (!lookup) {
        return res.status(404).json({ message: "User not found" });
      }
      const user = lookup.record;

      // Generate a 6-digit reset code
      const code = generateEmailCode();
      const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store the code temporarily
      await update2FAByKind(lookup.kind, userId, {
        pendingTwoFactorCode: code,
        pendingTwoFactorExpiry: expiry
      });

      // Send email via GHL webhook
      if (GHL_PASSWORD_RESET_WEBHOOK) {
        try {
          await sendWebhook(GHL_PASSWORD_RESET_WEBHOOK, {
            email: user.email,
            code: code,
            type: 'password_reset',
            subject: 'Patent Geyser - Password Reset Code',
            message: `Your password reset code is: ${code}. This code will expire in 10 minutes.`
          }, 30000);
        } catch (emailError) {
          console.error("Failed to send password reset email:", emailError);
          return res.status(500).json({ message: "Failed to send reset email" });
        }
      } else {
        console.log("GHL password reset webhook not configured, code:", code);
      }

      res.json({ message: "Reset code sent to your email" });
    } catch (error: any) {
      console.error("Request password reset error:", error);
      res.status(500).json({ message: "Failed to request password reset" });
    }
  });

  // Verify reset code and change password
  app.post("/api/auth/reset-password", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const { code, newPassword } = req.body;

      if (!code || !newPassword) {
        return res.status(400).json({ message: "Reset code and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }

      const sessionKind: UserKind = (req.session as any).userKind === "paid" ? "paid" : "legacy";
      const lookup = await findUserByIdAcrossTables(sessionKind, userId);
      if (!lookup) {
        return res.status(404).json({ message: "User not found" });
      }
      const user = lookup.record;

      // Verify the reset code
      if (!user.pendingTwoFactorCode || user.pendingTwoFactorCode !== code) {
        return res.status(401).json({ message: "Invalid reset code" });
      }

      // Check expiry
      if (user.pendingTwoFactorExpiry && new Date(user.pendingTwoFactorExpiry) < new Date()) {
        return res.status(401).json({ message: "Reset code has expired" });
      }

      // Hash and save new password
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await updatePasswordByKind(lookup.kind, userId, hashedPassword);

      // Clear the reset code
      await update2FAByKind(lookup.kind, userId, {
        pendingTwoFactorCode: null,
        pendingTwoFactorExpiry: null
      });

      res.json({ message: "Password reset successfully" });
    } catch (error: any) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // ============================================
  // Forgot Password Flow (Public - not authenticated)
  // ============================================

  // Store temporary reset tokens (in production, use Redis or DB)
  const resetTokens = new Map<string, { email: string; expiry: Date }>();

  // Step 1: Initiate forgot password - check user and 2FA method
  app.post("/api/auth/forgot-password/init", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Find user by email across both tables (paid first, then legacy)
      const lookup = await findUserByEmailAcrossTables(email.toLowerCase());
      if (!lookup) {
        return res.status(404).json({ message: "No account found with that email address." });
      }
      const user = lookup.record;

      // Determine verification method based on user's 2FA settings
      let method: 'email' | 'totp' = 'email';

      if (user.twoFactorMethod === 'totp' && user.totpSecret) {
        // User has TOTP 2FA - use authenticator app
        method = 'totp';
        res.json({ method: 'totp', message: "Enter your authenticator code" });
      } else {
        // Use email verification (works for email 2FA or no 2FA)
        const code = generateEmailCode();
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Store the code on whichever table the user lives in
        await update2FAByKind(lookup.kind, user.id, {
          pendingTwoFactorCode: code,
          pendingTwoFactorExpiry: expiry
        });

        // Send email via GHL webhook
        if (GHL_PASSWORD_RESET_WEBHOOK) {
          try {
            await sendWebhook(GHL_PASSWORD_RESET_WEBHOOK, {
              email: user.email,
              code: code,
              message: `Your password reset code is: ${code}. This code will expire in 10 minutes.`
            }, 30000);
          } catch (emailError) {
            console.error("Failed to send forgot password email:", emailError);
            return res.status(500).json({ message: "Failed to send verification email" });
          }
        } else {
          console.log("GHL password reset webhook not configured, code:", code);
        }

        res.json({ method: 'email', message: "Verification code sent to your email" });
      }
    } catch (error: any) {
      console.error("Forgot password init error:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });

  // Step 2: Verify code and issue reset token
  app.post("/api/auth/forgot-password/verify", async (req, res) => {
    try {
      const { email, code, method } = req.body;

      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }

      const lookup = await findUserByEmailAcrossTables(email.toLowerCase());
      if (!lookup) {
        return res.status(401).json({ message: "Invalid verification code" });
      }
      const user = lookup.record;

      let isValid = false;

      if (method === 'totp' && user.totpSecret) {
        // Verify TOTP code
        const verifyResult = await verifyTOTP({ token: code, secret: user.totpSecret });
        isValid = verifyResult.valid;
      } else {
        // Verify email code - ensure string comparison
        const storedCode = user.pendingTwoFactorCode?.toString().trim();
        const submittedCode = code?.toString().trim();
        console.log("Forgot password verify - stored:", storedCode, "submitted:", submittedCode);
        
        if (!storedCode || storedCode !== submittedCode) {
          return res.status(401).json({ message: "Invalid verification code" });
        }
        if (user.pendingTwoFactorExpiry && new Date(user.pendingTwoFactorExpiry) < new Date()) {
          return res.status(401).json({ message: "Verification code has expired" });
        }
        isValid = true;
      }

      if (!isValid) {
        return res.status(401).json({ message: "Invalid verification code" });
      }

      // Generate a secure reset token
      const resetToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const tokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Store the token
      resetTokens.set(resetToken, { email: user.email, expiry: tokenExpiry });

      // Clear the email code if used
      if (method !== 'totp') {
        await update2FAByKind(lookup.kind, user.id, {
          pendingTwoFactorCode: null,
          pendingTwoFactorExpiry: null
        });
      }

      res.json({ resetToken, message: "Verified successfully" });
    } catch (error: any) {
      console.error("Forgot password verify error:", error);
      res.status(500).json({ message: "Failed to verify code" });
    }
  });

  // Step 3: Reset password with token
  app.post("/api/auth/forgot-password/reset", async (req, res) => {
    try {
      const { email, resetToken, newPassword } = req.body;

      if (!email || !resetToken || !newPassword) {
        return res.status(400).json({ message: "Email, reset token, and new password are required" });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      // Validate reset token
      const tokenData = resetTokens.get(resetToken);
      if (!tokenData) {
        return res.status(401).json({ message: "Invalid or expired reset token" });
      }

      if (tokenData.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(401).json({ message: "Invalid reset token" });
      }

      if (tokenData.expiry < new Date()) {
        resetTokens.delete(resetToken);
        return res.status(401).json({ message: "Reset token has expired" });
      }

      const lookup = await findUserByEmailAcrossTables(email.toLowerCase());
      if (!lookup) {
        return res.status(404).json({ message: "User not found" });
      }
      const user = lookup.record;

      // Hash and save new password on whichever table the user lives in
      const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await updatePasswordByKind(lookup.kind, user.id, hashedPassword);

      // Clear any pending reset code on the right table
      await update2FAByKind(lookup.kind, user.id, {
        pendingTwoFactorCode: null,
        pendingTwoFactorExpiry: null
      });

      // Clean up the token
      resetTokens.delete(resetToken);

      res.json({ message: "Password reset successfully" });
    } catch (error: any) {
      console.error("Forgot password reset error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // ============================================
  // Quick Prior Art Check Routes (Standalone, not tied to a project)
  // ============================================

  // Uses env var declared at top of file

  // Get user's prior art search history
  app.get("/api/prior-art-searches", isAuthenticated, withAuthUser, async (req, res) => {
    try {
      const authUser: AuthUser = (req as any).authUser;
      const searches = await storage.getPriorArtSearches({
        kind: authUser.kind,
        userId: authUser.id,
      });
      res.json(searches);
    } catch (error: any) {
      console.error("Get prior art searches error:", error);
      res.status(500).json({ message: "Failed to fetch search history" });
    }
  });

  // Run a new prior art check
  app.post("/api/prior-art-check", isAuthenticated, withAuthUser, async (req, res) => {
    try {
      const authUser: AuthUser = (req as any).authUser;
      const userId = authUser.id;
      const { searchText } = req.body;

      if (!searchText || typeof searchText !== 'string' || searchText.trim().length < 10) {
        return res.status(400).json({ message: "Please provide at least 10 characters describing your idea" });
      }

      console.log("Running quick prior art check for user:", userId);

      // Call n8n webhook with minimal payload
      const webhookPayload = {
        sessionId: `quick-check-${userId}-${Date.now()}`,
        idea: searchText.trim()
      };

      const webhookResponse = await sendWebhook(N8N_QUICK_PRIOR_ART_WEBHOOK, webhookPayload);
      
      console.log("Quick prior art webhook raw response:", JSON.stringify(webhookResponse, null, 2));
      
      // Parse the response - extract relevant prior art results
      let results: any[] = [];
      
      // Extract patents from the response
      // The webhook returns: [{ results: { total_unique_patents: N, patents: [...] }, analysis: {...} }]
      // or sometimes: { results: { patents: [...] } }
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
      
      // Extract analysis data (key_differentiators, claims_focus, etc.)
      const analysis = responseData?.analysis || null;
      if (analysis) {
        console.log(`Analysis includes ${analysis.key_differentiators?.length || 0} key differentiators, ${analysis.claims_focus?.length || 0} claims focus items`);
      }

      // Store the search in database under the right owner column.
      const savedSearch = await storage.createPriorArtSearch({
        userId: authUser.kind === "legacy" ? userId : null,
        inventorsUserId: authUser.kind === "paid" ? userId : null,
        searchText: searchText.trim(),
        results,
        analysis,
      });

      console.log(`Prior art check completed: ${results.length} results found`);

      res.json({
        success: true,
        search: savedSearch
      });
    } catch (error: any) {
      console.error("Prior art check error:", error);
      sendServerError(res, error, "Failed to run prior art check");
    }
  });

  // Delete a prior art search
  app.delete("/api/prior-art-searches/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deletePriorArtSearch(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete prior art search error:", error);
      res.status(500).json({ message: "Failed to delete search" });
    }
  });

  // ============================================
  // Project Routes
  // ============================================

  // Get all projects for current user
  app.get("/api/projects", isAuthenticated, withAuthUser, async (req, res) => {
    try {
      const authUser: AuthUser = (req as any).authUser;
      const list = authUser.kind === "paid"
        ? await storage.getProjectsByOwner({ kind: "paid", inventorsUserId: authUser.id })
        : await storage.getProjectsByOwner({ kind: "legacy", userId: authUser.id });
      res.json(list);
    } catch (error: any) {
      console.error("Get projects error:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  // Get single project
  app.get("/api/projects/:id", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Verify ownership
      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      res.json(project);
    } catch (error: any) {
      console.error("Get project error:", error);
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  // Create new project
  app.post("/api/projects", isAuthenticated, withAuthUser, async (req, res) => {
    try {
      const authUser: AuthUser = (req as any).authUser;

      if (authUser.kind === "paid") {
        const inventorUser = await storage.getInventorUser(authUser.id);
        if (!inventorUser) return res.status(401).json({ message: "Unauthorized" });
        const used = await storage.countProjectsByInventorUserId(inventorUser.id);
        if (used >= inventorUser.projectLimit) {
          return res.status(402).json({
            code: "PROJECT_LIMIT_REACHED",
            message: "You're out of credits. Purchase more to create another project.",
            credits: inventorUser.projectLimit,
            creditsUsed: used,
            creditsRemaining: Math.max(0, inventorUser.projectLimit - used),
          });
        }
      }

      const { userId: _u, inventorsUserId: _p, ...clientFields } = req.body || {};
      const ownerFields = authUser.kind === "paid"
        ? { inventorsUserId: authUser.id, userId: null }
        : { userId: authUser.id, inventorsUserId: null };

      // Validate optional family attachment — caller must own the family.
      if (clientFields.familyId) {
        const fam = await getFamily(clientFields.familyId);
        if (!fam || !sessionOwnsFamily(req, fam)) {
          return res.status(404).json({ message: "Family not found" });
        }
      }

      const projectData = insertProjectSchema.parse({ ...clientFields, ...ownerFields });
      const project = await storage.createProject(projectData);
      res.json(project);
    } catch (error: any) {
      console.error("Create project error:", error);
      sendServerError(res, error, "Failed to create project", 400);
    }
  });

  // ---------------------------------------------------------------------------
  // Project Families — organisational grouping of sibling patents. The family
  // itself is just a label; the cost-controlled overlap check is powered by
  // the project_family_artifacts digest cache (see server/lib/families.ts).
  // ---------------------------------------------------------------------------

  // Internal: resolve the current session's owner kind+id, matching the same
  // dual-auth (legacy / paid) pattern used by projects.
  function familyOwnerFromSession(req: Request): { kind: "legacy" | "paid"; id: string } | null {
    const session = req.session as any;
    const sid: string | undefined = session?.userId;
    if (!sid) return null;
    return { kind: session.userKind === "paid" ? "paid" : "legacy", id: sid };
  }

  // Create family
  app.post("/api/families", isAuthenticated, async (req, res) => {
    try {
      const owner = familyOwnerFromSession(req);
      if (!owner) return res.status(401).json({ message: "Unauthorized" });
      const { title, description, context } = req.body || {};
      if (typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ message: "title is required" });
      }
      const family = await createFamily({
        ownerKind: owner.kind,
        ownerId: owner.id,
        title: title.trim(),
        description: typeof description === "string" ? description : null,
        context: typeof context === "string" ? context : null,
      });
      res.json(family);
    } catch (err: any) {
      console.error("Create family error:", err);
      sendServerError(res, err, "Failed to create family");
    }
  });

  // List current user's families
  app.get("/api/families", isAuthenticated, async (req, res) => {
    try {
      const owner = familyOwnerFromSession(req);
      if (!owner) return res.status(401).json({ message: "Unauthorized" });
      const families = await listFamiliesByOwner({ kind: owner.kind, ownerId: owner.id });
      res.json(families);
    } catch (err: any) {
      sendServerError(res, err, "Failed to list families");
    }
  });

  // Family detail + members
  app.get("/api/families/:id", isAuthenticated, async (req, res) => {
    try {
      const fam = await getFamily(req.params.id);
      if (!fam || !sessionOwnsFamily(req, fam)) return res.status(404).json({ message: "Not found" });
      const members = await listProjectsInFamily(fam.id);
      res.json({ ...fam, members });
    } catch (err: any) {
      sendServerError(res, err, "Failed to load family");
    }
  });

  // Rename / re-describe
  app.patch("/api/families/:id", isAuthenticated, async (req, res) => {
    try {
      const fam = await getFamily(req.params.id);
      if (!fam || !sessionOwnsFamily(req, fam)) return res.status(404).json({ message: "Not found" });
      const { title, description, context } = req.body || {};
      const updated = await updateFamily(fam.id, {
        title: typeof title === "string" ? title : undefined,
        description: description === undefined ? undefined : (typeof description === "string" ? description : null),
        context: context === undefined ? undefined : (typeof context === "string" ? context : null),
      });
      res.json(updated);
    } catch (err: any) {
      sendServerError(res, err, "Failed to update family");
    }
  });

  // Soft-delete family (detaches members; preserves projects + credits)
  app.delete("/api/families/:id", isAuthenticated, async (req, res) => {
    try {
      const fam = await getFamily(req.params.id);
      if (!fam || !sessionOwnsFamily(req, fam)) return res.status(404).json({ message: "Not found" });
      await softDeleteFamily(fam.id);
      res.json({ ok: true });
    } catch (err: any) {
      sendServerError(res, err, "Failed to delete family");
    }
  });

  // Batch attach: move N existing patents into a family in one round-trip.
  // Used by the "Add existing patents" picker on the family card. Per-project
  // ownership is enforced; any not-owned ids are simply skipped (returned in
  // `skipped`) so the caller can show a partial-success toast.
  app.post("/api/families/:id/attach-projects", isAuthenticated, async (req, res) => {
    try {
      const fam = await getFamily(req.params.id);
      if (!fam || !sessionOwnsFamily(req, fam)) return res.status(404).json({ message: "Family not found" });
      const { projectIds } = req.body || {};
      if (!Array.isArray(projectIds) || projectIds.length === 0) {
        return res.status(400).json({ message: "projectIds must be a non-empty array" });
      }
      const skipped: string[] = [];
      const eligible: string[] = [];
      for (const id of projectIds) {
        if (typeof id !== "string") continue;
        const project = await storage.getProject(id);
        if (!project || !sessionOwnsProject(req, project)) {
          skipped.push(id);
          continue;
        }
        eligible.push(id);
      }
      const result = await attachManyProjectsToFamily(eligible, fam.id);
      res.json({ attached: result.ok, failed: result.failed, skipped });
    } catch (err: any) {
      console.error("Bulk attach error:", err);
      sendServerError(res, err, "Failed to attach projects");
    }
  });

  // Attach project to a family
  app.post("/api/projects/:id/family", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project || !sessionOwnsProject(req, project)) {
        return res.status(404).json({ message: "Project not found" });
      }
      const { familyId } = req.body || {};
      if (typeof familyId !== "string" || !familyId.trim()) {
        return res.status(400).json({ message: "familyId is required" });
      }
      const fam = await getFamily(familyId);
      if (!fam || !sessionOwnsFamily(req, fam)) {
        return res.status(404).json({ message: "Family not found" });
      }
      await attachProjectToFamily(project.id, fam.id);
      res.json({ ok: true, familyId: fam.id });
    } catch (err: any) {
      sendServerError(res, err, "Failed to attach project");
    }
  });

  // Detach project from its family
  app.delete("/api/projects/:id/family", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project || !sessionOwnsProject(req, project)) {
        return res.status(404).json({ message: "Project not found" });
      }
      await detachProjectFromFamily(project.id);
      res.json({ ok: true });
    } catch (err: any) {
      sendServerError(res, err, "Failed to detach project");
    }
  });

  // Read-only siblings reference (cached digests only — never full bodies).
  // Primary consumer: the coach modal + the territory panel inside each
  // project. Returns [] when the project has no family.
  app.get("/api/projects/:id/siblings", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project || !sessionOwnsProject(req, project)) {
        return res.status(404).json({ message: "Project not found" });
      }
      const siblings = await getSiblingsReference(project.id);
      res.json(siblings);
    } catch (err: any) {
      sendServerError(res, err, "Failed to load siblings");
    }
  });

  // ---------- Family Context Files ----------
  // External reference documents (typically prior patents in the same product
  // domain). Heavy AI work (text extraction + one-line summary) runs ONCE at
  // upload time. Later per-turn QA prompts see only the cached summary.

  // POST /api/families/:id/context-files — upload one file (base64 in JSON).
  // Foreground response so the inventor sees the summary as soon as it's
  // available. Cap ~25 MB (matches express body limit).
  app.post("/api/families/:id/context-files", isAuthenticated, async (req, res) => {
    try {
      const fam = await getFamily(req.params.id);
      if (!fam || !sessionOwnsFamily(req, fam)) return res.status(404).json({ message: "Family not found" });
      const { originalFilename, mimeType, fileBytesB64 } = req.body || {};
      if (typeof originalFilename !== "string" || !originalFilename.trim()) {
        return res.status(400).json({ message: "originalFilename is required" });
      }
      if (typeof mimeType !== "string" || !mimeType.trim()) {
        return res.status(400).json({ message: "mimeType is required" });
      }
      const validation = validateUpload({ mimeType, fileBytesB64 });
      if (validation) return res.status(400).json({ message: validation });

      const session = req.session as any;
      const ownerKind = session.userKind === "paid" ? "paid" : "legacy";
      const uploaded = await uploadFamilyContextFile({
        familyId: fam.id,
        uploadedByUserId: ownerKind === "legacy" ? session.userId : null,
        uploadedByInventorsUserId: ownerKind === "paid" ? session.userId : null,
        originalFilename: originalFilename.trim(),
        mimeType,
        fileBytesB64,
      });
      res.json(uploaded);
    } catch (err: any) {
      console.error("Upload context file error:", err);
      sendServerError(res, err, "Failed to upload file");
    }
  });

  // GET /api/families/:id/context-files — metadata + summary only. Never
  // ships file_bytes_b64 or extracted_text.
  app.get("/api/families/:id/context-files", isAuthenticated, async (req, res) => {
    try {
      const fam = await getFamily(req.params.id);
      if (!fam || !sessionOwnsFamily(req, fam)) return res.status(404).json({ message: "Family not found" });
      const files = await listFamilyContextFiles(fam.id);
      res.json(files);
    } catch (err: any) {
      sendServerError(res, err, "Failed to list files");
    }
  });

  // GET /api/families/:id/context-files/:fileId/full-text — returns the full
  // extracted plain text of one file. Used by the AI helper's fetch tool when
  // the model needs to read a specific document. Authentication enforced.
  app.get("/api/families/:id/context-files/:fileId/full-text", isAuthenticated, async (req, res) => {
    try {
      const fam = await getFamily(req.params.id);
      if (!fam || !sessionOwnsFamily(req, fam)) return res.status(404).json({ message: "Family not found" });
      const row = await getFamilyContextFileExtractedText(req.params.fileId);
      if (!row || row.familyId !== fam.id) return res.status(404).json({ message: "File not found" });
      res.json({ originalFilename: row.originalFilename, extractedText: row.extractedText ?? "" });
    } catch (err: any) {
      sendServerError(res, err, "Failed to fetch file");
    }
  });

  // GET /api/families/:id/context-files/:fileId/download — returns raw bytes
  // for human download. Decoded from the base64 column.
  app.get("/api/families/:id/context-files/:fileId/download", isAuthenticated, async (req, res) => {
    try {
      const fam = await getFamily(req.params.id);
      if (!fam || !sessionOwnsFamily(req, fam)) return res.status(404).json({ message: "Family not found" });
      const row = await getFamilyContextFileBytes(req.params.fileId);
      if (!row || row.familyId !== fam.id) return res.status(404).json({ message: "File not found" });
      const buf = Buffer.from(row.fileBytesB64, "base64");
      res.setHeader("Content-Type", row.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.originalFilename)}"`);
      res.send(buf);
    } catch (err: any) {
      sendServerError(res, err, "Failed to download file");
    }
  });

  // PATCH /api/families/:id/context-files/:fileId — metadata update (inventor
  // names, filed date, status, etc). Same shape as PATCH /api/projects/:id.
  app.patch("/api/families/:id/context-files/:fileId", isAuthenticated, async (req, res) => {
    try {
      const fam = await getFamily(req.params.id);
      if (!fam || !sessionOwnsFamily(req, fam)) return res.status(404).json({ message: "Family not found" });
      const existing = await getFamilyContextFileBytes(req.params.fileId);
      if (!existing || existing.familyId !== fam.id) return res.status(404).json({ message: "File not found" });

      const updateSchema = z.object({
        title: z.string().optional().nullable(),
        inventorNames: z.array(z.string()).optional().nullable(),
        filedDate: z.string().optional().nullable(),
        status: z.enum(["draft", "filed", "published", "granted", "converted", "abandoned", "expired"]).optional().nullable(),
        applicationNumber: z.string().optional().nullable(),
        publicationNumber: z.string().optional().nullable(),
        assignee: z.string().optional().nullable(),
        jurisdiction: z.string().optional().nullable(),
        patentType: z.enum(["provisional", "utility", "design", "plant", "pct", "other"]).optional().nullable(),
        externalUrl: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid input" });
      }
      const updated = await updateFamilyContextFileMetadata(req.params.fileId, parsed.data);
      res.json(updated);
    } catch (err: any) {
      sendServerError(res, err, "Failed to update file");
    }
  });

  // DELETE /api/families/:id/context-files/:fileId — soft delete.
  app.delete("/api/families/:id/context-files/:fileId", isAuthenticated, async (req, res) => {
    try {
      const fam = await getFamily(req.params.id);
      if (!fam || !sessionOwnsFamily(req, fam)) return res.status(404).json({ message: "Family not found" });
      const row = await getFamilyContextFileBytes(req.params.fileId);
      if (!row || row.familyId !== fam.id) return res.status(404).json({ message: "File not found" });
      await softDeleteFamilyContextFile(req.params.fileId);
      res.json({ ok: true });
    } catch (err: any) {
      sendServerError(res, err, "Failed to delete file");
    }
  });

  // Overlap check — pure hash lookup against the family's digest cache.
  // Body: { candidates: [{ kind, text }, ...] }. Returns hits only.
  app.post("/api/projects/:id/siblings/overlap-check", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project || !sessionOwnsProject(req, project)) {
        return res.status(404).json({ message: "Project not found" });
      }
      const { candidates } = req.body || {};
      if (!Array.isArray(candidates)) {
        return res.status(400).json({ message: "candidates must be an array" });
      }
      const safe = candidates
        .filter((c: any) => c && typeof c.text === "string" && typeof c.kind === "string")
        .map((c: any) => ({ kind: c.kind, text: c.text }));
      const hits = await findOverlapsInFamily(project.id, safe as any);
      res.json({ hits });
    } catch (err: any) {
      sendServerError(res, err, "Failed to run overlap check");
    }
  });

  // Complete project
  app.post("/api/projects/:id/complete", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const updated = await storage.updateProject(req.params.id, {
        completed: 1,
        currentStage: 5,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Complete project error:", error);
      res.status(500).json({ message: "Failed to complete project" });
    }
  });

  // Update project (title only for now)
  app.patch("/api/projects/:id", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Validate using Zod schema. Title is optional now — the same endpoint
      // also accepts patent-metadata fields. All fields are optional so the
      // dialog can save any subset.
      const updateSchema = z.object({
        title: z.string().min(1).max(200).trim().optional(),
        inventorNames: z.array(z.string()).optional().nullable(),
        filedDate: z.string().optional().nullable(),
        status: z.enum(["draft", "filed", "published", "granted", "converted", "abandoned", "expired"]).optional().nullable(),
        applicationNumber: z.string().optional().nullable(),
        publicationNumber: z.string().optional().nullable(),
        assignee: z.string().optional().nullable(),
        jurisdiction: z.string().optional().nullable(),
        patentType: z.enum(["provisional", "utility", "design", "plant", "pct", "other"]).optional().nullable(),
        externalUrl: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      });

      const validation = updateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: validation.error.issues[0]?.message || "Invalid input"
        });
      }

      // Strip undefined keys so we don't overwrite existing values with NaN/missing.
      const patch: Record<string, any> = {};
      for (const [k, v] of Object.entries(validation.data)) {
        if (v !== undefined) patch[k] = v === "" ? null : v;
      }

      const updatedProject = await storage.updateProject(req.params.id, patch as any);
      res.json(updatedProject);
    } catch (error: any) {
      console.error("Update project error:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  // Delete project
  app.delete("/api/projects/:id", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await storage.deleteProject(req.params.id);
      res.json({ success: true, message: "Project deleted successfully" });
    } catch (error: any) {
      console.error("Delete project error:", error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  // ============================================
  // Current Idea Routes (for the Idea Evolution Modal)
  // ============================================

  // Get all idea snapshots for a project (ordered by version)
  app.get("/api/projects/:id/current-idea", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Get all snapshots ordered by version
      const snapshots = await storage.getIdeaSnapshots(req.params.id);
      
      // Get the latest snapshot as the "current" idea
      const currentIdea = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

      res.json({
        currentIdea: currentIdea?.content || null,
        currentVersion: currentIdea?.version || 0,
        snapshots,
      });
    } catch (error: any) {
      console.error("Get current idea error:", error);
      res.status(500).json({ message: "Failed to fetch current idea" });
    }
  });

  // Create a new idea snapshot
  app.post("/api/projects/:id/current-idea", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { snapshotType, title, content, command, qualityScore, metadata } = req.body;
      
      if (!snapshotType || !content) {
        return res.status(400).json({ message: "snapshotType and content are required" });
      }

      // Get next version number
      const nextVersion = await storage.getNextSnapshotVersion(req.params.id);

      const snapshot = await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: nextVersion,
        snapshotType,
        title,
        content,
        command,
        qualityScore,
        metadata,
      });

      res.json(snapshot);
    } catch (error: any) {
      console.error("Create idea snapshot error:", error);
      res.status(500).json({ message: "Failed to create idea snapshot" });
    }
  });

  // Backfill snapshots from existing agent data (for projects created before snapshot system)
  app.post("/api/projects/:id/backfill-snapshots", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Check if snapshots already exist (skip if not forced)
      const existingSnapshots = await storage.getIdeaSnapshots(req.params.id);
      if (existingSnapshots.length > 0 && !req.body.force) {
        return res.json({ 
          message: "Snapshots already exist", 
          snapshotCount: existingSnapshots.length,
          snapshots: existingSnapshots 
        });
      }

      // Get all agent data for this project
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent3Data = await storage.getAgentData(req.params.id, 3);
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent5Data = await storage.getAgentData(req.params.id, 5);

      const createdSnapshots: any[] = [];
      let version = 1;

      // Helper to create snapshot
      const createSnapshot = async (
        snapshotType: string, 
        content: string, 
        title?: string, 
        command?: string,
        metadata?: any
      ) => {
        const snapshot = await storage.createIdeaSnapshot({
          projectId: req.params.id,
          version: version++,
          snapshotType,
          title,
          content,
          command,
          metadata,
        });
        createdSnapshots.push(snapshot);
        return snapshot;
      };

      // Stage 1: Extract from Agent 1 data
      if (agent1Data) {
        const a1 = agent1Data as any;
        
        // Root snapshot from ideaSummary or first user message
        if (a1.ideaSummary) {
          await createSnapshot('root', a1.ideaSummary, 'Initial Idea');
        } else if (a1.rounds && a1.rounds.length > 0 && a1.rounds[0].userMessage) {
          await createSnapshot('root', a1.rounds[0].userMessage, 'Initial Idea');
        }
        
        // Debate rounds
        if (a1.rounds && a1.rounds.length > 0) {
          for (let i = 0; i < Math.min(a1.rounds.length, 3); i++) { // Limit to first 3 rounds
            const round = a1.rounds[i];
            if (round.transcript) {
              await createSnapshot(
                'debate', 
                round.transcript.substring(0, 2000), // Truncate for storage
                `Debate Round ${i + 1}`
              );
            }
          }
        }
      }

      // Stage 2: Extract from Agent 2 data
      if (agent2Data) {
        const a2 = agent2Data as any;
        
        // 2a: Concept expansion from draft
        if (a2.expandedDraft || a2.expandedConcept) {
          await createSnapshot(
            '2a_concept_expansion',
            a2.expandedDraft || a2.expandedConcept,
            'Concept Expanded'
          );
        }
        
        // 2b: Selected ideas
        if (a2.extractedIdeas && a2.extractedIdeas.length > 0) {
          const selectedIdeas = a2.extractedIdeas
            .filter((idea: any) => idea.selected !== false)
            .map((idea: any) => `**${idea.title}**\n${idea.description || idea.content || ''}`)
            .join('\n\n');
          
          if (selectedIdeas) {
            await createSnapshot(
              '2b_selected_ideas',
              selectedIdeas,
              `${a2.extractedIdeas.filter((i: any) => i.selected !== false).length} Ideas Selected`,
              undefined,
              { ideaCount: a2.extractedIdeas.filter((i: any) => i.selected !== false).length }
            );
          }
        }
      }

      // Stage 3: Extract from Agent 3 data
      if (agent3Data) {
        const a3 = agent3Data as any;
        
        if (a3.results || a3.searchResults) {
          const results = a3.results || a3.searchResults;
          let priorArtSummary = 'Prior Art Research Complete\n\n';
          
          if (Array.isArray(results)) {
            priorArtSummary += results.slice(0, 5).map((r: any) => 
              `- ${r.title || r.name || 'Result'}: ${r.summary || r.description || ''}`
            ).join('\n');
          }
          
          await createSnapshot(
            '3_prior_art',
            priorArtSummary,
            'Prior Art Research'
          );
        }
      }

      // Stage 4: Extract from Agent 4 data
      if (agent4Data) {
        const a4 = agent4Data as any;
        
        // 4a: White space analysis
        if (a4.nuggetAnalyses && a4.nuggetAnalyses.length > 0) {
          const whiteSpaceSummary = a4.nuggetAnalyses.map((analysis: any) => 
            `**${analysis.conceptTitle || 'Concept'}**\n` +
            `Risk: ${analysis.riskLevel || 'Unknown'}\n` +
            `Strategy: ${analysis.whiteSpaceStrategy || analysis.strategy || 'N/A'}`
          ).join('\n\n');
          
          await createSnapshot(
            '4a_white_space',
            whiteSpaceSummary,
            'White Space Analysis',
            undefined,
            { analysisCount: a4.nuggetAnalyses.length }
          );
        }
        
        // 4b: Selected claims
        if (a4.selectedVariation) {
          const variation = a4.selectedVariation;
          let claimsSummary = `**Selected Claims (Variation ${variation.variationNumber || 'N/A'})**\n\n`;
          claimsSummary += `Strategy: ${variation.strategySummary || 'N/A'}\n\n`;
          
          if (variation.claims && variation.claims.length > 0) {
            claimsSummary += variation.claims.map((c: any) => 
              `${c.type || c.claimType}: ${c.text || c.content || ''}`
            ).join('\n\n');
          }
          
          await createSnapshot(
            '4b_claims',
            claimsSummary,
            'Claims Selected',
            undefined,
            { variationNumber: variation.variationNumber }
          );
        } else if (a4.claimVariations && a4.claimVariations.length > 0) {
          // No selection made, use first variation as fallback
          const firstVar = a4.claimVariations[0];
          let claimsSummary = `**Claims (Variation 1)**\n\n`;
          claimsSummary += `Strategy: ${firstVar.strategySummary || 'N/A'}\n\n`;
          
          if (firstVar.claims && firstVar.claims.length > 0) {
            claimsSummary += firstVar.claims.slice(0, 3).map((c: any) => 
              `${c.type || c.claimType}: ${c.text || c.content || ''}`
            ).join('\n\n');
          }
          
          await createSnapshot(
            '4b_claims',
            claimsSummary,
            'Claims Generated'
          );
        }
        
        // 4c: Provisional draft
        if (a4.provisionalDraft) {
          const draft = a4.provisionalDraft;
          let provisionalSummary = `# ${draft.title || 'Provisional Patent Application'}\n\n`;
          
          if (draft.abstract) {
            provisionalSummary += `**Abstract:**\n${draft.abstract}\n\n`;
          }
          if (draft.summary) {
            provisionalSummary += `**Summary:**\n${draft.summary.substring(0, 500)}...\n\n`;
          }
          
          await createSnapshot(
            '4c_provisional',
            provisionalSummary,
            draft.title || 'Provisional Draft',
            undefined,
            { keyConcepts: draft.keyConcepts_count || draft.keyConcepts?.length || 0 }
          );
        }
      }

      // Stage 5: Extract from Agent 5 data
      if (agent5Data) {
        const a5 = agent5Data as any;
        
        if (a5.diagrams && a5.diagrams.length > 0) {
          const diagramSummary = a5.diagrams.map((d: any, i: number) => 
            `**Diagram ${i + 1}:**\n${d.title || d.description || d.text?.substring(0, 200) || 'Technical Diagram'}`
          ).join('\n\n');
          
          await createSnapshot(
            '5_diagrams',
            diagramSummary,
            `${a5.diagrams.length} Diagrams Generated`,
            undefined,
            { diagramCount: a5.diagrams.length }
          );
        }
      }

      res.json({
        message: "Snapshots backfilled successfully",
        snapshotCount: createdSnapshots.length,
        snapshots: createdSnapshots,
      });
    } catch (error: any) {
      console.error("Backfill snapshots error:", error);
      res.status(500).json({ message: "Failed to backfill snapshots" });
    }
  });

  // ============================================
  // Source Code Routes
  // ============================================

  // Get all source code files for a project
  app.get("/api/projects/:id/source-code", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      res.json({
        files: project.sourceCodeFiles || [],
        updatedAt: project.updatedAt,
      });
    } catch (error: any) {
      console.error("Get source code error:", error);
      res.status(500).json({ message: "Failed to fetch source code" });
    }
  });

  // Add a source code file to a project
  app.post("/api/projects/:id/source-code", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { sourceCode, fileName, codeDescription } = req.body;
      
      if (!sourceCode || typeof sourceCode !== 'string') {
        return res.status(400).json({ message: "sourceCode is required" });
      }

      // Get existing files or initialize empty array
      const existingFiles = project.sourceCodeFiles || [];
      
      // Create new file entry
      const newFile = {
        id: `code-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        fileName: fileName || `code-${existingFiles.length + 1}.txt`,
        description: codeDescription || "",
        code: sourceCode,
        addedAt: new Date().toISOString(),
      };

      // Add to array
      const updatedFiles = [...existingFiles, newFile];

      await storage.updateProject(req.params.id, {
        sourceCodeFiles: updatedFiles,
      });

      res.json({ 
        message: "Source code added successfully",
        file: newFile,
        files: updatedFiles,
      });
    } catch (error: any) {
      console.error("Save source code error:", error);
      res.status(500).json({ message: "Failed to save source code" });
    }
  });

  // Delete a specific source code file by ID
  app.delete("/api/projects/:id/source-code/:fileId", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const existingFiles = project.sourceCodeFiles || [];
      const updatedFiles = existingFiles.filter((f: any) => f.id !== req.params.fileId);

      if (updatedFiles.length === existingFiles.length) {
        return res.status(404).json({ message: "File not found" });
      }

      await storage.updateProject(req.params.id, {
        sourceCodeFiles: updatedFiles,
      });

      res.json({ message: "Source code file removed successfully", files: updatedFiles });
    } catch (error: any) {
      console.error("Delete source code file error:", error);
      res.status(500).json({ message: "Failed to delete source code file" });
    }
  });

  // Delete all source code files for a project
  app.delete("/api/projects/:id/source-code", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      if (!sessionOwnsProject(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await storage.updateProject(req.params.id, {
        sourceCodeFiles: [],
      });

      res.json({ message: "All source code removed successfully" });
    } catch (error: any) {
      console.error("Delete source code error:", error);
      res.status(500).json({ message: "Failed to delete source code" });
    }
  });

  // ============================================
  // Agent Data Routes
  // ============================================

  // Get agent data for a specific agent
  app.get("/api/projects/:id/agent/:agentNumber", isAuthenticated, async (req, res) => {
    try {
      const agentNumber = parseInt(req.params.agentNumber);
      const data = await storage.getAgentData(req.params.id, agentNumber);
      
      res.json(data || { data: {} });
    } catch (error: any) {
      console.error("Get agent data error:", error);
      res.status(500).json({ message: "Failed to fetch agent data" });
    }
  });

  // Auto-save agent data (Agent 1)
  app.post("/api/projects/:id/agent/1", isAuthenticated, async (req, res) => {
    try {
      const savedData = await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: req.body,
      });

      res.json(savedData);
    } catch (error: any) {
      console.error("Save agent 1 data error:", error);
      res.status(500).json({ message: "Failed to save data" });
    }
  });

  // Add new conversation round to Agent 1 (with intent detection for 1A vs 1B routing)
  app.post("/api/projects/:id/agent/1/rounds", isAuthenticated, async (req, res) => {
    try {
      const { idea, message } = req.body;

      // Get existing agent data
      const existingData = await storage.getAgentData(req.params.id, 1);
      const currentData = (existingData?.data || {}) as any;
      const rounds = currentData.rounds || [];

      // First round requires idea
      if (rounds.length === 0 && (!idea || typeof idea !== 'string' || idea.trim().length === 0)) {
        return res.status(400).json({ message: "Idea is required for first brainstorming round" });
      }

      // All rounds require a message
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ message: "Message is required" });
      }

      // Determine idea summary (first round sets it, subsequent rounds use existing)
      const ideaSummary = rounds.length === 0 ? idea.trim() : currentData.ideaSummary;

      // Generate or reuse sessionId (unique per conversation)
      const sessionId = rounds.length === 0
        ? `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
        : currentData.sessionId;

      // Get current idea from latest snapshot or ideaSummary
      let latestSnapshot = await storage.getLatestIdeaSnapshot(req.params.id);
      
      // FIRST ROUND: Always create root snapshot before anything else
      if (rounds.length === 0 && !latestSnapshot) {
        const rootVersion = await storage.getNextSnapshotVersion(req.params.id);
        await storage.createIdeaSnapshot({
          projectId: req.params.id,
          version: rootVersion,
          snapshotType: 'root',
          title: 'Initial Idea',
          content: ideaSummary,
          metadata: { source: 'initial_submission' },
        });
        // Re-fetch after creating root snapshot
        latestSnapshot = await storage.getLatestIdeaSnapshot(req.params.id);
      }

      const currentIdea = latestSnapshot?.content || ideaSummary;

      // Check if user explicitly requested a review (forces Advocate/Examiner)
      const forceReview = req.body.forceReview === true;
      
      // Check if user explicitly requested mechanic (from Refine Idea button)
      const forceMechanic = req.body.forceMechanic === true;
      
      // Detect intent - should we use Mechanic (1B) or Brainstorm (1A)?
      const intent = detectMechanicIntent(message);
      
      // Verify we have a base snapshot before allowing mechanic
      const existingSnapshots = await storage.getIdeaSnapshots(req.params.id);
      const hasBaseSnapshot = existingSnapshots.length > 0;
      
      // Use Mechanic if explicitly forced OR if intent detected AND not forcing review
      const isMechanicRequest = rounds.length > 0 && hasBaseSnapshot && !forceReview && 
        (forceMechanic || intent.isMechanic);

      // `any` matches the legacy callN8nWebhook return shape. The two agents
      // it can hold now (runDebate / runMechanic) carry disjoint `data` payloads,
      // and the read-sites below are guarded by `isMechanicRequest` — narrowing
      // by hand here would be noisier than the original code without buying
      // safety the runtime checks already provide.
      let n8nResponse: any;
      let roundType: 'brainstorm' | 'mechanic' = 'brainstorm';

      if (isMechanicRequest) {
        // Route to Mechanic (1B) - handles add/fix/delete/change commands
        roundType = 'mechanic';
        console.log(`[Agent 1B - Mechanic] Processing command: ${intent.command}`);
        
        n8nResponse = await runMechanic({
          projectId: req.params.id,
          currentIdea, // The idea after Advocate/Examiner debate
          userRequest: message, // User's refinement request (e.g., "add encryption")
          sessionId,
        });
      } else {
        // Route to Brainstorm (1A) - Advocate/Examiner debate
        // Use currentIdea (which includes mechanic refinements) when forceReview is true
        const brainstormIdea = forceReview ? currentIdea : ideaSummary;
        n8nResponse = await runDebate({
          idea: brainstormIdea,
          category: (await storage.getProject(req.params.id))?.category ?? undefined,
        });
      }

      // Check if webhook failed
      if (!n8nResponse.success) {
        console.error("n8n webhook failed:", n8nResponse.error);
        // Return user-friendly error message
        const userMessage = n8nResponse.error?.includes("empty response") 
          ? "The AI service is temporarily unavailable. Please wait a moment and try again."
          : n8nResponse.error?.includes("timed out")
            ? "The AI service took too long to respond. Please try again."
            : isMechanicRequest 
              ? "AI mechanic service failed. Please try again." 
              : "AI brainstorming service failed. Please try again.";
        return res.status(503).json({
          success: false,
          message: userMessage,
          error: n8nResponse.error,
        });
      }

      let agentsDebate;
      let transcript;
      let updatedIdea;
      let qualityScore;

      if (isMechanicRequest) {
        // Process Mechanic response
        const mechanicResponse = n8nResponse.data || {};
        // Webhook returns modifiedIdea (check both for backwards compatibility)
        let rawUpdatedIdea = mechanicResponse.modifiedIdea || mechanicResponse.updatedIdea || currentIdea;
        
        // Clean the idea: remove Examiner section (it contains outdated critiques)
        // Keep only the core idea and Advocate additions (which contain the actual improvements)
        const examinerIndex = rawUpdatedIdea.indexOf("**Examiner Challenges");
        if (examinerIndex > 0) {
          rawUpdatedIdea = rawUpdatedIdea.substring(0, examinerIndex).trim();
        }
        
        updatedIdea = rawUpdatedIdea;
        qualityScore = mechanicResponse.qualityScore || null;
        const changesApplied = mechanicResponse.changesApplied || null;
        
        // Format mechanic response as debate-style for UI consistency
        agentsDebate = [{
          speaker: 'Mechanic',
          message: changesApplied || mechanicResponse.explanation || `Updated idea based on your request to ${intent.command}.`,
        }];
        
        if (mechanicResponse.validation) {
          agentsDebate.push({
            speaker: 'Quality Check',
            message: mechanicResponse.validation,
          });
        }

        transcript = mechanicResponse.transcript;

        // Create idea snapshot for the update
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
            changesApplied: changesApplied,
          },
        });
      } else {
        // Process Brainstorm response
        const data = n8nResponse.data || {};
        const fullDebate = data.fullDebate || [];
        transcript = data.transcript;

        // Convert fullDebate to agentsDebate format
        if (fullDebate.length > 0) {
          agentsDebate = fullDebate.map((entry: any) => ({
            speaker: entry.speaker || entry.role || 'Unknown',
            message: entry.message || entry.content || '',
          }));
        } else {
          agentsDebate = [];
        }

        // Create a debate snapshot after each brainstorm response
        const advocateInsights = agentsDebate
          .filter((d: any) => d.speaker === 'Advocate')
          .map((d: any) => d.message)
          .join('\n\n');
        
        const examinerChallenges = agentsDebate
          .filter((d: any) => d.speaker === 'Examiner')
          .map((d: any) => d.message)
          .join('\n\n');
        
        if (advocateInsights || examinerChallenges) {
          const nextVersion = await storage.getNextSnapshotVersion(req.params.id);
          
          // Build comprehensive content that shows idea evolution
          let debateContent = currentIdea;
          if (advocateInsights) {
            debateContent += `\n\n**Advocate Additions:**\n${advocateInsights}`;
          }
          if (examinerChallenges) {
            debateContent += `\n\n**Examiner Challenges (addressed):**\n${examinerChallenges}`;
          }
          
          await storage.createIdeaSnapshot({
            projectId: req.params.id,
            version: nextVersion,
            snapshotType: 'debate',
            title: `Debate Round ${rounds.length + 1}`,
            content: debateContent,
            metadata: { 
              roundNumber: rounds.length + 1,
              userMessage: message,
              advocateInsights: advocateInsights || null,
              examinerChallenges: examinerChallenges || null,
            },
          });
        }
      }

      // Create new round
      const newRound = {
        id: `round-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        userMessage: message.trim(),
        agentsDebate,
        transcript,
        roundType,
        command: intent.command,
        qualityScore,
        createdAt: new Date().toISOString(),
      };

      // Append round to conversation
      const updatedRounds = [...rounds, newRound];

      // Update agent data with new round (preserve existing fields)
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...currentData, // Preserve all existing fields
          ideaSummary,
          sessionId,
          rounds: updatedRounds,
          status: 'active',
          webhookLog: [...(currentData.webhookLog || []), {
            roundId: newRound.id,
            timestamp: newRound.createdAt,
            success: true,
            type: roundType,
          }],
        },
      });

      res.json({
        success: true,
        round: newRound,
        roundType,
        conversation: { ideaSummary, rounds: updatedRounds },
      });
    } catch (error: any) {
      console.error("Add round error:", error);
      res.status(500).json({ message: "Failed to process message" });
    }
  });

  // Finalize Agent 1 brainstorming and advance to Agent 2
  app.post("/api/projects/:id/agent/1/finalize", isAuthenticated, async (req, res) => {
    try {
      // Validate agent 1 data exists and has conversation rounds
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const rounds = (agent1Data?.data as any)?.rounds || [];

      if (rounds.length === 0) {
        return res.status(400).json({
          message: "Cannot finalize: no brainstorming conversation found. Please start a conversation first.",
        });
      }

      const ideaSummary = (agent1Data?.data as any)?.ideaSummary;
      const sessionId = (agent1Data?.data as any)?.sessionId;
      if (!ideaSummary) {
        return res.status(400).json({
          message: "Cannot finalize: idea summary is missing. Please restart the brainstorming session.",
        });
      }

      // Validate sessionId
      if (!sessionId) {
        return res.status(400).json({
          message: "Session ID is missing. Cannot finalize brainstorming.",
        });
      }

      // Get the latest idea snapshot (refined by Mechanic) or fall back to ideaSummary
      const latestSnapshot = await storage.getLatestIdeaSnapshot(req.params.id);
      const currentIdea = latestSnapshot?.content || ideaSummary;

      // Build comprehensive summary for Agent 2
      const comprehensiveSummary = {
        ideaSummary, // Original idea
        currentIdea, // Refined idea (from Mechanic updates)
        sessionId,
        totalRounds: rounds.length,
        conversationDetails: rounds.map((round: any) => ({
          userMessage: round.userMessage,
          advocateInsights: round.agentsDebate
            ?.filter((msg: any) => msg.speaker === "Advocate")
            .map((msg: any) => msg.message) || [],
          examinerChallenges: round.agentsDebate
            ?.filter((msg: any) => msg.speaker === "Examiner")
            .map((msg: any) => msg.message) || [],
          mechanicUpdates: round.agentsDebate
            ?.filter((msg: any) => msg.speaker === "Mechanic")
            .map((msg: any) => msg.message) || [],
          transcript: round.transcript,
        })),
        fullTranscript: rounds.map((r: any) => r.transcript).join('\n\n'),
      };

      // Update agent 1 data with finalized status FIRST
      if (!agent1Data) {
        return res.status(400).json({ message: "Agent 1 data not found" });
      }
      
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...(agent1Data.data as any),
          status: 'finalized',
          finalizedAt: new Date().toISOString(),
        },
      });

      // Store initial Agent 2 data with the comprehensive summary (Module 2a pending)
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          comprehensiveSummary,
          status: 'pending_draft',
          createdAt: new Date().toISOString(),
        },
      });

      // Update project to agent 2 with substage 2a
      await storage.updateProject(req.params.id, { currentStage: 2, currentSubstage: '2a' });

      // Provenance: brainstorm finalize is a checkpoint — chain it and stamp.
      createCheckpointBackground({
        projectId: req.params.id,
        eventType: "finalize_brainstorm",
        refTable: "agent_data",
        refId: null,
        payload: { agentNumber: 1, comprehensiveSummary },
      });

      res.json({
        success: true,
        message: "Brainstorming finalized. Moving to concept expansion."
      });
    } catch (error: any) {
      console.error("Finalize agent 1 error:", error);
      sendServerError(res, error, "Failed to finalize brainstorming session");
    }
  });

  // Re-analyze an improved idea through Advocate/Examiner
  app.post("/api/projects/:id/agent/1/reanalyze", isAuthenticated, async (req, res) => {
    try {
      const { idea } = req.body;

      if (!idea || typeof idea !== 'string' || !idea.trim()) {
        return res.status(400).json({ message: "Idea text is required" });
      }

      // Clear all downstream data when re-analyzing at stage 1
      await clearDownstreamData(req.params.id, '1a-reanalyze');

      // Get existing agent 1 data
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Extract the original main idea and previous agent analyses
      const existingData = agent1Data?.data as any;
      const mainIdea = existingData?.ideaSummary || "";
      const existingRounds = existingData?.rounds || [];
      
      // Get the most recent Advocate and Examiner analyses from the last round
      let previousAdvocate = "";
      let previousExaminer = "";

      if (existingRounds.length > 0) {
        const lastRound = existingRounds[existingRounds.length - 1];
        const agentsDebate = lastRound.agentsDebate || [];

        for (const entry of agentsDebate) {
          if (entry.speaker === "Advocate") {
            previousAdvocate = entry.message || "";
          } else if (entry.speaker === "Examiner") {
            previousExaminer = entry.message || "";
          }
        }
      }

      // Generate session ID for this reanalysis
      const sessionId = existingData?.sessionId || `session-${Date.now()}`;

      // Call re-analyze with full context
      console.log("Re-analyzing idea through Advocate/Examiner (v2)...");
      const webhookResponse = await runReanalyze({
        mainIdea,
        previousAdvocate,
        previousExaminer,
        newIdea: idea.trim(),
        category: project.category || 'software',
        projectId: req.params.id,
        sessionId,
      });

      if (!webhookResponse.success) {
        return res.status(500).json({
          message: "Failed to re-analyze idea.",
        });
      }

      // Parse Advocate and Examiner audit results
      const agentsDebate = webhookResponse.auditResults.map((result: any) => ({
        speaker: result.speaker,
        message: result.message,
      }));

      const advocateMsg = agentsDebate.find((a: any) => a.speaker === "Advocate")?.message || "No response";
      const examinerMsg = agentsDebate.find((a: any) => a.speaker === "Examiner")?.message || "No response";

      // Create new round data (shape matches /rounds endpoint for UI + downstream consumers)
      const newRound = {
        id: `round-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        userMessage: idea.trim(),
        agentsDebate,
        transcript: `Re-analysis of improved idea:\n\n${idea}\n\nAdvocate: ${advocateMsg}\n\nExaminer: ${examinerMsg}`,
        roundType: "brainstorm" as const,
        createdAt: new Date().toISOString(),
      };

      // Update agent 1 data with new round
      const existingWebhookLog = (agent1Data?.data as any)?.webhookLog || [];
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...(agent1Data?.data as any),
          ideaSummary: idea.trim(),
          sessionId,
          rounds: [...existingRounds, newRound],
          extractedIdeas: null, // Clear old extracted ideas
          webhookLog: [...existingWebhookLog, {
            roundId: newRound.id,
            timestamp: newRound.createdAt,
            success: true,
            type: newRound.roundType,
          }],
        },
      });

      // Create new root snapshot for the improved idea
      const existingSnapshots = await storage.getIdeaSnapshots(req.params.id);
      const nextVersion = existingSnapshots.length + 1;
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: nextVersion,
        snapshotType: 'root',
        content: idea.trim(),
        metadata: { reanalysis: true, timestamp: new Date().toISOString() },
      });

      res.json({
        success: true,
        message: "Idea re-analyzed successfully. View the new Advocate/Examiner analysis.",
        round: newRound,
      });
    } catch (error: any) {
      console.error("Reanalyze idea error:", error);
      res.status(500).json({ message: "Failed to re-analyze idea" });
    }
  });

  // Helper to parse audit data from agent messages (server-side version)
  function parseAuditDataServer(message: string): any | null {
    if (!message) return null;
    try {
      let cleanedMessage = message.trim();
      if (cleanedMessage.includes('```')) {
        cleanedMessage = cleanedMessage.replace(/^```(?:json|javascript)?\s*/m, '').replace(/\s*```$/m, '');
      }
      const jsonMatch = cleanedMessage.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        cleanedMessage = jsonMatch[0];
      }
      const parsed = JSON.parse(cleanedMessage);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && item.audit_log && Array.isArray(item.audit_log)) {
            return item;
          }
        }
        // Check if the array itself IS the audit_log (array of items with status field)
        if (parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object' && 'status' in parsed[0]) {
          // Filter out DISMISSED items
          const validItems = parsed.filter((item: any) => item.status !== "DISMISSED");
          if (validItems.length > 0) {
            return { audit_log: validItems };
          }
          return null;
        }
        return null;
      }
      if (parsed && typeof parsed === 'object' && parsed.audit_log && Array.isArray(parsed.audit_log)) {
        return parsed;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Track in-progress extract-ideas requests to prevent duplicate webhook calls
  const extractIdeasInProgress = new Set<string>();

  // Extract ideas from Original, Advocate, and Examiner using list-creator webhook
  app.post("/api/projects/:id/agent/1/extract-ideas", isAuthenticated, async (req, res) => {
    const projectId = req.params.id;
    
    // Prevent duplicate concurrent requests for the same project
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
      const rounds = (agent1Data?.data as any)?.rounds || [];
      const existingExtractedIdeas = (agent1Data?.data as any)?.extractedIdeas || [];

      if (rounds.length === 0) {
        return res.status(400).json({
          message: "No brainstorming data found. Please complete Advocate/Examiner analysis first.",
        });
      }

      // Get latest brainstorm round
      const brainstormRounds = rounds.filter((r: any) => r.roundType !== "mechanic");
      const latestRound = brainstormRounds[brainstormRounds.length - 1];

      if (!latestRound?.agentsDebate) {
        return res.status(400).json({
          message: "No Advocate/Examiner analysis found.",
        });
      }

      // Check if this is Round 2+ with existing ideas - if so, filter based on audit "needs work" items
      const isRound2Plus = brainstormRounds.length > 1 && existingExtractedIdeas.length > 0;
      
      if (isRound2Plus) {
        console.log("=== ROUND 2+ DETECTED - FILTERING BASED ON AUDIT ===");
        
        // Parse audit results from latest round to find "YET TO FIX" items
        // Build detailed items with context from both Advocate and Examiner
        const needsWorkItems: string[] = [];
        const needsWorkDetailed: Array<{
          original: string;
          advocate: string;
          examiner: string;
          reasoning: string;
        }> = [];
        
        // First pass: collect all "YET TO FIX" items from both agents with their context
        for (const agent of latestRound.agentsDebate) {
          const isAdvocate = agent.speaker === "Advocate";
          const auditData = parseAuditDataServer(agent.message);
          if (auditData?.audit_log) {
            for (const item of auditData.audit_log) {
              if (item.status === "YET TO FIX" || item.status === "NEEDS WORK") {
                // Extract the item text for matching - handle various field names from Advocate and Examiner
                const itemText = (item.item || item.point || item.original_point || item.original_praise || item.original_criticism || item.original_objection || "").trim();
                if (itemText) {
                  needsWorkItems.push(itemText.toLowerCase());
                  console.log(`Needs work item: ${itemText.substring(0, 80)}...`);
                  
                  // Add detailed context for webhook
                  needsWorkDetailed.push({
                    original: itemText,
                    advocate: isAdvocate ? itemText : "",
                    examiner: !isAdvocate ? itemText : "",
                    reasoning: item.reasoning || "",
                  });
                }
              }
            }
          }
        }
        
        console.log(`Found ${needsWorkItems.length} items that need work`);
        
        // Get the core idea (original user input from first round)
        const coreIdea = brainstormRounds[0]?.userMessage || "";
        
        // Round 3: Call webhook to get AI fixes for all "needs work" items
        let aiFixes: any[] = [];
        if (needsWorkDetailed.length > 0 && coreIdea) {
          console.log("=== ROUND 3: CALLING R3 FIXES (direct AI) ===");
          try {
            const r3Response = await runR3Fixes({
              coreIdea,
              needsWorkItems: needsWorkDetailed,
            });
            if (r3Response.success && Array.isArray(r3Response.data)) {
              aiFixes = r3Response.data;
              console.log(`Got ${aiFixes.length} AI fixes from Round 3`);
            }
          } catch (err) {
            console.error("R3 fixes error:", err);
            // Continue without AI fixes - don't block the flow
          }
        }
        
        // Filter existing ideas: only those matching "needs work" stay pending
        // Everything else becomes auto-approved (user already reviewed in Round 1)
        const filteredIdeas = existingExtractedIdeas.map((idea: any, index: number) => {
          // Skip if already discarded by user
          if (idea.status === "discarded") {
            return idea;
          }
          
          // Check if this idea matches any "needs work" item
          const ideaText = (idea.item || "").toLowerCase().trim();
          let matchingNeedsWorkIndex = -1;
          const matchesNeedsWork = needsWorkItems.some((nwItem, nwIndex) => {
            // Fuzzy match: check if either contains the other or significant overlap
            const matches = ideaText.includes(nwItem) || 
                   nwItem.includes(ideaText) ||
                   // Check for keyword overlap (at least 3 significant words match)
                   (() => {
                     const ideaWords = ideaText.split(/\s+/).filter((w: string) => w.length > 3);
                     const nwWords = nwItem.split(/\s+/).filter((w: string) => w.length > 3);
                     const matchedWords = ideaWords.filter((w: string) => nwWords.includes(w));
                     return matchedWords.length >= 3;
                   })();
            if (matches) {
              matchingNeedsWorkIndex = nwIndex;
            }
            return matches;
          });
          
          if (matchesNeedsWork) {
            // Find the corresponding AI fix if available
            const aiFix = aiFixes[matchingNeedsWorkIndex] || null;
            
            // Keep as pending - needs work, attach AI fix
            // n8n returns { ai_fix: "..." } so check for that field name
            return { 
              ...idea, 
              status: "pending", 
              needsWork: true,
              aiFix: aiFix?.ai_fix || aiFix?.fix || aiFix?.suggestion || aiFix?.revised || aiFix || null,
              aiFixReason: aiFix?.reason || aiFix?.reasoning || null,
            };
          } else if (idea.status === "pending") {
            // Auto-approve - was pending but doesn't need work anymore
            return { 
              ...idea, 
              status: "approved", 
              autoApproved: true,
              autoApprovalReason: "Addressed in Round 2 improvements"
            };
          }
          
          // Keep existing status (approved, edited, etc.)
          return idea;
        });
        
        const pendingCount = filteredIdeas.filter((i: any) => i.status === "pending").length;
        const autoApprovedCount = filteredIdeas.filter((i: any) => i.autoApproved).length;
        console.log(`After filtering: ${pendingCount} pending, ${autoApprovedCount} auto-approved`);
        
        // Store filtered ideas with AI fixes
        await storage.upsertAgentData({
          projectId: req.params.id,
          agentNumber: 1,
          data: {
            ...(agent1Data?.data as any),
            extractedIdeas: filteredIdeas,
            extractedAt: new Date().toISOString(),
            round2Filtered: true,
            aiFixes: aiFixes,
            aiFixesGeneratedAt: aiFixes.length > 0 ? new Date().toISOString() : null,
          },
        });

        const ideasWithFixes = filteredIdeas.filter((i: any) => i.aiFix).length;
        console.log(`Ideas with AI fixes: ${ideasWithFixes}`);

        return res.json({
          success: true,
          ideas: filteredIdeas,
          round2Filtered: true,
          needsWorkCount: needsWorkItems.length,
          aiFixesCount: aiFixes.length,
        });
      }

      // Round 1: Extract all ideas from scratch
      // Extract texts from each source
      // Use ideaSummary (the clean original user input) - NOT latestSnapshot which may contain merged text
      const ideaSummary = (agent1Data?.data as any)?.ideaSummary || "";
      
      // Get the root snapshot for the truly original idea if available
      const allSnapshots = await storage.getIdeaSnapshots(req.params.id);
      const rootSnapshot = allSnapshots.find((s: any) => s.snapshotType === 'root');
      const originalText = rootSnapshot?.content || ideaSummary;
      
      const advocateText = latestRound.agentsDebate
        .filter((a: any) => a.speaker === "Advocate")
        .map((a: any) => a.message)
        .join("\n\n");
      
      const examinerText = latestRound.agentsDebate
        .filter((a: any) => a.speaker === "Examiner")
        .map((a: any) => a.message)
        .join("\n\n");

      // Call list-creator webhook with project identifiers
      // Note: n8n webhooks still expect goodCop/badCop field names — do not rename until those agents are migrated
      const sessionId = (agent1Data?.data as any)?.sessionId || `session-${Date.now()}`;
      
      // Debug: Log what we're sending
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
        goodCop: advocateText, // Internal: advocateText
        badCop: examinerText, // Internal: examinerText
      });

      if (!webhookResponse.success) {
        return res.status(500).json({
          message: "Failed to extract ideas from AI.",
          error: webhookResponse.error,
        });
      }

      // Parse webhook response - new format has { kept: [...], removed: [...] }
      // Old format was just an array of ideas
      let keptIdeas: any[] = [];
      let removedIdeas: any[] = [];
      
      const responseData = webhookResponse.data;
      
      // Check if new format (array with kept/removed structure)
      if (Array.isArray(responseData) && responseData.length > 0 && responseData[0].kept) {
        // New format: [{ kept: [...], removed: [...], totalKept, totalRemoved }]
        keptIdeas = responseData[0].kept || [];
        removedIdeas = responseData[0].removed || [];
        console.log(`New format: ${keptIdeas.length} kept, ${removedIdeas.length} removed`);
      } else if (responseData?.kept) {
        // New format without array wrapper: { kept: [...], removed: [...] }
        keptIdeas = responseData.kept || [];
        removedIdeas = responseData.removed || [];
        console.log(`New format (unwrapped): ${keptIdeas.length} kept, ${removedIdeas.length} removed`);
      } else {
        // Old format: direct array of ideas (legacy shape, cast to any to preserve runtime fallback)
        const legacy = responseData as any;
        keptIdeas = legacy?.ideas || legacy?.items || legacy || [];
        console.log(`Old format: ${keptIdeas.length} ideas`);
      }
      
      // Helper to clean up item text - remove embedded Advocate/Examiner sections
      const cleanItemText = (text: string): string => {
        if (!text) return "";
        // Remove Advocate section and everything after
        let cleaned = text.split(/Advocate (Additions|Analysis):/i)[0];
        // Remove Examiner section and everything after
        cleaned = cleaned.split(/Examiner (Challenges|Analysis):/i)[0];
        // Remove "Your Idea" header if present
        cleaned = cleaned.replace(/^Your Idea\s*/i, "");
        // Trim and limit length for cleaner display
        cleaned = cleaned.trim();
        // If still too long, take first meaningful chunk
        if (cleaned.length > 500) {
          const firstPara = cleaned.split(/\n\n/)[0];
          cleaned = firstPara.length > 50 ? firstPara : cleaned.substring(0, 500) + "...";
        }
        return cleaned;
      };
      
      // Transform kept ideas - need user review (status: pending)
      const pendingIdeas = (Array.isArray(keptIdeas) ? keptIdeas : []).map((idea: any, idx: number) => ({
        id: `idea-${Date.now()}-${idx}`,
        item: cleanItemText(idea.item || idea.label || idea.title || `Idea ${idx + 1}`),
        fromOriginal: idea.fromOriginal || idea.original || "Not mentioned",
        fromAdvocate: idea.fromGoodCop || idea.advocate || "Not mentioned",
        fromExaminer: idea.fromBadCop || idea.examiner || "Not mentioned",
        status: "pending",
      }));
      
      // Transform removed ideas - auto-approved (status: approved)
      const autoApprovedIdeas = (Array.isArray(removedIdeas) ? removedIdeas : []).map((idea: any, idx: number) => ({
        id: `idea-auto-${Date.now()}-${idx}`,
        item: cleanItemText(idea.item || idea.label || idea.title || `Idea ${idx + 1}`),
        fromOriginal: idea.fromOriginal || idea.original || "Not mentioned",
        fromAdvocate: idea.fromGoodCop || idea.advocate || "Not mentioned",
        fromExaminer: idea.fromBadCop || idea.examiner || "Not mentioned",
        status: "approved",
        autoApproved: true,
        autoApprovalReason: idea.reason || "All sources agree or no unique insights",
      }));
      
      // Combine: auto-approved first (already handled), then pending for review
      const unifiedIdeas = [...autoApprovedIdeas, ...pendingIdeas];

      // Store extracted ideas in agent data
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...(agent1Data?.data as any),
          extractedIdeas: unifiedIdeas,
          extractedAt: new Date().toISOString(),
        },
      });

      res.json({
        success: true,
        ideas: unifiedIdeas,
      });
    } catch (error: any) {
      // sendServerError already gates on !res.headersSent — extract-ideas can
      // partially write a response on long AI paths, and re-sending after that
      // triggered ERR_HTTP_HEADERS_SENT crashes during the live webinar.
      sendServerError(res, error, "Failed to extract ideas");
    } finally {
      // Always release the lock when done
      extractIdeasInProgress.delete(projectId);
    }
  });

  // Get extracted ideas
  app.get("/api/projects/:id/agent/1/extracted-ideas", isAuthenticated, async (req, res) => {
    try {
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const extractedIdeas = (agent1Data?.data as any)?.extractedIdeas || [];

      res.json({ ideas: extractedIdeas });
    } catch (error: any) {
      console.error("Get extracted ideas error:", error);
      res.status(500).json({ message: "Failed to get extracted ideas" });
    }
  });

  // Update a single idea (auto-save on approve, edit, discard, AI suggestion)
  app.patch("/api/projects/:id/agent/1/ideas/:ideaId", isAuthenticated, async (req, res) => {
    try {
      const { ideaId } = req.params;
      const updates = req.body; // { status?, editedContent?, improvedIdea?, improvementsMade? }

      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const extractedIdeas = (agent1Data?.data as any)?.extractedIdeas || [];

      // Find and update the specific idea
      const updatedIdeas = extractedIdeas.map((idea: any) => {
        if (idea.id === ideaId) {
          return { ...idea, ...updates };
        }
        return idea;
      });

      // Save back to agent data
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...(agent1Data?.data as any),
          extractedIdeas: updatedIdeas,
        },
      });

      res.json({ success: true, idea: updatedIdeas.find((i: any) => i.id === ideaId) });
    } catch (error: any) {
      console.error("Update idea error:", error);
      res.status(500).json({ message: "Failed to update idea" });
    }
  });

  // Add a new idea manually (for ideas missed during brainstorming)
  app.post("/api/projects/:id/agent/1/ideas", isAuthenticated, async (req, res) => {
    try {
      const { item } = req.body;

      if (!item || !item.trim()) {
        return res.status(400).json({ message: "Idea content is required" });
      }

      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const extractedIdeas = (agent1Data?.data as any)?.extractedIdeas || [];

      // Create new idea with unique ID
      const newIdea = {
        id: `idea-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        item: item.trim(),
        fromOriginal: "User added this idea manually",
        fromGoodCop: "",
        fromBadCop: "",
        status: "pending",
      };

      // Add to existing ideas
      const updatedIdeas = [...extractedIdeas, newIdea];

      // Save back to agent data
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...(agent1Data?.data as any),
          extractedIdeas: updatedIdeas,
        },
      });

      res.json({ success: true, idea: newIdea });
    } catch (error: any) {
      console.error("Add idea error:", error);
      res.status(500).json({ message: "Failed to add idea" });
    }
  });

  // Ask AI for suggestion on how to improve a specific idea
  app.post("/api/projects/:id/agent/1/ask-ai-modifier", isAuthenticated, async (req, res) => {
    try {
      const { ideaId, item, fromOriginal, fromGoodCop, fromBadCop, originalUserPrompt } = req.body;

      if (!ideaId || !item) {
        return res.status(400).json({ message: "Idea ID and item are required" });
      }

      // Get session info and main idea for project context
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const sessionId = (agent1Data?.data as any)?.sessionId || `session-${Date.now()}`;
      const mainIdea = (agent1Data?.data as any)?.ideaSummary || originalUserPrompt || "";

      // Build the original idea from the actual feedback sources (not the synthesized title)
      const originalIdeaContent = [
        fromOriginal && fromOriginal !== "Not mentioned." ? `From Original: ${fromOriginal}` : null,
        fromGoodCop && fromGoodCop !== "Not mentioned." ? `From Advocate: ${fromGoodCop}` : null,
      ].filter(Boolean).join("\n\n");

      // Call AI idea modifier webhook with all context the n8n workflow expects
      const webhookResponse = await runAiModifier({
        projectId: req.params.id,
        sessionId,
        mainIdea,
        item: item,
        fromOriginal: originalIdeaContent || fromOriginal,
        fromGoodCop,
        fromBadCop,
      });

      if (!webhookResponse.success) {
        return res.status(500).json({
          message: "Failed to get AI suggestion.",
          error: webhookResponse.error,
        });
      }

      // Handle n8n response format: [{ json: { improvedIdea, improvementsMade } }]
      let improvedIdea = "";
      let improvementsMade = "";
      
      const data = webhookResponse.data;
      if (Array.isArray(data) && data[0]?.json) {
        // n8n array format
        improvedIdea = data[0].json.improvedIdea || "";
        improvementsMade = data[0].json.improvementsMade || "";
      } else if (data?.improvedIdea) {
        // Direct object format
        improvedIdea = data.improvedIdea || "";
        improvementsMade = data.improvementsMade || "";
      } else {
        // Fallback to old format for backwards compatibility (legacy shape)
        const legacy = data as any;
        const suggestion = legacy?.suggestion || legacy?.recommendation || legacy?.response || legacy;
        improvedIdea = typeof suggestion === 'string' ? suggestion : JSON.stringify(suggestion);
      }

      // Auto-save AI suggestion to the database
      const extractedIdeas = (agent1Data?.data as any)?.extractedIdeas || [];
      const updatedIdeas = extractedIdeas.map((idea: any) => {
        if (idea.id === ideaId) {
          return { ...idea, improvedIdea, improvementsMade };
        }
        return idea;
      });

      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...(agent1Data?.data as any),
          extractedIdeas: updatedIdeas,
        },
      });

      res.json({
        success: true,
        ideaId,
        improvedIdea,
        improvementsMade,
      });
    } catch (error: any) {
      console.error("Ask AI modifier error:", error);
      res.status(500).json({ message: "Failed to get AI suggestion" });
    }
  });

  // Save refined ideas and continue to stage 2
  app.post("/api/projects/:id/agent/1/save-refined-ideas", isAuthenticated, async (req, res) => {
    try {
      const { ideas } = req.body;

      if (!ideas || !Array.isArray(ideas) || ideas.length === 0) {
        return res.status(400).json({ message: "At least one approved idea is required" });
      }

      // Get existing agent 1 data
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const ideaSummary = (agent1Data?.data as any)?.ideaSummary;
      const sessionId = (agent1Data?.data as any)?.sessionId;

      // Build refined idea content from approved ideas
      const refinedContent = ideas.map((idea: any) => {
        const content = idea.editedContent || idea.item;
        return `- ${content}`;
      }).join("\n");

      // Create a snapshot for the refined ideas
      const nextVersion = await storage.getNextSnapshotVersion(req.params.id);
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: nextVersion,
        snapshotType: 'refined_ideas',
        title: 'Refined Ideas from Inspection',
        content: refinedContent,
        metadata: {
          approvedCount: ideas.length,
          ideas: ideas,
        },
      });

      // Get latest snapshot for comprehensive summary
      const latestSnapshot = await storage.getLatestIdeaSnapshot(req.params.id);
      const currentIdea = latestSnapshot?.content || ideaSummary;

      // Build comprehensive summary for Agent 2
      const comprehensiveSummary = {
        ideaSummary,
        currentIdea,
        refinedIdeas: ideas,
        sessionId,
        totalRounds: ((agent1Data?.data as any)?.rounds || []).length,
      };

      // Update agent 1 data with finalized status
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 1,
        data: {
          ...(agent1Data?.data as any),
          refinedIdeas: ideas,
          status: 'finalized',
          finalizedAt: new Date().toISOString(),
        },
      });

      // Store initial Agent 2 data
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          comprehensiveSummary,
          status: 'pending_draft',
          createdAt: new Date().toISOString(),
        },
      });

      // Update project to agent 2
      await storage.updateProject(req.params.id, { currentStage: 2, currentSubstage: '2a' });

      res.json({
        success: true,
        message: "Ideas saved. Moving to concept expansion.",
      });
    } catch (error: any) {
      console.error("Save refined ideas error:", error);
      res.status(500).json({ message: "Failed to save refined ideas" });
    }
  });

  // Auto-save agent 2 data
  app.post("/api/projects/:id/agent/2", isAuthenticated, async (req, res) => {
    try {
      const existingData = await storage.getAgentData(req.params.id, 2);
      const savedData = await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: { ...(existingData?.data || {}), ...req.body },
      });

      res.json(savedData);
    } catch (error: any) {
      console.error("Save agent 2 data error:", error);
      res.status(500).json({ message: "Failed to save data" });
    }
  });

  // Module 2a: Generate/regenerate provisional draft
  app.post("/api/projects/:id/agent/2/draft", isAuthenticated, async (req, res) => {
    try {
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      
      // Validate Agent 2 data exists
      if (!agent2Data?.data) {
        return res.status(400).json({ 
          message: "Agent 2 data not found. Please complete Agent 1 first." 
        });
      }

      // Validate comprehensive summary exists
      const comprehensiveSummary = (agent2Data.data as any).comprehensiveSummary;
      if (!comprehensiveSummary) {
        return res.status(400).json({ 
          message: "Comprehensive summary not found. Please finalize Agent 1 brainstorming first." 
        });
      }

      // Validate summary has required fields
      if (!comprehensiveSummary.ideaSummary || !comprehensiveSummary.sessionId) {
        return res.status(400).json({ 
          message: "Invalid summary data. Missing idea summary or session ID." 
        });
      }

      // Get additional notes and refinement feedback from request body
      const additionalNotes = req.body.additionalNotes || (agent2Data.data as any).additionalNotes || "";
      const refinementFeedback = req.body.refinementFeedback || "";
      
      // Persist the notes and feedback before calling webhook
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...(agent2Data.data as any),
          additionalNotes,
          refinementFeedback,
        },
      });

      // Extract all Advocate insights and Examiner challenges from conversation
      const allAdvocateInsights = comprehensiveSummary.conversationDetails
        ?.flatMap((round: any) => round.advocateInsights || []) || [];
      const allExaminerChallenges = comprehensiveSummary.conversationDetails
        ?.flatMap((round: any) => round.examinerChallenges || []) || [];

      // Send comprehensive data for provisional draft generation
      // Note: n8n webhooks still expect goodCop field names — do not rename until those agents are migrated
      const webhookPayload = {
        sessionId: comprehensiveSummary.sessionId,
        ideaSummary: comprehensiveSummary.ideaSummary,
        goodCopInsights: allAdvocateInsights, // Internal: advocateInsights
        badCopChallenges: allExaminerChallenges, // Internal: examinerChallenges
        fullTranscript: comprehensiveSummary.fullTranscript,
        additionalNotes: additionalNotes || "",
        refinementFeedback: refinementFeedback || "",
        category: comprehensiveSummary.category || "Software",
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

      // Map to the legacy result shape the rest of this route expects
      const result: { patentableIdeas?: string; draftSpecification?: string; provisionalDraft?: string } = {
        provisionalDraft: draftResponse.provisionalDraft,
        patentableIdeas: draftResponse.provisionalDraft,
      };

      // Only store if webhook succeeded
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...(agent2Data.data as any),
          provisionalDraft: result.patentableIdeas || result.draftSpecification || result.provisionalDraft,
          status: 'draft_complete',
          draftedAt: new Date().toISOString(),
        },
      });

      // Create snapshot for Agent 2a concept expansion
      const draftContent = result.patentableIdeas || result.draftSpecification || result.provisionalDraft;
      const nextVersion = await storage.getNextSnapshotVersion(req.params.id);
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: nextVersion,
        snapshotType: '2a_concept_expansion',
        title: 'Concept Expanded',
        content: typeof draftContent === 'string' 
          ? draftContent 
          : `**Expanded Concept**\n\n${JSON.stringify(draftContent, null, 2)}`,
        metadata: { 
          stage: 2,
          substage: '2a',
          draftedAt: new Date().toISOString(),
        },
      });

      // Provenance: first complete provisional draft — the spec's
      // "first complete disclosure" trigger. The canonical payload is the
      // full draft text so the proof package can independently re-derive
      // the hash that every TSA signed.
      createCheckpointBackground({
        projectId: req.params.id,
        eventType: "generate_first_draft",
        refTable: "agent_data",
        refId: null,
        payload: {
          agentNumber: 2,
          provisionalDraft: result.patentableIdeas || result.draftSpecification || result.provisionalDraft,
          isRefinement,
        },
      });

      res.json({
        success: true,
        provisionalDraft: result.patentableIdeas || result.draftSpecification || result.provisionalDraft
      });
    } catch (error: any) {
      console.error("Draft generation error:", error);
      res.status(500).json({ message: "An unexpected error occurred. Please try again." });
    }
  });

  // Module 2b: Extract patentable ideas from draft
  app.post("/api/projects/:id/agent/2/extract-ideas", isAuthenticated, async (req, res) => {
    try {
      // Clear all downstream data when re-extracting ideas at stage 2b
      await clearDownstreamData(req.params.id, '2b');

      const agent2Data = await storage.getAgentData(req.params.id, 2);
      
      console.log("Agent 2 data keys:", agent2Data?.data ? Object.keys(agent2Data.data as any) : "no data");
      
      // Support both field names for backward compatibility
      const provisionalDraft = (agent2Data?.data as any)?.provisionalDraft || (agent2Data?.data as any)?.patentableIdeas;
      
      if (!agent2Data?.data || !provisionalDraft) {
        console.log("No draft found. Available fields:", Object.keys(agent2Data?.data || {}));
        return res.status(400).json({ 
          message: "Provisional draft not found. Please generate the draft first." 
        });
      }
      const comprehensiveSummary = (agent2Data.data as any).comprehensiveSummary;

      // Fetch source code files from project if available
      const project = await storage.getProject(req.params.id);
      let codeFromTheUser = "";
      const sourceCodeFiles = project?.sourceCodeFiles || [];
      if (sourceCodeFiles.length > 0) {
        codeFromTheUser = sourceCodeFiles.map((file: any, index: number) => {
          const fileName = file.fileName || `Code File ${index + 1}`;
          const description = file.description || "No description provided";
          return `=== ${fileName} ===\nDescription: ${description}\n\nCode:\n${file.code}`;
        }).join("\n\n---\n\n");
      }

      console.log("Calling Module 2/2b extract-concepts agent...");

      const extractResult = await runExtractConcepts({
        sessionId: comprehensiveSummary?.sessionId,
        detailedConcept: provisionalDraft,
        codeFromTheUser: codeFromTheUser || undefined,
        category: comprehensiveSummary?.category || "Software",
      });

      if (!extractResult.success) {
        return res.status(503).json({ message: extractResult.error });
      }

      const ideas = extractResult.ideas.map((text, index) => ({
        id: `concept-${index + 1}-${Date.now()}`,
        text,
      }));

      // ─── Capture filtered ideas (refiner-rejected) for inventor review ───
      // The refiner culls 85–95% of extractor candidates by design (default
      // to rejection per LAW_2). Previously the rejected items vanished
      // with no record. Persist them alongside `extractedIdeas` so the UI
      // can render a "removed during refinement" tray with Restore buttons,
      // giving the inventor visibility into what was dropped and the ability
      // to override the refiner's judgment when they disagree.
      const filteredIdeasRaw = (extractResult as { filteredIdeas?: string[] }).filteredIdeas ?? [];
      const filteredIdeas = filteredIdeasRaw.map((text, index) => ({
        id: `filtered-${index + 1}-${Date.now()}`,
        text,
      }));

      console.log(`Extracted ${ideas.length} patentable concepts (${filteredIdeas.length} filtered out)`);

      // Store extracted ideas
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...(agent2Data.data as any),
          extractedIdeas: ideas,
          filteredIdeas,
          status: 'ideas_extracted',
          ideasExtractedAt: new Date().toISOString(),
        },
      });

      // Automatically advance to substage 2b
      await storage.updateProject(req.params.id, { 
        currentStage: 2,
        currentSubstage: '2b' 
      });

      res.json({ 
        success: true,
        ideas: ideas
      });
    } catch (error: any) {
      console.error("Extract ideas error:", error);
      sendServerError(res, error, "Failed to extract ideas. Please try again.");
    }
  });

  // Module 2b: Add custom idea (user manually adds an idea the AI missed)
  app.post("/api/projects/:id/agent/2/add-custom-idea", isAuthenticated, async (req, res) => {
    try {
      const { text } = req.body;
      
      if (!text || !text.trim()) {
        return res.status(400).json({ message: "Idea text is required" });
      }

      // Get Agent 2 data
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      if (!agent2Data?.data) {
        return res.status(400).json({ message: "Agent 2 data not found. Please extract ideas first." });
      }

      const extractedIdeas = (agent2Data.data as any).extractedIdeas || [];
      
      // Create custom idea with unique ID
      const customIdea = {
        id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: text.trim(),
        isCustom: true, // Flag to identify manually added ideas
      };

      // Add custom idea to the list
      const updatedIdeas = [...extractedIdeas, customIdea];

      // Update Agent 2 data
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...(agent2Data.data as any),
          extractedIdeas: updatedIdeas,
        },
      });

      res.json({
        success: true,
        idea: customIdea
      });
    } catch (error: any) {
      console.error("Add custom idea error:", error);
      sendServerError(res, error, "Failed to add idea");
    }
  });

  // Module 2b: Restore an idea that was filtered out by the refiner.
  // The refiner aggressively culls extractor candidates (85–95% rejection
  // rate by design). When the inventor disagrees with a specific rejection,
  // this endpoint moves the item from `filteredIdeas` back into
  // `extractedIdeas` so it participates in the rest of the workflow. The
  // restore is also logged to the human-input ledger as proof-of-conception
  // material — the act of restoring a specific concept is a strong signal
  // that the inventor considers it part of their invention.
  app.post("/api/projects/:id/agent/2/restore-filtered-idea", isAuthenticated, async (req, res) => {
    try {
      const { id: filteredId } = req.body ?? {};
      if (!filteredId || typeof filteredId !== "string") {
        return res.status(400).json({ message: "Filtered idea id is required" });
      }

      const agent2Data = await storage.getAgentData(req.params.id, 2);
      if (!agent2Data?.data) {
        return res.status(400).json({ message: "Agent 2 data not found. Please extract ideas first." });
      }

      const extractedIdeas = (agent2Data.data as any).extractedIdeas || [];
      const filteredIdeas = (agent2Data.data as any).filteredIdeas || [];

      const target = filteredIdeas.find((f: any) => f.id === filteredId);
      if (!target) {
        return res.status(404).json({ message: "Filtered idea not found" });
      }

      // Mint a fresh id for the restored idea so it doesn't collide with the
      // filtered-list id namespace, and tag it `restoredFromFilter` so the
      // UI can mark it visually if desired.
      const restoredIdea = {
        id: `restored-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        text: target.text,
        restoredFromFilter: true,
      };

      const updatedExtracted = [...extractedIdeas, restoredIdea];
      const updatedFiltered = filteredIdeas.filter((f: any) => f.id !== filteredId);

      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...(agent2Data.data as any),
          extractedIdeas: updatedExtracted,
          filteredIdeas: updatedFiltered,
        },
      });

      res.json({
        success: true,
        idea: restoredIdea,
      });
    } catch (error: any) {
      console.error("Restore filtered idea error:", error);
      sendServerError(res, error, "Failed to restore idea");
    }
  });

  // Module 2b: Proceed to Prior Art Research with selected ideas
  app.post("/api/projects/:id/agent/2/proceed", isAuthenticated, async (req, res) => {
    try {
      const { selectedIdeaIds } = req.body;
      
      if (!selectedIdeaIds || !Array.isArray(selectedIdeaIds) || selectedIdeaIds.length === 0) {
        return res.status(400).json({ message: "Please select at least one idea to proceed." });
      }

      // Get Agent 2 data
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      if (!agent2Data?.data) {
        return res.status(400).json({ message: "Agent 2 data not found" });
      }

      const extractedIdeas = (agent2Data.data as any).extractedIdeas || [];
      
      // Mark selected ideas
      const updatedIdeas = extractedIdeas.map((idea: any) => ({
        ...idea,
        selected: selectedIdeaIds.includes(idea.id),
      }));

      // Get only selected ideas for Agent 3
      const selectedIdeas = updatedIdeas.filter((idea: any) => idea.selected);

      // Update Agent 2 with selection
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 2,
        data: {
          ...(agent2Data.data as any),
          extractedIdeas: updatedIdeas,
          status: 'ideas_approved',
        },
      });

      const comprehensiveSummary = (agent2Data.data as any).comprehensiveSummary;

      // Immediately trigger prior art search
      console.log("Starting prior art search...");
      const webhookUrl = N8N_MULTI_CONCEPT_SEARCH_WEBHOOK;
      
      const webhookPayload = {
        sessionId: comprehensiveSummary?.sessionId,
        category: comprehensiveSummary?.category || "Software",
        concepts: selectedIdeas.map((idea: any) => ({
          id: idea.id,
          concept: idea.text || idea.title || idea.description || "Untitled Concept",
        })),
      };

      console.log("Prior art webhook payload:", JSON.stringify(webhookPayload, null, 2));
      
      const result = await sendWebhook(webhookUrl, webhookPayload);
      console.log("Prior art search complete:", JSON.stringify(result).substring(0, 200));

      // Transform n8n response format to our expected format
      // n8n returns: [{ timestamp, total_concepts, total_patents, results: { "concept text": [...patents] } }]
      const rawResults = Array.isArray(result) ? result[0] : result;
      const conceptResults = rawResults?.results || {};
      
      // Map concept texts back to IDs
      const priorArtResults = selectedIdeas.map((idea: any) => {
        const conceptText = idea.text || idea.title || idea.description;
        const patents = conceptResults[conceptText] || [];
        
        return {
          conceptId: idea.id,
          conceptTitle: conceptText,
          priorArt: patents.map((patent: any) => ({
            title: patent.title || '',
            url: patent.patent_url || '',
            relevanceScore: parseFloat(patent.distance_score) || 0,
            summary: patent.abstract || '',
            publicationDate: patent.publication_number || '',
            publicationNumber: patent.publication_number || '',
            rank: patent.rank || 0,
          })),
        };
      });

      // Store Agent 3 results
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 3,
        data: {
          selectedIdeas,
          status: 'search_complete',
          priorArtResults,
          searchMetadata: {
            timestamp: rawResults?.timestamp,
            totalConcepts: rawResults?.total_concepts,
            totalPatents: rawResults?.total_patents,
            searchedAt: new Date().toISOString(),
          },
          searchedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      });

      // Advance to Agent 3
      await storage.updateProject(req.params.id, { currentStage: 3 });

      res.json({ 
        success: true, 
        selectedCount: selectedIdeas.length,
        priorArtResults: result.priorArtResults || []
      });
    } catch (error: any) {
      console.error("Proceed to Agent 3 error:", error);
      sendServerError(res, error, "Failed to proceed to prior art research");
    }
  });

  // Substage progression (for Agent 2 and Agent 4 substages)
  app.post("/api/projects/:id/substage/proceed", isAuthenticated, async (req, res) => {
    try {
      const { substage } = req.body;
      
      if (!substage) {
        return res.status(400).json({ message: "Substage is required" });
      }

      // Get current project to validate progression
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const currentSubstage = project.currentSubstage || '';
      
      // If already at target substage, just succeed (idempotent operation)
      if (currentSubstage === substage) {
        return res.json({ success: true, substage, alreadyAtSubstage: true });
      }

      // Enforce sequential substage progression
      const validTransitions: Record<string, string[]> = {
        '2a': ['2b'],
        '2b': [], // Goes to Agent 3 via /agent/2/proceed
        '4a': ['4b'],
        '4b': ['4c'],
        '4c': [], // Goes to Agent 5 via /agent/4/proceed
      };

      const allowedNext = validTransitions[currentSubstage] || [];

      // Idempotent for backward moves too: if the project is already past the
      // requested substage (e.g. user rolled back the UI and triggered a
      // generate-claims flow that targets 4b again while DB still says 4c),
      // accept the call as a no-op rather than 400. The user shouldn't get a
      // hostile error just because their saved state is ahead of the page
      // they're acting on.
      const substageOrder = ['2a', '2b', '4a', '4b', '4c'];
      const currentIdx = substageOrder.indexOf(currentSubstage);
      const targetIdx = substageOrder.indexOf(substage);
      if (currentIdx >= 0 && targetIdx >= 0 && currentIdx > targetIdx) {
        return res.json({ success: true, substage, alreadyPastSubstage: true });
      }

      if (!allowedNext.includes(substage)) {
        return res.status(400).json({
          message: `Invalid substage progression. Cannot move from ${currentSubstage} to ${substage}. Expected one of: ${allowedNext.join(', ') || 'none'}`
        });
      }

      // Update project substage
      await storage.updateProject(req.params.id, { currentSubstage: substage });

      res.json({ success: true, substage });
    } catch (error: any) {
      console.error("Substage proceed error:", error);
      sendServerError(res, error, "Failed to proceed to next substage");
    }
  });

  // Agent 3: Start Prior Art Search
  app.post("/api/projects/:id/agent/3/search", isAuthenticated, async (req, res) => {
    try {
      // Clear all downstream data when re-running prior art search at stage 3
      await clearDownstreamData(req.params.id, '3');

      // Get Agent 2 data to retrieve selected ideas
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      
      if (!agent2Data?.data) {
        return res.status(400).json({ message: "No Agent 2 data found" });
      }

      const agent2DataObj = agent2Data.data as any;
      const selectedIdeas = agent2DataObj.extractedIdeas?.filter((idea: any) => idea.selected) || [];
      
      if (selectedIdeas.length === 0) {
        return res.status(400).json({ message: "No ideas selected for prior art research" });
      }

      const comprehensiveSummary = agent2DataObj.comprehensiveSummary;

      // Call webhook for prior art search
      const webhookUrl = N8N_MULTI_CONCEPT_SEARCH_WEBHOOK;
      
      const webhookPayload = {
        sessionId: comprehensiveSummary?.sessionId,
        category: comprehensiveSummary?.category || "Software",
        concepts: selectedIdeas.map((idea: any) => ({
          id: idea.id,
          concept: idea.text || idea.title || idea.description || "Untitled Concept",
        })),
      };

      console.log("Calling prior art search webhook...");
      console.log("Payload:", JSON.stringify(webhookPayload, null, 2));
      
      const result = await sendWebhook(webhookUrl, webhookPayload);
      console.log("Prior art search response received:", JSON.stringify(result).substring(0, 200));

      // Transform n8n response format to our expected format
      // n8n returns: [{ timestamp, total_concepts, total_patents, results: { "concept text": [...patents] } }]
      const rawResults = Array.isArray(result) ? result[0] : result;
      const conceptResults = rawResults?.results || {};
      
      // Map concept texts back to IDs
      const priorArtResults = selectedIdeas.map((idea: any) => {
        const conceptText = idea.text || idea.title || idea.description;
        const patents = conceptResults[conceptText] || [];
        
        return {
          conceptId: idea.id,
          conceptTitle: conceptText,
          priorArt: patents.map((patent: any) => ({
            title: patent.title || '',
            url: patent.patent_url || '',
            relevanceScore: parseFloat(patent.distance_score) || 0,
            summary: patent.abstract || '',
            publicationDate: patent.publication_number || '',
            publicationNumber: patent.publication_number || '',
            rank: patent.rank || 0,
          })),
        };
      });

      // Create snapshot for selected ideas before prior art search (Agent 2b)
      const selectedIdeasVersion = await storage.getNextSnapshotVersion(req.params.id);
      const selectedIdeasContent = selectedIdeas.map((idea: any, i: number) => 
        `${i + 1}. **${idea.text || idea.title || 'Untitled'}**`
      ).join('\n');
      
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: selectedIdeasVersion,
        snapshotType: '2b_selected_ideas',
        title: `${selectedIdeas.length} Ideas Selected`,
        content: `**Selected Ideas for Patent Protection:**\n\n${selectedIdeasContent}`,
        metadata: { 
          stage: 2,
          substage: '2b',
          selectedCount: selectedIdeas.length,
          selectedIds: selectedIdeas.map((i: any) => i.id),
        },
      });

      // Store results
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 3,
        data: {
          status: 'search_complete',
          priorArtResults,
          searchMetadata: {
            timestamp: rawResults?.timestamp,
            totalConcepts: rawResults?.total_concepts,
            totalPatents: rawResults?.total_patents,
            searchedAt: new Date().toISOString(),
          },
          searchedAt: new Date().toISOString(),
        },
      });

      // Create snapshot for prior art research (Agent 3)
      const priorArtVersion = await storage.getNextSnapshotVersion(req.params.id);
      const totalPatentsFound = priorArtResults.reduce((sum: number, r: any) => sum + (r.priorArt?.length || 0), 0);
      const priorArtContent = priorArtResults.map((result: any) => {
        const patentCount = result.priorArt?.length || 0;
        return `**${result.conceptTitle}**: ${patentCount} prior art references found`;
      }).join('\n');
      
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: priorArtVersion,
        snapshotType: '3_prior_art',
        title: `Prior Art Research Complete`,
        content: `**Prior Art Analysis:**\n\n${priorArtContent}\n\n_Total: ${totalPatentsFound} patents analyzed across ${priorArtResults.length} concepts_`,
        metadata: { 
          stage: 3,
          totalPatents: totalPatentsFound,
          conceptCount: priorArtResults.length,
          priorArtResults: priorArtResults.map((r: any) => ({
            conceptId: r.conceptId,
            conceptTitle: r.conceptTitle,
            patentCount: r.priorArt?.length || 0,
          })),
        },
      });

      res.json({ 
        success: true,
        results: priorArtResults
      });
    } catch (error: any) {
      console.error("Prior art search error:", error);
      sendServerError(res, error, "Failed to search prior art. Please try again.");
    }
  });

  // Auto-save agent 3 data
  app.post("/api/projects/:id/agent/3", isAuthenticated, async (req, res) => {
    try {
      const existingData = await storage.getAgentData(req.params.id, 3);
      const savedData = await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 3,
        data: { ...(existingData?.data || {}), ...req.body },
      });

      res.json(savedData);
    } catch (error: any) {
      console.error("Save agent 3 data error:", error);
      res.status(500).json({ message: "Failed to save data" });
    }
  });

  // Submit agent 3 - triggers white space analysis webhook
  app.post("/api/projects/:id/agent/3/submit", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Get Agent 1 data for session ID
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const sessionId = (agent1Data?.data as any)?.sessionId || req.params.id;

      // Get Agent 2 data for expanded concept and selected ideas
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent2DataObj = agent2Data?.data as any;
      
      const expandedConcept = agent2DataObj?.provisionalDraft || 
                             agent2DataObj?.draftSpecification || 
                             "";
      
      const selectedIdeas = (agent2DataObj?.extractedIdeas || [])
        .filter((idea: any) => idea.selected)
        .map((idea: any) => ({
          id: idea.id,
          text: idea.text
        }));

      // Get Agent 3 data for prior art results
      const agent3Data = await storage.getAgentData(req.params.id, 3);
      const priorArtResults = (agent3Data?.data as any)?.priorArtResults || [];

      // Prepare webhook payload
      const webhookPayload = {
        sessionId,
        category: project.category ?? undefined,
        expandedConcept,
        selectedIdeas,
        priorArtResults: priorArtResults.map((result: any) => ({
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

      // Enrich concept analyses with fallback conceptTitle from priorArtResults
      const enrichedConceptAnalyses = (webhookResponse.conceptAnalyses || []).map((concept: any, index: number) => {
        const matchingPriorArt = priorArtResults[index];
        return {
          ...concept,
          conceptTitle: concept.conceptTitle || matchingPriorArt?.conceptTitle || '',
        };
      });

      // Store the response in Agent 4 data with enriched concept titles
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          status: 'analysis_complete',
          ...webhookResponse,
          conceptAnalyses: enrichedConceptAnalyses.length > 0 ? enrichedConceptAnalyses : undefined,
          analyzedAt: new Date().toISOString()
        },
      });

      // Create snapshot for white space analysis (Agent 4a)
      const whiteSpaceVersion = await storage.getNextSnapshotVersion(req.params.id);
      const whiteSpaceContent = enrichedConceptAnalyses.map((concept: any, idx: number) => {
        const patentCount = concept.patentAnalyses?.length || 0;
        return `**Concept ${idx + 1}: ${concept.conceptTitle || 'Untitled'}**\n- Risk Level: ${concept.overallRiskLevel || 'Unknown'}\n- Patents Analyzed: ${patentCount}`;
      }).join('\n\n');
      
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: whiteSpaceVersion,
        snapshotType: '4a_white_space',
        title: 'White Space Analysis Complete',
        content: `**Strategic Direction:**\n${webhookResponse?.strategicDirective || 'Analysis complete'}\n\n**Concept Analysis:**\n\n${whiteSpaceContent}`,
        metadata: { 
          stage: 4,
          substage: '4a',
          conceptCount: enrichedConceptAnalyses.length,
          strategicDirective: webhookResponse?.strategicDirective,
        },
      });

      // Update project to Agent 4a
      await storage.updateProject(req.params.id, { currentStage: 4, currentSubstage: '4a' });
      
      res.json({ success: true, results: webhookResponse });
    } catch (error: any) {
      console.error("White space analysis error:", error);
      sendServerError(res, error, "Failed to complete white space analysis. Please try again.");
    }
  });

  // Generate patent claims (Agent 4b)
  app.post("/api/projects/:id/agent/4b/generate-claims", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // AI fires only once: if claim variations are already stored for this
      // project, return them rather than re-firing the agent. Callers can
      // force a fresh run with { regenerate: true } in the body (used by the
      // "Regenerate" UI affordance), in which case we fall through to the
      // generation path below.
      const existingAgent4 = await storage.getAgentData(req.params.id, 4);
      const existingAgent4Obj = existingAgent4?.data as any;
      const existingVariations = Array.isArray(existingAgent4Obj?.claimVariations)
        ? existingAgent4Obj.claimVariations
        : null;
      const forceRegenerate = req.body?.regenerate === true;
      if (existingVariations && existingVariations.length > 0 && !forceRegenerate) {
        return res.json({
          success: true,
          alreadyGenerated: true,
          variationsCount: existingVariations.length,
          variations: existingVariations,
        });
      }

      // Get Agent 1 data for session ID and main idea
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const agent1DataObj = agent1Data?.data as any;
      const sessionId = agent1DataObj?.sessionId || req.params.id;
      const mainIdea = agent1DataObj?.ideaSummary || "";

      // Get Agent 2 data for expanded concept and selected ideas
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent2DataObj = agent2Data?.data as any;
      
      const expandedConcept = agent2DataObj?.provisionalDraft || 
                             agent2DataObj?.draftSpecification || 
                             "";
      
      const selectedIdeas = (agent2DataObj?.extractedIdeas || [])
        .filter((idea: any) => idea.selected)
        .map((idea: any) => ({
          id: idea.id,
          text: idea.text
        }));

      // Get Agent 4 data for white space analysis
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent4DataObj = agent4Data?.data as any;
      const analysisResults = Array.isArray(agent4DataObj) ? agent4DataObj[0] : agent4DataObj || {};

      // Prepare comprehensive webhook payload with all context for claims drafting
      const webhookPayload = {
        sessionId,
        category: project.category ?? undefined,
        mainIdea,
        expandedConcept,
        selectedIdeas,
        whiteSpaceAnalysis: {
          strategicDirective: analysisResults.strategicDirective || "",
          nuggetAnalyses: analysisResults.nuggetAnalyses || [],
        }
      };

      console.log("Calling Module 4/4b claims agent...");
      const claimsResult = await runClaims(webhookPayload);
      if (!claimsResult.success) {
        return res.status(503).json({ message: claimsResult.error });
      }
      const webhookResponse: any = { data: claimsResult.data };
      let claimVariations: any[] = claimsResult.data;

      // Helper function to parse raw_output - handles both JSON and plain text formats
      const parseRawOutput = (rawOutput: string): any => {
        if (!rawOutput) return null;
        
        // First try JSON parsing
        try {
          const cleaned = rawOutput.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          return JSON.parse(cleaned);
        } catch (e) {
          // Not JSON - parse as plain text claims format
        }
        
        // Parse plain text claims format
        try {
          const text = rawOutput.trim();
          
          // Extract inventive concept
          const conceptMatch = text.match(/(?:\*\*)?Inventive Concept[^)]*\)?(?:\*\*)?\s*\n+([\s\S]*?)(?=\n\s*(?:\*\*)?(?:Exemplary Claim|Claim\s*\d))/i);
          const inventiveConcept = conceptMatch ? conceptMatch[1].trim() : '';
          
          // Extract all claims using regex
          const claimPattern = /(?:\*\*)?Claim\s*(\d+)\s*\(([^)]+)\)(?:\*\*)?\s*\n+([\s\S]*?)(?=(?:\n\s*(?:\*\*)?Claim\s*\d)|(?:\n\s*Claims?\s*\d+-?\d*\s*\()|$)/gi;
          const claims: any[] = [];
          let match;
          
          while ((match = claimPattern.exec(text)) !== null) {
            const keyConceptNumber = parseInt(match[1]);
            const claimType = match[2].toLowerCase();
            const keyConceptText = match[3].trim();
            
            const isIndependent = claimType.includes('independent');
            const isDependent = claimType.includes('dependent');
            
            claims.push({
              number: keyConceptNumber,
              type: isIndependent ? 'independent' : 'dependent',
              label: `Claim ${keyConceptNumber} (${match[2].trim()})`,
              text: keyConceptText,
              claimType: isIndependent ? 'independent' : 'dependent'
            });
          }
          
          // Separate independent and dependent claims
          const independentClaims = claims.filter(c => c.type === 'independent');
          const dependentClaims = claims.filter(c => c.type === 'dependent');
          
          if (claims.length > 0) {
            return {
              inventive_concept: inventiveConcept,
              independent_claim: independentClaims[0]?.text || '',
              dependent_claims: dependentClaims.map(c => c.text),
              claims: claims,
              claims_count: claims.length,
              statutory_class: independentClaims[0]?.label?.match(/System|Method|Medium/i)?.[0] || 'System'
            };
          }
          
          return null;
        } catch (e) {
          console.error("Failed to parse text claims format:", e);
          return null;
        }
      };

      // Normalize each variation into a consistent structure
      const normalizedVariations = claimVariations
        .map((variation: any) => {
          // If data is in raw_output, parse it
          if (variation.raw_output && !variation.independent_claim && !variation.claims) {
            const parsed = parseRawOutput(variation.raw_output);
            if (parsed) {
              // Merge parsed data with original variation
              return { ...variation, ...parsed };
            }
          }
          return variation;
        })
        .filter((v: any) => {
          // Must have actual claim content
          const hasValidClaims = v && (
            (v.claims && v.claims.length > 0) || 
            (v.independent_claim || v.independentClaim)
          );
          return hasValidClaims;
        })
        .map((variation: any, index: number) => {
          console.log(`Processing variation ${index}:`, {
            hasClaims: !!variation.claims,
            claimsCount: variation.claims?.length,
            hasInventiveConcept: !!variation.inventive_concept,
            claimType: variation.claim_type
          });
          
          // Extract claims from the new structured format
          const allClaims = variation.claims || [];
          
          // Get independent claim - prefer from claims array, fallback to independent_claim field
          let independentClaimText = "";
          const independentClaimObj = allClaims.find((c: any) => c.type === 'independent');
          if (independentClaimObj?.text) {
            independentClaimText = independentClaimObj.text;
          } else {
            independentClaimText = variation.independent_claim || variation.independentClaim || "";
          }
          
          // Get dependent claims - prefer from claims array, fallback to dependent_claims field
          let dependentClaimsArray: string[] = [];
          const dependentClaimObjs = allClaims.filter((c: any) => c.type === 'dependent');
          if (dependentClaimObjs.length > 0) {
            // Sort by claim number and extract text
            dependentClaimsArray = dependentClaimObjs
              .sort((a: any, b: any) => (a.number || 0) - (b.number || 0))
              .map((c: any) => c.text);
          } else {
            // Fallback to dependent_claims field
            const rawDependentClaims = variation.dependent_claims || variation.dependentClaims || [];
            dependentClaimsArray = rawDependentClaims.map((claim: any) => {
              if (typeof claim === 'string') return claim;
              if (typeof claim === 'object' && claim.text) return claim.text;
              return String(claim);
            });
          }
          
          // Determine statutory class from claim_type or first claim's claimType
          const statutoryClass = variation.claim_type || 
            variation.statutory_class || 
            variation.statutoryClass ||
            independentClaimObj?.claimType ||
            "system";

          return {
            id: `variation-${index}`,
            index,
            inventiveConcept: variation.inventive_concept || variation.inventiveConcept || "",
            statutoryClass: statutoryClass.charAt(0).toUpperCase() + statutoryClass.slice(1), // Capitalize
            strategySummary: variation.strategy_summary || variation.strategySummary || variation.inventive_concept || "",
            claimsCount: variation.claims_count || variation.claimsCount || allClaims.length || 0,
            independentClaim: independentClaimText,
            dependentClaims: dependentClaimsArray,
            claims: allClaims, // Include full claims array with all metadata
            claimType: variation.claim_type || "system", // Preserve claim type (system/method)
            dependencyTree: variation.dependency_tree || null, // Preserve dependency tree
            timestamp: variation.timestamp || new Date().toISOString(),
          };
        });

      // Get existing agent 4 data and merge with normalized claims
      const existingData = agent4Data?.data || {};
      
      // Store the normalized claims structure in Agent 4 data
      // IMPORTANT: Clear old selections when new claims are generated
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          ...existingData,
          status: 'claims_generated',
          claimVariations: normalizedVariations,
          selectedVariationId: null, // User hasn't selected yet
          selectedKeyConcepts: null, // Clear old selections - user must re-select from new claims
          editedClaims: null, // No edits yet
          rawClaimsResponse: webhookResponse, // Keep raw response for debugging
          claimsGeneratedAt: new Date().toISOString()
        },
      });

      res.json({ 
        success: true, 
        variationsCount: normalizedVariations.length,
        variations: normalizedVariations 
      });
    } catch (error: any) {
      console.error("Claims generation error:", error);
      sendServerError(res, error, "Failed to generate claims. Please try again.");
    }
  });

  // Select individual claims (Agent 4b) - user picks what's in and what's out
  app.post("/api/projects/:id/agent/4b/select-concepts", isAuthenticated, async (req, res) => {
    try {
      const { selectedKeyConcepts } = req.body;

      console.log("[SELECT-CLAIMS] Received selectedKeyConcepts:", selectedKeyConcepts ? `${selectedKeyConcepts.length} items` : 'UNDEFINED');

      if (!selectedKeyConcepts || !Array.isArray(selectedKeyConcepts)) {
        return res.status(400).json({ message: "Selected claims array is required" });
      }

      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const existingData = agent4Data?.data || {};

      console.log("[SELECT-CLAIMS] About to save, existingData keys:", Object.keys(existingData));

      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          ...existingData,
          selectedKeyConcepts, // Array of individual claims chosen by user
          claimsSelectedAt: new Date().toISOString()
        },
      });

      console.log("[SELECT-CLAIMS] Successfully saved", selectedKeyConcepts.length, "selected key concepts");

      // Create snapshot for claims selection (Agent 4b)
      const claimsVersion = await storage.getNextSnapshotVersion(req.params.id);
      // Group by primary vs. supporting key concepts. The underlying data
      // still uses the legacy `independent` / `dependent` labels from the
      // upstream agent — we read those internally but render neutral
      // user-facing language ("primary" / "supporting") in the snapshot
      // content so the Invention Record never uses legal-practice vocabulary.
      const primaryKeyConcepts = selectedKeyConcepts.filter((c: any) =>
        c.type === 'independent' || c.claimType === 'independent' || c.label?.includes('Independent')
      );
      const supportingKeyConcepts = selectedKeyConcepts.filter((c: any) =>
        c.type === 'dependent' || c.claimType === 'dependent' || c.label?.includes('Dependent')
      );

      const keyConceptsContent =
        `**Key Concepts Selected:**\n\n` +
        `**Primary Key Concepts (${primaryKeyConcepts.length}):**\n${primaryKeyConcepts.map((c: any, i: number) => `${i + 1}. ${c.text?.substring(0, 150)}...`).join('\n')}\n\n` +
        `**Supporting Key Concepts (${supportingKeyConcepts.length}):**\n${supportingKeyConcepts.map((c: any, i: number) => `${i + 1}. ${c.text?.substring(0, 100)}...`).join('\n')}`;

      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: claimsVersion,
        snapshotType: '4b_claims',
        title: `${selectedKeyConcepts.length} Key Concepts Selected`,
        content: keyConceptsContent,
        metadata: {
          stage: 4,
          substage: '4b',
          totalKeyConcepts: selectedKeyConcepts.length,
          primaryCount: primaryKeyConcepts.length,
          supportingCount: supportingKeyConcepts.length,
        },
      });

      res.json({ success: true, selectedKeyConceptsCount: selectedKeyConcepts.length });
    } catch (error: any) {
      console.error("Select claims error:", error);
      sendServerError(res, error, "Failed to save selected claims");
    }
  });

  // Regenerate provisional draft (retry) - keeps diagrams intact
  app.post("/api/projects/:id/regenerate-draft", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const sessionId = (project as any).sessionId || `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

      // Get agent data
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent4Data = await storage.getAgentData(req.params.id, 4);

      const agent1DataObj = agent1Data?.data as any;
      const agent2DataObj = agent2Data?.data as any;
      const agent4DataObj = agent4Data?.data as any;

      console.log("[REGENERATE-DRAFT] Full agent4Data structure:", {
        hasData: !!agent4DataObj,
        topLevelKeys: Object.keys(agent4DataObj || {}),
        selectedKeyConcepts: agent4DataObj?.selectedKeyConcepts ? `${agent4DataObj.selectedKeyConcepts.length} items` : 'NOT FOUND',
        selectedClaims: agent4DataObj?.selectedClaims ? `${agent4DataObj.selectedClaims.length} items` : 'NOT FOUND',
      });
      
      const mainIdea = agent1DataObj?.ideaSummary || agent1DataObj?.currentIdea || "";
      const expandedConcept = agent2DataObj?.provisionalDraft || agent2DataObj?.draftSpecification || "";
      const selectedKeyConcepts = agent4DataObj?.selectedKeyConcepts || agent4DataObj?.selectedClaims || [];

      console.log("=== REGENERATE DEBUG ===");
      console.log("Agent4 keys:", Object.keys(agent4DataObj || {}));
      console.log("selectedKeyConcepts exists?", !!agent4DataObj?.selectedKeyConcepts);
      console.log("selectedClaims exists?", !!agent4DataObj?.selectedClaims);
      console.log("selectedKeyConcepts value:", JSON.stringify(selectedKeyConcepts).substring(0, 200));

      if (selectedKeyConcepts.length === 0) {
        console.log("ERROR: No key concepts found in agent 4 data");
        return res.status(400).json({ message: "No key concepts found. Cannot regenerate draft." });
      }

      console.log("Regenerating provisional patent draft with", selectedKeyConcepts.length, "key concepts...");

      // Format key concepts for webhook - preserve original numbering
      let dependentCount = 0;
      const formattedConcepts = selectedKeyConcepts.map((concept: any) => {
        let conceptType: string;
        const typeStr = String(concept.type || '').toLowerCase();
        if (typeStr.includes('independent')) {
          conceptType = 'independent';
        } else {
          dependentCount++;
          conceptType = `dependent ${dependentCount}`;
        }
        return {
          type: conceptType,
          text: concept.text,
          number: concept.number,
          parentConcept: concept.parentConcept || null
        };
      });

      const webhookPayload = {
        sessionId,
        category: project.category ?? undefined,
        coreIdea: mainIdea,
        expandedConcept,
        selectedKeyConcepts: formattedConcepts
      };

      // Warn-before-overwrite: regenerate replaces the ENTIRE draft (all 7
      // sections) from the upstream Agent 4 concepts, so any hand-edited section
      // on the Showcase would be lost. Abort with 409 before the n8n webhook runs
      // if there are hand-edits and the client hasn't confirmed.
      const a5Pre = await storage.getAgentData(req.params.id, 5);
      const a5PreEdits = ((a5Pre?.data as any)?.manualEdits ?? {}) as Record<string, any>;
      const regenConflicts = ['title', 'background', 'summary', 'detailed_description', 'ramifications_and_scope', 'abstract', 'claims'].filter((s) => a5PreEdits[s]);
      if (regenConflicts.length > 0 && req.body.confirmOverwrite !== true) {
        return res.status(409).json({ needsConfirmation: true, editedSections: regenConflicts });
      }

      console.log("Calling provisional patent writing webhook for regeneration...");
      const rawWebhookResponse: any = await runProvisional(webhookPayload);
      if (rawWebhookResponse && rawWebhookResponse.success === false) {
        return res.status(503).json({ message: rawWebhookResponse.error || "Provisional generation failed" });
      }
      
      // Handle array-wrapped response
      const provisionalDraft = Array.isArray(rawWebhookResponse) ? rawWebhookResponse[0] : rawWebhookResponse;

      // Validate that we got actual data back - don't overwrite with empty response
      if (!provisionalDraft || Object.keys(provisionalDraft).length === 0) {
        console.error("Webhook returned empty response");
        return res.status(500).json({ 
          message: "The draft generation service returned empty data. Please check your n8n workflow configuration and try again." 
        });
      }

      // Update agent 4 data with new provisional draft
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          ...agent4DataObj,
          provisionalDraft,
          provisionalRegeneratedAt: new Date().toISOString()
        },
      });

      // Also update agent 5 data if it exists (to reflect new draft in showcase)
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      if (agent5Data) {
        const agent5DataObj = agent5Data.data as any;
        await storage.upsertAgentData({
          projectId: req.params.id,
          agentNumber: 5,
          data: {
            ...agent5DataObj,
            provisionalDraft, // Update the draft but keep diagrams
            manualEdits: {}, // whole draft regenerated — all hand-edit markers are now stale
          },
        });
      }

      console.log("Provisional draft regenerated successfully");
      res.json({ 
        success: true, 
        provisionalDraft 
      });
    } catch (error: any) {
      console.error("Regenerate draft error:", error);
      sendServerError(res, error, "Failed to regenerate draft. Please try again.");
    }
  });

  // Generate broader claims - calls n8n webhook for claim expansion
  app.post("/api/projects/:id/generate-broader-claims", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      console.log("Generate broader claims requested for project:", req.params.id);

      // Get Agent 5 data for provisional draft and diagrams
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5DataObj = agent5Data?.data as any;
      
      let provisionalDraft = agent5DataObj?.provisionalDraft;
      
      // Fall back to Agent 4 data if no provisional in Agent 5
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent4DataObj = agent4Data?.data as any;
      
      if (!provisionalDraft) {
        provisionalDraft = agent4DataObj?.provisionalDraft;
      }

      if (!provisionalDraft) {
        return res.status(400).json({ message: "No provisional draft found. Please complete the earlier stages first." });
      }

      // Parse provisional draft to get structured fields
      const parsedDraft = parseProvisionalDraft(provisionalDraft);

      // Format current claims from provisional draft (Broad Claims)
      const formatClaims = (claims: any[]): string => {
        if (!claims || claims.length === 0) return '';
        return claims.map((claim: any, index: number) => {
          const keyConceptText = typeof claim === 'string' ? claim : claim.text || '';
          const keyConceptNumber = claim.number || (index + 1);
          const trimmed = keyConceptText.trim();
          if (/^(Claim\s+\d+[:.:]|^\d+[.)])/i.test(trimmed)) {
            return trimmed;
          }
          return `${keyConceptNumber}. ${trimmed}`;
        }).join('\n\n');
      };

      // Build full specification document
      const fullSpecification = [
        `TITLE: ${parsedDraft.title || 'Provisional Patent Application'}`,
        '',
        '--- BACKGROUND ---',
        parsedDraft.background || '',
        '',
        '--- SUMMARY OF THE INVENTION ---',
        parsedDraft.summary || '',
        '',
        '--- DETAILED DESCRIPTION ---',
        parsedDraft.detailed_description || '',
        '',
        '--- RAMIFICATIONS AND SCOPE ---',
        parsedDraft.ramifications_and_scope || '',
        '',
        '--- ABSTRACT ---',
        parsedDraft.abstract || ''
      ].join('\n');

      // Get current claims
      const broadKeyConcepts = parsedDraft.claims || [];
      const currentClaims = formatClaims(broadKeyConcepts);

      // Get diagrams if available (for drawing descriptions)
      const diagrams = agent5DataObj?.diagrams || [];
      let drawingDescriptions = '';
      if (diagrams.length > 0) {
        drawingDescriptions = diagrams.map((diagram: any, index: number) => {
          const chartNum = diagram.chartNumber || (index + 1);
          const title = diagram.title || `Diagram ${chartNum}`;
          const markdown = diagram.markdown || diagram.diagramCode || '';
          return `Figure ${chartNum}: ${title}\n${markdown}`;
        }).join('\n\n');
      }

      // Build payload. Prior art notes come from the whitespace analysis
      // (conceptAnalyses from migrated 4a, or legacy nuggetAnalyses if old data).
      const priorArtSource = agent4DataObj?.conceptAnalyses || agent4DataObj?.nuggetAnalyses || null;
      const priorArtNotes = priorArtSource ? JSON.stringify(priorArtSource) : '';
      
      const webhookPayload = {
        patent_title: parsedDraft.title || 'Provisional Patent Application',
        one_sentence_summary: parsedDraft.summary || parsedDraft.abstract || 'Patent application for software invention',
        current_claims: currentClaims,
        full_specification: fullSpecification,
        drawing_descriptions_and_reference_numerals: drawingDescriptions || 'No diagrams generated yet',
        deep_research_notes: '',
        prior_art_notes: priorArtNotes,
        important_claim_sets: ''
      };

      console.log("Calling Module 5/5c broader claims agent pipeline...");
      console.log("prior_art_notes length:", webhookPayload.prior_art_notes?.length || 0);

      const agentResult = await runBroaderClaims(webhookPayload);
      if (!agentResult.success) {
        return res.status(503).json({ message: agentResult.error });
      }
      const response = { summary: agentResult.summary, claims: agentResult.claims };

      // Store both specific (original) and broad (new) claims separately
      // User will choose which to use in final draft via frontend modal
      console.log("Saving broader claims to database for project:", req.params.id);
      console.log("Existing agent5 keys:", agent5DataObj ? Object.keys(agent5DataObj) : 'none');
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          ...agent5DataObj,
          specificKeyConcepts: broadKeyConcepts, // Original claims from provisional (specific/narrow)
          broadKeyConcepts: response, // New claims from webhook (broader scope)
          broaderClaimsGeneratedAt: new Date().toISOString(),
          // Keep selectedClaimType if already set, default to 'specific'
          selectedClaimType: agent5DataObj?.selectedClaimType || 'specific'
        },
      });
      console.log("Broader claims saved to database successfully");

      // Create snapshot for broader claims
      const version = await storage.getNextSnapshotVersion(req.params.id);
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version,
        snapshotType: '5_broader_claims',
        title: 'Broader Claims Generated',
        content: `Broader claims generated with expanded scope and defensibility analysis.`,
        metadata: { 
          stage: 5,
          timestamp: new Date().toISOString(),
        },
      });

      res.json({ 
        success: true, 
        specificKeyConcepts: broadKeyConcepts,
        broadKeyConcepts: response,
        message: "Broader claims generated! Choose which claims to use in your final draft." 
      });
    } catch (error: any) {
      console.error("Generate broader claims error:", error);
      sendServerError(res, error, "Failed to generate broader claims.");
    }
  });

  // Update selected claim type (specific or broad)
  app.post("/api/projects/:id/select-claim-type", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const { claimType } = req.body;
      if (!claimType || !['specific', 'broad'].includes(claimType)) {
        return res.status(400).json({ message: "Invalid claim type. Must be 'specific' or 'broad'." });
      }

      // Get current Agent 5 data
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5DataObj = agent5Data?.data as any;

      // Update the selected claim type
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          ...agent5DataObj,
          selectedClaimType: claimType
        },
      });

      console.log(`Claim type updated to '${claimType}' for project ${req.params.id}`);

      res.json({ 
        success: true, 
        selectedClaimType: claimType,
        message: `${claimType === 'broad' ? 'Broader' : 'Specific'} claims selected for your final draft.` 
      });
    } catch (error: any) {
      console.error("Select claim type error:", error);
      sendServerError(res, error, "Failed to update claim type.");
    }
  });

  // Find patent practitioner - sends abstract to n8n webhook for practitioner matching
  app.post("/api/projects/:id/practitioner-match", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const userId = (req.session as any).userId;
      const sessionKind: UserKind = (req.session as any).userKind === "paid" ? "paid" : "legacy";
      const lookup = await findUserByIdAcrossTables(sessionKind, userId);
      const user = lookup?.record;

      // Get agent5 data for provisional draft
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5DataObj = agent5Data?.data as any;

      let provisionalDraft = agent5DataObj?.provisionalDraft;

      // Fall back to Agent 4 data if no provisional in Agent 5
      if (!provisionalDraft) {
        const agent4Data = await storage.getAgentData(req.params.id, 4);
        provisionalDraft = (agent4Data?.data as any)?.provisionalDraft;
      }

      if (!provisionalDraft) {
        return res.status(400).json({ message: "No provisional draft found. Please complete the earlier stages first." });
      }

      const parsedDraft = parseProvisionalDraft(provisionalDraft);
      const abstract = parsedDraft.abstract || '';

      if (!abstract) {
        return res.status(400).json({ message: "No abstract found in provisional draft." });
      }

      const webhookPayload = {
        query: abstract,
        userId: userId?.toString() || '',
        userEmail: user?.email || '',
        timestamp: new Date().toISOString(),
      };

      console.log("Calling practitioner match webhook...");
      const webhookResponse = await sendWebhook(N8N_PRACTITIONER_MATCH_WEBHOOK, webhookPayload);

      const response = Array.isArray(webhookResponse) ? webhookResponse[0] : webhookResponse;
      // Extract the matches array - response is { matches: [...] }
      const matches = response?.matches || response?.practitioners || (Array.isArray(response) ? response : null);
      console.log("Practitioner match: found", Array.isArray(matches) ? matches.length : 0, "matches");

      // Store results in agent5 data
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          ...agent5DataObj,
          practitionerMatchResults: matches,
          practitionerMatchedAt: new Date().toISOString(),
        },
      });

      res.json({ success: true, results: matches, count: Array.isArray(matches) ? matches.length : 0 });
    } catch (error: any) {
      console.error("Practitioner match error:", error);
      sendServerError(res, error, "Failed to find practitioners. Please try again.");
    }
  });

  // Finalize provisional and proceed to stage 5 (NO diagrams)
  app.post("/api/projects/:id/finalize-provisional", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const sessionId = (project as any).sessionId || `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

      // Get agent data
      const agent1Data = await storage.getAgentData(req.params.id, 1);
      const agent2Data = await storage.getAgentData(req.params.id, 2);
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      
      const agent4DataObj = agent4Data?.data as any;
      const selectedKeyConcepts = agent4DataObj?.selectedKeyConcepts || agent4DataObj?.selectedClaims || [];

      if (selectedKeyConcepts.length === 0) {
        return res.status(400).json({ message: "No claims selected. Please select at least one claim." });
      }

      console.log("Generating provisional patent (no diagrams)...");
      
      const agent1DataObj = agent1Data?.data as any;
      const mainIdea = agent1DataObj?.ideaSummary || agent1DataObj?.currentIdea || "";
      const agent2DataObj = agent2Data?.data as any;
      const expandedConcept = agent2DataObj?.provisionalDraft || agent2DataObj?.draftSpecification || "";

      const formattedKeyConcepts = selectedKeyConcepts.map((concept: any) => ({
        text: concept.text,
        number: concept.number,
      }));

      const webhookPayload = {
        sessionId,
        category: project.category ?? undefined,
        coreIdea: mainIdea,
        expandedConcept,
        selectedKeyConcepts: formattedKeyConcepts
      };

      console.log("Calling provisional patent writing webhook...");
      const rawWebhookResponse: any = await runProvisional(webhookPayload);
      if (rawWebhookResponse && rawWebhookResponse.success === false) {
        return res.status(503).json({ message: rawWebhookResponse.error || "Provisional generation failed" });
      }

      // Handle array-wrapped response
      const provisionalDraft = Array.isArray(rawWebhookResponse) ? rawWebhookResponse[0] : rawWebhookResponse;

      // Store provisional draft in Agent 4
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: {
          ...agent4DataObj,
          provisionalDraft,
          selectedKeyConcepts: selectedKeyConcepts,
          provisionalGeneratedAt: new Date().toISOString()
        },
      });

      // Store provisional in Agent 5 data (WITHOUT diagrams)
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          provisionalDraft,
          diagrams: [], // Empty - user will generate on demand
        },
      });

      // Create snapshot for provisional
      const provisionalVersion = await storage.getNextSnapshotVersion(req.params.id);
      const claimsCount = provisionalDraft?.claims_count || provisionalDraft?.claims?.length || 0;
      const provisionalContent = `**${provisionalDraft?.title || 'Provisional Patent Application'}**\n\n` +
        `**Abstract:**\n${provisionalDraft?.abstract?.substring(0, 300) || 'Generated'}...\n\n` +
        `**Claims:** ${claimsCount} claims included\n\n` +
        `_Full specification includes: Background, Summary, Detailed Description, and Ramifications_`;
      
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: provisionalVersion,
        snapshotType: '4c_provisional',
        title: 'Provisional Draft Complete',
        content: provisionalContent,
        metadata: { 
          stage: 4,
          substage: '4c',
          title: provisionalDraft?.title,
          claimsCount,
          timestamp: provisionalDraft?.timestamp,
        },
      });
      
      console.log("Provisional patent generated successfully");

      // Update project to stage 5
      await storage.updateProject(req.params.id, { currentStage: 5 });

      // Provenance: provisional finalize is a checkpoint.
      createCheckpointBackground({
        projectId: req.params.id,
        eventType: "finalize_provisional",
        refTable: "agent_data",
        refId: null,
        payload: { provisionalDraft },
      });

      res.json({
        success: true,
        provisionalDraft,
        message: "Provisional ready! You can generate diagrams from The Showcase."
      });
    } catch (error: any) {
      console.error("Finalize provisional error:", error);
      sendServerError(res, error, "Failed to generate provisional patent. Please try again.");
    }
  });

  // Generate diagrams only (provisional should already exist in agent 5 data)
  // Per-diagram regeneration. Mirrors the per-artifact regenerate flow on the
  // G&S Gate 2 panel. Body: { chartNumber: number } — the chartNumber of the
  // single diagram to re-render. Re-calls Eraser with that diagram's existing
  // spec and patches the stored array at the matching slot.
  app.post("/api/projects/:id/regenerate-diagram", isAuthenticated, async (req, res) => {
    try {
      const { runDiagrams, regenerateSingleDiagram } = await import("./modules/module5/5b-diagrams/diagrams");
      const chartNumber = Number(req.body?.chartNumber);
      if (!Number.isFinite(chartNumber)) {
        return res.status(400).json({ message: "chartNumber is required" });
      }

      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const a5 = (agent5Data?.data ?? {}) as any;
      const existingDiagrams: any[] = Array.isArray(a5?.diagrams) ? a5.diagrams : [];
      const storedPayload: any = a5?.diagramsPayload ?? null;

      const idx = existingDiagrams.findIndex((d: any) => Number(d?.chartNumber) === chartNumber);
      if (idx === -1) {
        return res.status(400).json({ message: `No diagram found with chartNumber ${chartNumber}` });
      }
      const target = existingDiagrams[idx];

      // Preferred path: re-run the planner on the original stored payload
      // so we get a genuinely fresh spec for the target diagram, then render
      // only that one. This produces real variation rather than re-sending
      // Eraser's cached DSL back to it.
      if (storedPayload) {
        try {
          const planned: any = await runDiagrams(storedPayload);
          const planArr: any[] = Array.isArray(planned)
            ? planned
            : Array.isArray(planned?.flowcharts)
              ? planned.flowcharts
              : Array.isArray(planned?.diagrams)
                ? planned.diagrams
                : [];
          // Match by chartNumber first; if the new plan reshuffled, fall
          // back to matching by title or figureId, then by index.
          let match =
            planArr.find((d: any) => Number(d?.chartNumber) === chartNumber) ||
            (target?.figureId ? planArr.find((d: any) => d?.figureId === target.figureId) : null) ||
            (target?.title ? planArr.find((d: any) => d?.title === target.title) : null) ||
            planArr[idx] ||
            null;
          if (match) {
            // Preserve identity fields the UI relies on.
            match = { ...match, chartNumber, title: match.title || target.title, figureId: target.figureId };
            const next = [...existingDiagrams];
            next[idx] = match;
            await storage.upsertAgentData({
              projectId: req.params.id,
              agentNumber: 5,
              data: { ...a5, diagrams: next, diagramsGeneratedAt: new Date().toISOString() },
            });
            return res.json({ success: !!match.imageUrl, diagram: match });
          }
        } catch (planErr: any) {
          console.warn("[regenerate-diagram] planner re-run failed, falling back to spec-rerender:", planErr?.message);
        }
      }

      // Fallback path: no stored payload (legacy projects) or planner failed.
      // Re-render Eraser from the existing spec.
      const result = await regenerateSingleDiagram({ existing: target });
      const next = [...existingDiagrams];
      next[idx] = result.diagram;

      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: { ...a5, diagrams: next, diagramsGeneratedAt: new Date().toISOString() },
      });

      res.json({ success: result.success, diagram: result.diagram });
    } catch (error: any) {
      console.error("[regenerate-diagram] error:", error);
      sendServerError(res, error, "Failed to regenerate diagram");
    }
  });

  app.post("/api/projects/:id/generate-showcase", isAuthenticated, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Get existing agent 5 data with provisional
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5DataObj = agent5Data?.data as any;
      
      let provisionalDraft = agent5DataObj?.provisionalDraft;
      
      // Get Agent 4 data for Specific Claims (user-selected, technical claims for diagrams)
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent4DataObj = agent4Data?.data as any;
      
      // If no provisional in agent 5, try to get from agent 4
      if (!provisionalDraft) {
        provisionalDraft = agent4DataObj?.provisionalDraft;
      }

      if (!provisionalDraft) {
        return res.status(400).json({ message: "No provisional draft found. Please complete the earlier stages first." });
      }

      // Parse provisional draft to get all fields (includes user edits from specification editor)
      const parsedDraft = parseProvisionalDraft(provisionalDraft);

      // Always use the key concepts from the edited specification
      // (parsedDraft.claims). These reflect user edits made via the
      // specification section editor and match what the final DOCX/PDF
      // export will contain — guaranteeing diagrams and the exported
      // draft are built from identical text.
      let claimsForDiagrams = '';
      if (parsedDraft.claims) {
        if (Array.isArray(parsedDraft.claims)) {
          claimsForDiagrams = parsedDraft.claims.map((c: string, i: number) => {
            const trimmed = (typeof c === 'string' ? c : '').trim();
            if (/^(Claim\s+\d+[:.:]|\d+[.)])/i.test(trimmed)) return trimmed;
            return `${i + 1}. ${trimmed}`;
          }).filter((c: string) => c.length > 5).join('\n\n');
        } else {
          claimsForDiagrams = String(parsedDraft.claims);
        }
      }

      // Fallback: if neither edited claims nor broad claims yielded anything,
      // pull the user-selected key concepts from Agent 4 directly. Without this,
      // the planner runs with no coverage anchor and the figure count collapses.
      if (!claimsForDiagrams.trim()) {
        const selectedKeyConcepts = agent4DataObj?.selectedKeyConcepts || [];
        if (Array.isArray(selectedKeyConcepts) && selectedKeyConcepts.length > 0) {
          claimsForDiagrams = selectedKeyConcepts.map((c: any, i: number) => {
            const text = typeof c === 'string' ? c : c?.text || '';
            const num = c?.number || (i + 1);
            const trimmed = text.trim();
            if (!trimmed) return '';
            if (/^(Claim\s+\d+[:.:]|\d+[.)])/i.test(trimmed)) return trimmed;
            return `${num}. ${trimmed}`;
          }).filter((c: string) => c.length > 0).join('\n\n');
          console.log(`[generate-showcase] claims empty in draft — falling back to ${selectedKeyConcepts.length} Agent 4 key concept(s)`);
        }
      }

      console.log("Generating diagrams using edited specification (single source of truth for export + diagrams)...");
      
      // Build document for diagrams using the final edited specification
      const formattedDocument = [
        `TITLE: ${parsedDraft.title || 'Provisional Patent Application'}`,
        '',
        '--- BACKGROUND ---',
        parsedDraft.background || '',
        '',
        '--- SUMMARY OF THE INVENTION ---',
        parsedDraft.summary || '',
        '',
        '--- DETAILED DESCRIPTION ---',
        parsedDraft.detailed_description || '',
        '',
        '--- RAMIFICATIONS AND SCOPE ---',
        parsedDraft.ramifications_and_scope || '',
        '',
        '--- CLAIMS ---',
        claimsForDiagrams,
        '',
        '--- ABSTRACT ---',
        parsedDraft.abstract || ''
      ].join('\n');

      // Build codeFromTheUser with nested keys for each file
      const sourceCodeFiles = project?.sourceCodeFiles || [];
      const codeFromTheUser: Record<string, any> = {};
      sourceCodeFiles.forEach((file: any, index: number) => {
        codeFromTheUser[`code${index + 1}`] = {
          text: file.description || "",
          code: file.code || ""
        };
      });

      const diagramsPayload: any = {
        title: parsedDraft.title || 'Provisional Patent Application',
        detailed_description: formattedDocument,
        // Pass the user-selected key concepts (== the claims, in this app's
        // UPL-safe terminology) as a separate, explicit field. The planner
        // uses this to guarantee each key concept is represented in a figure,
        // rather than competing for attention inside the document blob.
        keyConcepts: claimsForDiagrams,
      };

      // Only include codeFromTheUser if there are code files
      if (Object.keys(codeFromTheUser).length > 0) {
        diagramsPayload.codeFromTheUser = codeFromTheUser;
      }
      console.log("Calling diagrams generation webhook with full document...");
      const diagramsResponse: any = await runDiagrams(diagramsPayload);
      
      // Parse diagrams response
      let diagrams: any[] = [];
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
      
      // Store diagrams in Agent 5 data - PRESERVE existing fields like broadKeyConcepts.
      // Also persist the diagramsPayload so per-diagram Regenerate can re-run
      // the planner on the same input later without rebuilding the payload.
      await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 5,
        data: {
          ...agent5DataObj, // Preserve existing fields (broadKeyConcepts, selectedClaimType, etc.)
          provisionalDraft,
          diagrams,
          diagramsPayload,
          diagramsGeneratedAt: new Date().toISOString()
        },
      });

      // Create snapshot for diagrams
      const diagramVersion = await storage.getNextSnapshotVersion(req.params.id);
      const diagramContent = `**Technical Diagrams Generated:**\n\n` +
        diagrams.map((d: any, i: number) => `${i + 1}. **${d.diagramType || d.type || d.title || 'Figure ' + (i + 1)}**`).join('\n') +
        `\n\n_${diagrams.length} diagram(s) ready for patent application_`;
      
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: diagramVersion,
        snapshotType: '5_diagrams',
        title: `${diagrams.length} Diagrams Generated`,
        content: diagramContent,
        metadata: { 
          stage: 5,
          diagramCount: diagrams.length,
          diagramTypes: diagrams.map((d: any) => d.diagramType || d.type || d.title),
        },
      });

      // Update project to stage 5
      await storage.updateProject(req.params.id, { currentStage: 5 });

      // Provenance: diagrams generated. Per the spec, "user uploads drawings
      // or supporting files" is a checkpoint trigger; this app generates the
      // drawings rather than uploading them, but the evidence requirement is
      // the same. We stamp the diagram set + the disclosure they were built
      // from so the proof package binds them together.
      createCheckpointBackground({
        projectId: req.params.id,
        eventType: "generate_diagrams",
        refTable: "agent_data",
        refId: null,
        payload: {
          diagramCount: diagrams.length,
          diagramTypes: diagrams.map((d: any) => d.diagramType || d.type || d.title || null),
          diagrams,
          provisionalDraft,
        },
      });

      res.json({
        success: true,
        provisionalDraft,
        diagrams,
        message: "Showcase ready!"
      });
    } catch (error: any) {
      console.error("Generate showcase error:", error);
      sendServerError(res, error, "Failed to generate showcase. Please try again.");
    }
  });

  // Auto-save agent 4 data
  app.post("/api/projects/:id/agent/4", isAuthenticated, async (req, res) => {
    try {
      const existingData = await storage.getAgentData(req.params.id, 4);
      const savedData = await storage.upsertAgentData({
        projectId: req.params.id,
        agentNumber: 4,
        data: { ...(existingData?.data || {}), ...req.body },
      });

      res.json(savedData);
    } catch (error: any) {
      console.error("Save agent 4 data error:", error);
      res.status(500).json({ message: "Failed to save data" });
    }
  });

  // Proceed from Agent 4c to Agent 5 (generate diagrams)
  app.post("/api/projects/:id/agent/4/proceed", isAuthenticated, async (req, res) => {
    try {
      const agent4Data = await storage.getAgentData(req.params.id, 4);
      const agent4DataObj = agent4Data?.data as any;
      const provisionalDraft = agent4DataObj?.provisionalDraft;
      
      // Get Specific Claims (user-selected, technical claims for diagrams)
      // These are different from Broad Claims in provisionalDraft.claims (written by draft writer)
      const specificKeyConcepts = agent4DataObj?.selectedKeyConcepts || [];

      if (!provisionalDraft) {
        return res.status(400).json({ message: "Provisional draft not found. Please generate the draft first." });
      }

      // Parse provisional draft to get all fields (same as PDF export)
      const parsedDraft = parseProvisionalDraft(provisionalDraft);
      
      // Format Specific Claims for diagrams webhook - preserve original numbering
      const formatSpecificClaims = (claims: any[]): string => {
        if (!claims || claims.length === 0) return '';
        return claims.map((claim: any, index: number) => {
          const keyConceptText = typeof claim === 'string' ? claim : claim.text || '';
          const keyConceptNumber = claim.number || (index + 1);
          const trimmed = keyConceptText.trim();
          // Check if claim already starts with number pattern - don't re-number
          if (/^(Claim\s+\d+[:.:]|^\d+[.)])/i.test(trimmed)) {
            return trimmed;
          }
          // Add claim number
          return `${keyConceptNumber}. ${trimmed}`;
        }).join('\n\n');
      };
      
      console.log(`Using ${specificKeyConcepts.length} Specific Claims for diagrams (not Broad Claims from provisional)`);

      // Format once so we can use the same string for both the document blob
      // and the explicit keyConcepts coverage field passed to the planner.
      const formattedSpecificClaims = formatSpecificClaims(specificKeyConcepts);

      // Build document for diagrams using Specific Claims (not Broad Claims)
      const formattedDocument = [
        `TITLE: ${parsedDraft.title || 'Provisional Patent Application'}`,
        '',
        '--- BACKGROUND ---',
        parsedDraft.background || '',
        '',
        '--- SUMMARY OF THE INVENTION ---',
        parsedDraft.summary || '',
        '',
        '--- DETAILED DESCRIPTION ---',
        parsedDraft.detailed_description || '',
        '',
        '--- RAMIFICATIONS AND SCOPE ---',
        parsedDraft.ramifications_and_scope || '',
        '',
        '--- CLAIMS ---',
        formattedSpecificClaims,  // Use Specific Claims for diagrams
        '',
        '--- ABSTRACT ---',
        parsedDraft.abstract || ''
      ].join('\n');

      // Build codeFromTheUser with nested keys for each file
      const project4 = await storage.getProject(req.params.id);
      const sourceCodeFiles4 = (project4 as any)?.sourceCodeFiles || [];
      const codeFromTheUser4: Record<string, any> = {};
      sourceCodeFiles4.forEach((file: any, index: number) => {
        codeFromTheUser4[`code${index + 1}`] = {
          text: file.description || "",
          code: file.code || ""
        };
      });

      const diagramsPayload: any = {
        title: parsedDraft.title || 'Provisional Patent Application',
        detailed_description: formattedDocument,
        // Mirrors the wiring in /generate-showcase: pass key concepts (the
        // claims-equivalent) as a separate field so the planner is required
        // to cover each one with a figure, independent of the document blob.
        keyConcepts: formattedSpecificClaims,
      };

      if (Object.keys(codeFromTheUser4).length > 0) {
        diagramsPayload.codeFromTheUser = codeFromTheUser4;
      }
      
      console.log("Calling diagrams generation webhook with full document...");
      const webhookResponse: any = await runDiagrams(diagramsPayload);
      console.log("Diagrams webhook response received");

      // Store diagram generation results in Agent 5 data
      console.log("Webhook response:", JSON.stringify(webhookResponse, null, 2));
      
      // Parse new multi-flowchart format
      let diagrams: any[] = [];
      let totalFlowcharts = 0;
      let successfulFlowcharts = 0;
      let failedFlowcharts = 0;
      
      // New format: array containing object with flowcharts array
      if (Array.isArray(webhookResponse) && webhookResponse.length > 0 && webhookResponse[0]?.flowcharts) {
        const responseData = webhookResponse[0];
        totalFlowcharts = responseData.totalFlowcharts || 0;
        successfulFlowcharts = responseData.successful || 0;
        failedFlowcharts = responseData.failed || 0;
        diagrams = responseData.flowcharts || [];
        console.log(`Parsed ${diagrams.length} flowcharts (${successfulFlowcharts} successful, ${failedFlowcharts} failed)`);
      }
      // Fallback: direct object with flowcharts array
      else if (webhookResponse?.flowcharts && Array.isArray(webhookResponse.flowcharts)) {
        totalFlowcharts = webhookResponse.totalFlowcharts || 0;
        successfulFlowcharts = webhookResponse.successful || 0;
        failedFlowcharts = webhookResponse.failed || 0;
        diagrams = webhookResponse.flowcharts;
        console.log(`Parsed ${diagrams.length} flowcharts (${successfulFlowcharts} successful, ${failedFlowcharts} failed)`);
      }
      // Legacy formats
      else if (Array.isArray(webhookResponse)) {
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
          provisionalDraft, // Keep the full draft for reference
          diagrams,
          diagramsGeneratedAt: new Date().toISOString()
        },
      });

      // Create snapshot for diagrams (Agent 5)
      const diagramVersion = await storage.getNextSnapshotVersion(req.params.id);
      const diagramTypes = diagrams.map((d: any) => d.diagramType || d.type || 'Diagram').join(', ');
      const diagramContent = `**Technical Diagrams Generated:**\n\n` +
        diagrams.map((d: any, i: number) => `${i + 1}. **${d.diagramType || d.type || 'Figure ' + (i + 1)}**`).join('\n') +
        `\n\n_${diagrams.length} diagram(s) ready for patent application_`;
      
      await storage.createIdeaSnapshot({
        projectId: req.params.id,
        version: diagramVersion,
        snapshotType: '5_diagrams',
        title: `${diagrams.length} Diagrams Generated`,
        content: diagramContent,
        metadata: { 
          stage: 5,
          diagramCount: diagrams.length,
          diagramTypes: diagrams.map((d: any) => d.diagramType || d.type),
        },
      });

      await storage.updateProject(req.params.id, { currentStage: 5 });
      res.json({ success: true, diagrams });
    } catch (error: any) {
      console.error("Diagram generation error:", error);
      sendServerError(res, error, "Failed to generate diagrams. Please try again.");
    }
  });

  // Auto-save agent 5 data
  app.post("/api/projects/:id/agent/5", isAuthenticated, async (req, res) => {
    try {
      const savedData = await storage.mergeAgentData(req.params.id, 5, req.body);
      res.json(savedData);
    } catch (error: any) {
      console.error("Save agent 5 data error:", error);
      res.status(500).json({ message: "Failed to save data" });
    }
  });

  // Update a specific section of the provisional specification
  app.post("/api/projects/:id/update-specification-section", isAuthenticated, async (req, res) => {
    try {
      const { section, content } = req.body;
      
      const validSections = ['title', 'background', 'summary', 'detailed_description', 'ramifications_and_scope', 'abstract', 'claims'];
      if (!section || !validSections.includes(section)) {
        return res.status(400).json({ message: `Invalid section. Must be one of: ${validSections.join(', ')}` });
      }
      
      if (content === undefined || content === null) {
        return res.status(400).json({ message: "Content is required" });
      }

      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5Obj = agent5Data?.data as any;
      
      let provisionalDraft = agent5Obj?.provisionalDraft;
      
      if (!provisionalDraft) {
        const agent4Data = await storage.getAgentData(req.params.id, 4);
        const agent4Obj = agent4Data?.data as any;
        provisionalDraft = agent4Obj?.provisionalDraft;
      }
      
      if (!provisionalDraft) {
        return res.status(400).json({ message: "No provisional draft found" });
      }
      
      const parsedDraft = parseProvisionalDraft(provisionalDraft);
      
      if (section === 'claims') {
        const keyConceptsArray = content.split(/\n\n+/).map((c: string) => c.trim()).filter((c: string) => c.length > 0);
        parsedDraft.claims = keyConceptsArray;
        parsedDraft.keyConcepts = keyConceptsArray;
        parsedDraft.keyConcepts_count = keyConceptsArray.length;
      } else {
        parsedDraft[section] = content;
      }

      // Mark this section as hand-edited so the regeneration routes (finalize,
      // apply-to-draft, regenerate-draft) can warn before overwriting it.
      // mergeAgentData is a shallow jsonb `||` merge, so we read-modify-write
      // the FULL manualEdits object — a nested partial would drop sibling markers.
      const manualEdits = { ...((agent5Obj?.manualEdits as Record<string, any>) ?? {}) };
      manualEdits[section] = { editedAt: new Date().toISOString() };

      await storage.mergeAgentData(req.params.id, 5, { provisionalDraft: parsedDraft, manualEdits });

      // Provenance: each saved section is a new version of the disclosure.
      // The canonical payload is the whole merged draft so the proof
      // package binds to the full document, not just the diff.
      createCheckpointBackground({
        projectId: req.params.id,
        eventType: "update_spec_section",
        refTable: "agent_data",
        refId: null,
        payload: {
          section,
          updatedDraft: parsedDraft,
        },
      });

      res.json({ success: true, section, updatedDraft: parsedDraft });
    } catch (error: any) {
      console.error("Update specification section error:", error);
      res.status(500).json({ message: "Failed to update section" });
    }
  });

  // Apply one AI-Helper-proposed edit to the saved final draft. Called by the
  // diff cards the chat UI renders for proposeDraftEdits tool calls. The match
  // is whitespace-tolerant and must be unique; `find: ""` replaces the whole
  // section. Persistence mirrors /update-specification-section exactly
  // (manualEdits marker + provenance checkpoint), so an applied edit is
  // indistinguishable from a hand-saved one downstream.
  app.post("/api/projects/:id/apply-draft-edit", isAuthenticated, async (req, res) => {
    try {
      const { section, find, replace } = req.body as { section?: string; find?: string; replace?: string };

      const validSections = ['title', 'background', 'summary', 'detailed_description', 'ramifications_and_scope', 'abstract', 'claims'];
      if (!section || !validSections.includes(section)) {
        return res.status(400).json({ message: `Invalid section. Must be one of: ${validSections.join(', ')}` });
      }
      if (typeof replace !== "string" || replace.length === 0) {
        return res.status(400).json({ message: "replace text is required" });
      }
      const findText = typeof find === "string" ? find : "";

      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5Obj = agent5Data?.data as any;
      let provisionalDraft = agent5Obj?.provisionalDraft;
      if (!provisionalDraft) {
        const agent4Data = await storage.getAgentData(req.params.id, 4);
        provisionalDraft = (agent4Data?.data as any)?.provisionalDraft;
      }
      if (!provisionalDraft) {
        return res.status(400).json({ message: "No provisional draft found" });
      }

      const parsedDraft = parseProvisionalDraft(provisionalDraft);

      // Current section text — the same extraction the AI Helper's polish
      // payload and proposeDraftEdits validation read, so what the model
      // anchored against is what we splice into.
      const claimsValue = Array.isArray(parsedDraft.claims)
        ? parsedDraft.claims.join("\n\n")
        : (parsedDraft.claims ?? parsedDraft.keyConcepts ?? "");
      const currentText = section === "claims"
        ? (typeof claimsValue === "string" ? claimsValue : String(claimsValue ?? ""))
        : String(parsedDraft[section] ?? "");

      const applied = applyDraftEdit(currentText, findText, replace);
      if (!applied.ok) {
        // If the replacement text is already in the section, the inventor (or
        // a prior click) already applied this edit — tell the card that
        // instead of presenting a scary failure.
        const alreadyApplied = findDraftMatches(currentText, replace).length > 0;
        return res.status(409).json({
          message: alreadyApplied
            ? "This edit appears to be applied already."
            : applied.status === "ambiguous"
              ? `The text to replace appears ${applied.matchCount} times in the section — ask the AI Helper to re-propose with a longer, unique anchor.`
              : "The text to replace was not found in the saved draft — it may have changed since the edit was proposed. Ask the AI Helper to re-check.",
          status: applied.status,
          matchCount: applied.matchCount,
          alreadyApplied,
        });
      }

      if (section === 'claims') {
        const keyConceptsArray = applied.text.split(/\n\n+/).map((c: string) => c.trim()).filter((c: string) => c.length > 0);
        parsedDraft.claims = keyConceptsArray;
        parsedDraft.keyConcepts = keyConceptsArray;
        parsedDraft.keyConcepts_count = keyConceptsArray.length;
      } else {
        parsedDraft[section] = applied.text;
      }

      const manualEdits = { ...((agent5Obj?.manualEdits as Record<string, any>) ?? {}) };
      manualEdits[section] = { editedAt: new Date().toISOString() };

      await storage.mergeAgentData(req.params.id, 5, { provisionalDraft: parsedDraft, manualEdits });

      createCheckpointBackground({
        projectId: req.params.id,
        eventType: "update_spec_section",
        refTable: "agent_data",
        refId: null,
        payload: {
          section,
          via: "ai_helper_apply_edit",
          updatedDraft: parsedDraft,
        },
      });

      res.json({ success: true, section });
    } catch (error: any) {
      console.error("Apply draft edit error:", error);
      res.status(500).json({ message: "Failed to apply edit" });
    }
  });

  // Get parsed provisional draft sections
  app.get("/api/projects/:id/specification-sections", isAuthenticated, async (req, res) => {
    try {
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const agent5Obj = agent5Data?.data as any;
      
      let provisionalDraft = agent5Obj?.provisionalDraft;
      
      if (!provisionalDraft) {
        const agent4Data = await storage.getAgentData(req.params.id, 4);
        const agent4Obj = agent4Data?.data as any;
        provisionalDraft = agent4Obj?.provisionalDraft;
      }
      
      if (!provisionalDraft) {
        return res.status(404).json({ message: "No provisional draft found" });
      }
      
      const parsedDraft = parseProvisionalDraft(provisionalDraft);

      let keyConceptsContent = '';

      // Prefer the user's edited key-concept text if /update-specification-section
      // has saved one. Without this, GET would silently overwrite edits with the
      // auto-formatted Agent 4 selections every time the page reloads.
      const savedKeyConcepts =
        (Array.isArray(parsedDraft.keyConcepts) && parsedDraft.keyConcepts) ||
        (Array.isArray(parsedDraft.claims) && parsedDraft.claims) ||
        null;
      if (savedKeyConcepts && savedKeyConcepts.length > 0) {
        keyConceptsContent = savedKeyConcepts.join('\n\n');
      } else {
        // No edits yet — render the auto-formatted version from Agent 4.
        const agent4Data = await storage.getAgentData(req.params.id, 4);
        const agent4Obj = agent4Data?.data as any;
        const selectedKeyConcepts = agent4Obj?.selectedKeyConcepts || agent4Obj?.selectedClaims || [];

        if (Array.isArray(selectedKeyConcepts) && selectedKeyConcepts.length > 0) {
          const groupedByVariation: Record<string, any[]> = {};
          selectedKeyConcepts.forEach((concept: any) => {
            const variationId = concept.variationId || 'default';
            if (!groupedByVariation[variationId]) groupedByVariation[variationId] = [];
            groupedByVariation[variationId].push(concept);
          });

          const formattedConcepts: string[] = [];
          let groupNumber = 1;
          Object.keys(groupedByVariation).forEach((variationId) => {
            const groupConcepts = groupedByVariation[variationId];
            groupConcepts.forEach((concept: any, conceptIndex: number) => {
              formattedConcepts.push(`Group ${groupNumber} / Key Concept ${conceptIndex + 1}: ${concept.text || ''}`);
            });
            groupNumber++;
          });
          keyConceptsContent = formattedConcepts.join('\n\n');
        }
      }

      // Broad-mode auto-formatting also runs only if the user has not yet
      // saved a manual edit; otherwise we'd clobber their changes on reload.
      if (!savedKeyConcepts) {
        const selectedClaimType = agent5Obj?.selectedClaimType || 'specific';
        if (selectedClaimType === 'broad' && agent5Obj?.broadKeyConcepts) {
          const claimsArr = extractClaimsFromBroadData(agent5Obj.broadKeyConcepts);
          if (claimsArr.length > 0) {
            keyConceptsContent = claimsArr.map((c, i) => `${i + 1}. ${c}`).join('\n\n');
          }
        }
      }
      
      const sections = [
        { key: 'title', label: 'Title', content: parsedDraft.title || '' },
        { key: 'background', label: 'Background of the Invention', content: parsedDraft.background || '' },
        { key: 'summary', label: 'Summary of the Invention', content: parsedDraft.summary || '' },
        { key: 'detailed_description', label: 'Detailed Description', content: parsedDraft.detailed_description || '' },
        { key: 'ramifications_and_scope', label: 'Ramifications & Scope', content: parsedDraft.ramifications_and_scope || '' },
        { key: 'abstract', label: 'Abstract', content: parsedDraft.abstract || '' },
        { key: 'claims', label: 'Key Concepts', content: keyConceptsContent },
      ];
      
      res.json(sections);
    } catch (error: any) {
      console.error("Get specification sections error:", error);
      res.status(500).json({ message: "Failed to get specification sections" });
    }
  });

  // ============================================
  // GENUS & SPECIES EXPANSION ROUTES
  // ============================================

  // Trigger Stage 1 (genus) + Stage 2 (species) then pause for Gate 1.
  // Returns immediately with status "running_stage1"; poll /status for updates.
  // Client should SSE or poll until status becomes "awaiting_gate1".
  app.post("/api/projects/:id/genus-species/start", isAuthenticated, async (req, res) => {
    try {
      const { runGenusExtraction, runSpeciesSynthesis } = await import("./modules/module5/5c-genus-and-species/orchestrator");
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const [a1Data, a2Data, a4Data, a5Data] = await Promise.all([
        storage.getAgentData(req.params.id, 1),
        storage.getAgentData(req.params.id, 2),
        storage.getAgentData(req.params.id, 4),
        storage.getAgentData(req.params.id, 5),
      ]);
      const a1 = (a1Data?.data ?? {}) as any;
      const a2 = (a2Data?.data ?? {}) as any;
      const a4 = (a4Data?.data ?? {}) as any;
      const a5 = (a5Data?.data ?? {}) as any;

      const coreIdea: string = a1?.ideaSummary || a1?.currentIdea || "";
      const expandedConcept: string = a2?.provisionalDraft || a2?.draftSpecification || "";
      const existingKeyConcepts: string[] = (a4?.selectedKeyConcepts || []).map((c: any) => c?.text || "").filter(Boolean);

      if (!coreIdea || !expandedConcept || existingKeyConcepts.length === 0) {
        return res.status(400).json({ message: "Project is missing required data. Complete Modules 1–4 first." });
      }

      // Mark as running and seed the workflow record. The frontend polls /status to
      // drive its progress UI, so this initial write needs to be visible before we
      // start the AI work.
      const existing = (a5Data?.data ?? {}) as any;
      const runningState = {
        status: "running_stage1",
        startedAt: new Date().toISOString(),
      };
      await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...existing, genusSpecies: runningState } });

      // Run stages 1 + 2 SYNCHRONOUSLY inside the request handler. The previous
      // fire-and-forget IIFE pattern was unsafe on Vercel serverless: as soon as
      // res.json() sent, the runtime would terminate the function and any
      // background work — including the DB write that flips status to
      // awaiting_gate1 — was racing the shutdown. By awaiting the full pipeline
      // before responding, the function stays alive (up to vercel.json's
      // maxDuration of 800s) for the entire run, and we never ship a half-saved
      // workflow. Incremental DB writes between stages are kept as belt-and-
      // suspenders in case maxDuration is hit on a future longer run.
      try {
        const genusResult = await runGenusExtraction({ coreIdea, expandedConcept, existingKeyConcepts });
        if (!genusResult.success) {
          const errA5 = ((await storage.getAgentData(req.params.id, 5))?.data ?? {}) as any;
          await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...errA5, genusSpecies: { status: "error", error: genusResult.error } } });
          return res.status(500).json({ success: false, status: "error", message: genusResult.error });
        }
        const postS1A5 = ((await storage.getAgentData(req.params.id, 5))?.data ?? {}) as any;
        await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...postS1A5, genusSpecies: { ...runningState, status: "running_stage2", genus: genusResult.genus } } });

        const species = await runSpeciesSynthesis({ genus: genusResult.genus });
        const postS2A5 = ((await storage.getAgentData(req.params.id, 5))?.data ?? {}) as any;
        await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...postS2A5, genusSpecies: { ...postS2A5.genusSpecies, status: "awaiting_gate1", species } } });

        res.json({ success: true, status: "awaiting_gate1" });
      } catch (e: any) {
        const errA5 = ((await storage.getAgentData(req.params.id, 5))?.data ?? {}) as any;
        await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...errA5, genusSpecies: { ...errA5.genusSpecies, status: "error", error: e?.message || "Stage 1/2 failed" } } });
        return res.status(500).json({ success: false, status: "error", message: e?.message || "Stage 1/2 failed" });
      }
    } catch (error: any) {
      console.error("[genus-species] start error:", error);
      sendServerError(res, error, "Failed to start expansion");
    }
  });

  // Gate 1: inventor submits their species approval decisions.
  // Body: { approvals: Array<{ species_type, decision: "approved"|"rejected", editedText?: string }> }
  // If zero approved, workflow ends cleanly. Otherwise runs Stage 3 + 4 async.
  app.post("/api/projects/:id/genus-species/approve-species", isAuthenticated, async (req, res) => {
    try {
      const { runStage3, runAbstractRewrite } = await import("./modules/module5/5c-genus-and-species/orchestrator");
      const approvals: Array<{ species_type: string; decision: string; editedText?: string }> = req.body.approvals || [];

      const a5Data = await storage.getAgentData(req.params.id, 5);
      const a5 = (a5Data?.data ?? {}) as any;
      const gsState = (a5.genusSpecies ?? {}) as any;

      if (gsState.status !== "awaiting_gate1") {
        return res.status(400).json({ message: `Workflow is not at Gate 1 (current status: ${gsState.status})` });
      }

      const allSpecies: any[] = gsState.species || [];
      const approvedSpecies = allSpecies
        .map((s: any) => {
          const decision = approvals.find((a) => a.species_type === s.species_type);
          if (!decision || decision.decision === "rejected") return null;
          if (decision.decision === "edited" && decision.editedText) {
            return { ...s, architectural_description: decision.editedText };
          }
          return s;
        })
        .filter(Boolean);

      if (approvedSpecies.length === 0) {
        // Clean halt — no species approved, workflow done, original spec unchanged.
        await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...a5, genusSpecies: { ...gsState, status: "complete", approvedSpecies: [], finalSpec: null, completedAt: new Date().toISOString() } } });
        return res.json({ success: true, status: "complete", approvedSpecies: 0 });
      }

      await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...a5, genusSpecies: { ...gsState, status: "running_stage3", approvedSpecies } } });

      // Run stages 3 + 4 SYNCHRONOUSLY inside the request handler. See the
      // matching comment in /start for the rationale: fire-and-forget IIFEs
      // were racing Vercel's post-response function termination and losing
      // the final upsert that flips status to awaiting_gate2. Awaiting the
      // full pipeline before responding guarantees the function stays alive
      // for the entire run (up to vercel.json's maxDuration of 800s).
      try {
        const [a2Data, a4Data] = await Promise.all([storage.getAgentData(req.params.id, 2), storage.getAgentData(req.params.id, 4)]);
        const a2 = (a2Data?.data ?? {}) as any;
        const a4 = (a4Data?.data ?? {}) as any;
        const currentA5 = ((await storage.getAgentData(req.params.id, 5))?.data ?? {}) as any;
        const gs = currentA5.genusSpecies || {};

        const existingKeyConcepts: string[] = (a4?.selectedKeyConcepts || []).map((c: any) => c?.text || "").filter(Boolean);
        const existingBackground: string = a2?.background || "";
        const existingSummary: string = a2?.summary || "";
        const existingDetailedDescription: string = a2?.provisionalDraft || a2?.draftSpecification || "";

        const stage3 = await runStage3({ existingKeyConcepts, genus: gs.genus, approvedSpecies, existingBackground, existingSummary, existingDetailedDescription });
        const postS3A5 = ((await storage.getAgentData(req.params.id, 5))?.data ?? {}) as any;
        await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...postS3A5, genusSpecies: { ...postS3A5.genusSpecies, status: "running_stage4", ...stage3 } } });

        // Stage 4 input: include the broadened content so the abstract reflects expanded scope.
        const stage3BgText = (stage3.backgroundExtension && typeof stage3.backgroundExtension === "object" && "additional_paragraphs" in stage3.backgroundExtension)
          ? (stage3.backgroundExtension as any).additional_paragraphs
          : (typeof stage3.backgroundExtension === "string" ? stage3.backgroundExtension : "");
        const stage3SummaryText = (stage3.summaryExtension && typeof stage3.summaryExtension === "object" && "additional_paragraphs" in stage3.summaryExtension)
          ? (stage3.summaryExtension as any).additional_paragraphs
          : (typeof stage3.summaryExtension === "string" ? stage3.summaryExtension : "");
        const assembledSpec = [
          existingDetailedDescription,
          ...stage3.broadenings.map((b: any) => b.broadened_concept_text).filter(Boolean),
          stage3BgText,
          stage3SummaryText,
        ].filter(Boolean).join("\n\n");
        const a1Data = await storage.getAgentData(req.params.id, 1);
        const originalAbstract: string = (a1Data?.data as any)?.abstract || "";

        const abstractRewrite = await runAbstractRewrite({ originalAbstract, assembledSpec, approvedSpecies, genus: gs.genus });
        const postS4A5 = ((await storage.getAgentData(req.params.id, 5))?.data ?? {}) as any;
        await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...postS4A5, genusSpecies: { ...postS4A5.genusSpecies, status: "awaiting_gate2", abstractRewrite } } });

        res.json({ success: true, status: "awaiting_gate2", approvedSpecies: approvedSpecies.length });
      } catch (e: any) {
        const errA5 = ((await storage.getAgentData(req.params.id, 5))?.data ?? {}) as any;
        await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...errA5, genusSpecies: { ...errA5.genusSpecies, status: "error", error: e?.message || "Stage 3/4 failed" } } });
        return res.status(500).json({ success: false, status: "error", message: e?.message || "Stage 3/4 failed" });
      }
    } catch (error: any) {
      console.error("[genus-species] approve-species error:", error);
      sendServerError(res, error, "Failed to process species approval");
    }
  });

  // Gate 2: inventor finalizes their per-artifact decisions and the expanded
  // spec is written to the project.
  // Body: { approvals: Record<string, "approved"|"edited"|"rejected">, edits: Record<string, string> }
  // Extract a plain string from any shape an AI response field may take:
  // plain string, nested object, double-encoded JSON string, or object with
  // extra fields (language_changes, covers, etc.). Uses regex as final fallback
  // so squiggly brackets never reach the draft.
  // Remove any embedded JSON-object blob from a text field. Looks for
  // `{...}` substrings whose contents parse as JSON and deletes them.
  // Catches the case where a previous broken finalize wrote a raw AI
  // response into draft.background / draft.summary / etc.
  function stripEmbeddedJson(text: any): string {
    if (typeof text !== "string") return typeof text === "object" ? "" : String(text ?? "");
    let out = text;
    const objRegex = /\{[\s\S]*?\}(?=\s|$|\n)/g;
    let attempts = 0;
    while (attempts++ < 10) {
      let changed = false;
      out = out.replace(objRegex, (match) => {
        try {
          const parsed = JSON.parse(match);
          if (parsed && typeof parsed === "object") {
            changed = true;
            // If the blob has a known text field, keep just that
            const textKeys = ["additional_paragraphs", "abstract_text", "content", "broadened_concept_text", "key_concept_text"];
            for (const k of textKeys) {
              if (typeof parsed[k] === "string") return parsed[k];
            }
            return "";
          }
        } catch {}
        return match;
      });
      if (!changed) break;
    }
    return out.replace(/\n{3,}/g, "\n\n").trim();
  }

  function pluckText(val: any, key: string): string {
    if (val === null || val === undefined) return "";
    const flatten = (v: any): any => {
      if (typeof v !== "string") return v;
      const t = v.trim();
      if (t.startsWith("{") || t.startsWith("[")) { try { return flatten(JSON.parse(t)); } catch {} }
      return v;
    };
    const obj = flatten(val);
    if (typeof obj === "string") return obj;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const child = flatten(obj[key]);
      if (typeof child === "string") return child;
      if (child && typeof child === "object" && !Array.isArray(child)) {
        const grand = flatten(child[key]);
        if (typeof grand === "string") return grand;
      }
    }
    // Regex fallback — works on any JSON regardless of nesting depth
    try {
      const raw = typeof val === "string" ? val : JSON.stringify(val);
      const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = raw.match(new RegExp(`"${esc}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"` ));
      if (m) return m[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } catch {}
    return "";
  }

  app.post("/api/projects/:id/genus-species/finalize", isAuthenticated, async (req, res) => {
    try {
      const { finalizeApprovals } = await import("./modules/module5/5c-genus-and-species/orchestrator");
      const { approvals = {}, edits = {} } = req.body;

      const a5Data = await storage.getAgentData(req.params.id, 5);
      const a5 = (a5Data?.data ?? {}) as any;
      const gsState = a5.genusSpecies ?? {};

      if (gsState.status !== "awaiting_gate2") {
        return res.status(400).json({ message: `Workflow is not at Gate 2 (current status: ${gsState.status})` });
      }

      const finalSpec = finalizeApprovals(gsState, approvals, edits);

      // Warn-before-overwrite gate. finalize REPLACES abstract (when the rewrite
      // is non-empty) and the Key Concepts; background/summary/detailed_description
      // are APPENDED, so they can't lose edits and never warn. If a section that
      // will be replaced was hand-edited on the Showcase (tracked in
      // a5.manualEdits) and the client hasn't confirmed, abort with 409 before any
      // state is built or persisted.
      const finalizeAbstractText = pluckText(finalSpec, "abstractText") || pluckText(finalSpec?.abstractText, "abstract_text") || (typeof finalSpec?.abstractText === "string" ? finalSpec.abstractText : "");
      const finalizeConceptCount =
        ((finalSpec?.keyConceptsBroadened || []).map((b: any) => pluckText(b, "broadened_concept_text")).filter(Boolean).length) +
        ((finalSpec?.keyConceptsAppended || []).map((a: any) => pluckText(a, "key_concept_text")).filter(Boolean).length);
      const finalizeWillReplace: string[] = [];
      if (finalizeAbstractText) finalizeWillReplace.push("abstract");
      if (finalizeConceptCount > 0) finalizeWillReplace.push("claims");
      const finalizeConflicts = finalizeWillReplace.filter((s) => ((a5?.manualEdits as Record<string, any>) ?? {})[s]);
      if (finalizeConflicts.length > 0 && req.body.confirmOverwrite !== true) {
        return res.status(409).json({ needsConfirmation: true, editedSections: finalizeConflicts });
      }

      // Finalize already writes the expansion into provisionalDraft below, so
      // mark it as applied to prevent the Apply-to-Draft button from being
      // active afterward (it would duplicate-append the extensions).
      const completed = { ...gsState, status: "complete", gate2Approvals: approvals, gate2Edits: edits, finalSpec, completedAt: new Date().toISOString(), appliedToDraft: true, appliedToDraftAt: new Date().toISOString() };

      // Write the approved expanded content into the live provisionalDraft so
      // specification-sections returns the updated text immediately. We work
      // directly on the raw draft object rather than calling parseProvisionalDraft
      // (which is defined later in this closure) to avoid the TDZ.
      let updatedDraft: any = null;
      try {
        let rawDraft = a5?.provisionalDraft;
        if (!rawDraft) {
          const a4Data = await storage.getAgentData(req.params.id, 4);
          rawDraft = (a4Data?.data as any)?.provisionalDraft;
        }
        if (rawDraft && typeof rawDraft === "object") {
          const draft = { ...rawDraft };

          // Every field runs through pluckText so no JSON blob / object reaches the draft.
          // Strip any JSON blobs left from prior broken finalize runs, then append clean text.
          draft.background = stripEmbeddedJson(draft.background);
          draft.summary = stripEmbeddedJson(draft.summary);
          draft.detailed_description = stripEmbeddedJson(draft.detailed_description);
          draft.abstract = stripEmbeddedJson(draft.abstract);

          const bgText = pluckText(finalSpec?.backgroundExtension, "additional_paragraphs");
          if (bgText) {
            draft.background = [draft.background, bgText].filter(Boolean).join("\n\n");
          }

          const summaryText = pluckText(finalSpec?.summaryExtension, "additional_paragraphs");
          if (summaryText) {
            draft.summary = [draft.summary, summaryText].filter(Boolean).join("\n\n");
          }

          if (finalSpec?.detailExtension?.subsections?.length) {
            const newSubsections = finalSpec.detailExtension.subsections
              .map((s: any) => {
                const title = pluckText(s, "title") || "";
                const content = pluckText(s, "content") || "";
                return `${title}\n\n${content}`.trim();
              })
              .filter(Boolean).join("\n\n");
            if (newSubsections) {
              draft.detailed_description = [draft.detailed_description, newSubsections]
                .filter(Boolean).join("\n\n");
            }
          }

          const abstractText = pluckText(finalSpec, "abstractText") || pluckText(finalSpec?.abstractText, "abstract_text") || (typeof finalSpec?.abstractText === "string" ? finalSpec.abstractText : "");
          if (abstractText) {
            draft.abstract = abstractText;
          }

          const broadenedTexts = (finalSpec?.keyConceptsBroadened || [])
            .map((b: any) => pluckText(b, "broadened_concept_text")).filter(Boolean);
          const appendedTexts = (finalSpec?.keyConceptsAppended || [])
            .map((a: any) => pluckText(a, "key_concept_text")).filter(Boolean);
          const allConcepts = [...broadenedTexts, ...appendedTexts];
          if (allConcepts.length > 0) {
            draft.keyConcepts = allConcepts;
            draft.claims = allConcepts;
            draft.keyConcepts_count = allConcepts.length;
          }

          updatedDraft = draft;
        }
      } catch (draftErr: any) {
        console.warn("[genus-species] draft merge failed:", draftErr?.message);
      }

      const mergePayload: any = { genusSpecies: completed };
      if (updatedDraft) mergePayload.provisionalDraft = updatedDraft;
      // Clear hand-edit markers for the sections finalize actually replaced (the
      // draft was written and the inventor confirmed, or had no edits there).
      // Append-only sections keep their markers since their edits survive.
      if (updatedDraft && finalizeWillReplace.length > 0) {
        const nextManualEdits = { ...((a5?.manualEdits as Record<string, any>) ?? {}) };
        for (const s of finalizeWillReplace) delete nextManualEdits[s];
        mergePayload.manualEdits = nextManualEdits;
      }
      await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...a5, ...mergePayload } });

      // Provenance: G&S finalize is a checkpoint.
      createCheckpointBackground({
        projectId: req.params.id,
        eventType: "finalize_gs",
        refTable: "agent_data",
        refId: null,
        payload: { finalSpec, gate2Approvals: completed.gate2Approvals, gate2Edits: completed.gate2Edits },
      });

      res.json({ success: true, status: "complete", finalSpec });
    } catch (error: any) {
      console.error("[genus-species] finalize error:", error);
      sendServerError(res, error, "Failed to finalize expansion");
    }
  });

  // Workflow status — polled by the frontend while async stages run.
  app.get("/api/projects/:id/genus-species/status", isAuthenticated, async (req, res) => {
    try {
      const a5Data = await storage.getAgentData(req.params.id, 5);
      const a5 = (a5Data?.data ?? {}) as any;
      const gs = a5?.genusSpecies ?? { status: "idle" };

      // Staleness check — if the workflow has been sitting in a running_*
      // state for more than 15 minutes, the function that was driving it is
      // certainly dead (Vercel maxDuration is 800s = ~13 min). Flip the row
      // to "error" so the frontend renders an actionable retry button
      // instead of an eternal spinner. This is the recovery path for the
      // edge case where the function crashed without writing its own error.
      const STALE_RUNNING_MS = 15 * 60 * 1000;
      const runningStages = ["running_stage1", "running_stage2", "running_stage3", "running_stage4"];
      if (runningStages.includes(gs.status) && gs.startedAt) {
        const startedMs = Date.parse(gs.startedAt);
        if (Number.isFinite(startedMs) && Date.now() - startedMs > STALE_RUNNING_MS) {
          const failed = {
            ...gs,
            status: "error" as const,
            error: "The previous run timed out or was interrupted. Click Run Genus & Species Expansion to try again.",
            staleAt: new Date().toISOString(),
          };
          // Persist so subsequent polls don't have to re-detect.
          await storage.upsertAgentData({
            projectId: req.params.id,
            agentNumber: 5,
            data: { ...a5, genusSpecies: failed },
          });
          return res.json(failed);
        }
      }

      res.json(gs);
    } catch (error: any) {
      sendServerError(res, error, "Failed to get status");
    }
  });

  // Apply the already-finalized G&S spec to provisionalDraft without re-running
  // any AI. Safe to call any time status === "complete".
  app.post("/api/projects/:id/genus-species/apply-to-draft", isAuthenticated, async (req, res) => {
    try {
      const a5Data = await storage.getAgentData(req.params.id, 5);
      const a5 = (a5Data?.data ?? {}) as any;
      const gsState = a5.genusSpecies ?? {};

      if (gsState.status !== "complete") {
        return res.status(400).json({ message: `Workflow not complete (status: ${gsState.status})` });
      }

      const finalSpec = gsState.finalSpec;
      if (!finalSpec) {
        return res.status(400).json({ message: "No finalSpec found — workflow may not have finished properly" });
      }

      let rawDraft = a5?.provisionalDraft;
      if (!rawDraft) {
        const a4Data = await storage.getAgentData(req.params.id, 4);
        rawDraft = (a4Data?.data as any)?.provisionalDraft;
      }

      if (!rawDraft || typeof rawDraft !== "object") {
        return res.status(400).json({ message: "No provisional draft found for this project" });
      }

      const draft = { ...rawDraft };

      draft.background = stripEmbeddedJson(draft.background);
      draft.summary = stripEmbeddedJson(draft.summary);
      draft.detailed_description = stripEmbeddedJson(draft.detailed_description);
      draft.abstract = stripEmbeddedJson(draft.abstract);

      const bgText = pluckText(finalSpec?.backgroundExtension, "additional_paragraphs");
      if (bgText) {
        draft.background = [draft.background, bgText].filter(Boolean).join("\n\n");
      }
      const summaryText = pluckText(finalSpec?.summaryExtension, "additional_paragraphs");
      if (summaryText) {
        draft.summary = [draft.summary, summaryText].filter(Boolean).join("\n\n");
      }
      if (finalSpec?.detailExtension?.subsections?.length) {
        const newSubsections = finalSpec.detailExtension.subsections
          .map((s: any) => {
            const title = pluckText(s, "title") || "";
            const content = pluckText(s, "content") || "";
            return `${title}\n\n${content}`.trim();
          })
          .filter(Boolean).join("\n\n");
        if (newSubsections) {
          draft.detailed_description = [draft.detailed_description, newSubsections]
            .filter(Boolean).join("\n\n");
        }
      }
      const abstractText = pluckText(finalSpec, "abstractText") || pluckText(finalSpec?.abstractText, "abstract_text") || (typeof finalSpec?.abstractText === "string" ? finalSpec.abstractText : "");
      if (abstractText) {
        draft.abstract = abstractText;
      }
      const broadenedTexts = (finalSpec?.keyConceptsBroadened || [])
        .map((b: any) => pluckText(b, "broadened_concept_text")).filter(Boolean);
      const appendedTexts = (finalSpec?.keyConceptsAppended || [])
        .map((a: any) => pluckText(a, "key_concept_text")).filter(Boolean);
      const allConcepts = [...broadenedTexts, ...appendedTexts];
      if (allConcepts.length > 0) {
        draft.keyConcepts = allConcepts;
        draft.claims = allConcepts;
        draft.keyConcepts_count = allConcepts.length;
      }

      // Warn-before-overwrite gate. apply-to-draft REPLACES abstract (when the
      // rewrite is non-empty) and the Key Concepts; the other sections are
      // appended and can't lose edits. Nothing is persisted until the upsert
      // below, so returning here leaves the draft untouched.
      const applyWillReplace: string[] = [];
      if (abstractText) applyWillReplace.push("abstract");
      if (allConcepts.length > 0) applyWillReplace.push("claims");
      const applyConflicts = applyWillReplace.filter((s) => ((a5?.manualEdits as Record<string, any>) ?? {})[s]);
      if (applyConflicts.length > 0 && req.body.confirmOverwrite !== true) {
        return res.status(409).json({ needsConfirmation: true, editedSections: applyConflicts });
      }

      // Record that the expansion has been applied to the draft so the
      // frontend can permanently disable the "Apply to Provisional Draft"
      // button — applying twice would just duplicate-append the extensions.
      const updatedGs = {
        ...gsState,
        appliedToDraft: true,
        appliedToDraftAt: new Date().toISOString(),
      };
      // Clear hand-edit markers for the sections we just replaced. Append-only
      // sections keep theirs since their edits survive the append.
      const applyManualEdits = { ...((a5?.manualEdits as Record<string, any>) ?? {}) };
      for (const s of applyWillReplace) delete applyManualEdits[s];
      await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...a5, provisionalDraft: draft, genusSpecies: updatedGs, manualEdits: applyManualEdits } });

      // Provenance: G&S expansion merged into the draft — this is a major
      // version of the disclosure (background, summary, detailed_description,
      // abstract, and key concepts all change). Stamp the merged draft so
      // the proof package can prove this exact merged content existed.
      createCheckpointBackground({
        projectId: req.params.id,
        eventType: "apply_gs_to_draft",
        refTable: "agent_data",
        refId: null,
        payload: {
          provisionalDraft: draft,
          appliedAt: updatedGs.appliedToDraftAt,
        },
      });

      res.json({ success: true, appliedToDraft: true });
    } catch (error: any) {
      console.error("[genus-species] apply-to-draft error:", error);
      sendServerError(res, error, "Failed to apply to draft");
    }
  });

  // Per-artifact regeneration. Called from the Gate 2 UI when one of the
  // broadenings/appendings/extensions/abstract came back empty (typically from
  // a Flash JSON parse failure that escaped the retry). Re-runs exactly one
  // AI call and patches the result back into genusSpecies at the right index.
  // Body: { artifactId: string }
  app.post("/api/projects/:id/genus-species/regenerate-artifact", isAuthenticated, async (req, res) => {
    try {
      const {
        regenerateBroadening,
        regenerateAppending,
        regenerateBackgroundExtension,
        regenerateSummaryExtension,
        regenerateAbstract,
      } = await import("./modules/module5/5c-genus-and-species/orchestrator");

      const artifactId: string = String(req.body?.artifactId || "");
      if (!artifactId) return res.status(400).json({ message: "artifactId is required" });

      const a5Data = await storage.getAgentData(req.params.id, 5);
      const a5 = (a5Data?.data ?? {}) as any;
      const gs = (a5.genusSpecies ?? {}) as any;
      if (!gs.genus || !gs.approvedSpecies) {
        return res.status(400).json({ message: "Workflow has no genus/species yet — start Genus & Species first" });
      }

      // Pull supporting context once.
      const [a1Data, a2Data, a4Data] = await Promise.all([
        storage.getAgentData(req.params.id, 1),
        storage.getAgentData(req.params.id, 2),
        storage.getAgentData(req.params.id, 4),
      ]);
      const a1 = (a1Data?.data ?? {}) as any;
      const a2 = (a2Data?.data ?? {}) as any;
      const a4 = (a4Data?.data ?? {}) as any;
      const existingKeyConcepts: string[] = (a4?.selectedKeyConcepts || []).map((c: any) => c?.text || "").filter(Boolean);
      const existingBackground: string = a2?.background || "";
      const existingSummary: string = a2?.summary || "";

      const updatedGs: any = { ...gs };

      if (artifactId.startsWith("broadening_")) {
        const idx = parseInt(artifactId.replace("broadening_", ""), 10);
        const existing = (gs.broadenings || [])[idx];
        if (!existing) return res.status(400).json({ message: `No broadening at index ${idx}` });
        const original = existing.original_key_concept || existingKeyConcepts[idx] || "";
        if (!original) return res.status(400).json({ message: "Original key concept text missing" });
        const fresh = await regenerateBroadening({ original_key_concept: original, genus: gs.genus, approvedSpecies: gs.approvedSpecies });
        const next = [...(gs.broadenings || [])];
        next[idx] = fresh;
        updatedGs.broadenings = next;
      } else if (artifactId.startsWith("appending_")) {
        const idx = parseInt(artifactId.replace("appending_", ""), 10);
        const aspects = ["genus_mechanism", "species_spectrum", "hardware_optimization"] as const;
        const existing = (gs.appendings || [])[idx];
        const aspect = (existing?.concept_aspect || aspects[idx]) as typeof aspects[number];
        if (!aspect) return res.status(400).json({ message: `No appending aspect at index ${idx}` });
        const fresh = await regenerateAppending({ concept_aspect: aspect, genus: gs.genus, approvedSpecies: gs.approvedSpecies, existingKeyConcepts });
        const next = [...(gs.appendings || [])];
        next[idx] = fresh;
        updatedGs.appendings = next;
      } else if (artifactId === "background_extension") {
        updatedGs.backgroundExtension = await regenerateBackgroundExtension({ existingBackground, genus: gs.genus, approvedSpecies: gs.approvedSpecies });
      } else if (artifactId === "summary_extension") {
        updatedGs.summaryExtension = await regenerateSummaryExtension({ existingSummary, genus: gs.genus, approvedSpecies: gs.approvedSpecies });
      } else if (artifactId === "abstract") {
        const originalAbstract: string = a1?.abstract || "";
        const broadenedTexts = (gs.broadenings || []).map((b: any) => b?.broadened_concept_text).filter(Boolean);
        const bgText = gs.backgroundExtension?.additional_paragraphs || (typeof gs.backgroundExtension === "string" ? gs.backgroundExtension : "");
        const summaryText = gs.summaryExtension?.additional_paragraphs || (typeof gs.summaryExtension === "string" ? gs.summaryExtension : "");
        const assembledSpec = [a2?.provisionalDraft || "", ...broadenedTexts, bgText, summaryText].filter(Boolean).join("\n\n");
        updatedGs.abstractRewrite = await regenerateAbstract({ originalAbstract, assembledSpec, approvedSpecies: gs.approvedSpecies, genus: gs.genus });
      } else {
        return res.status(400).json({ message: `Unknown artifactId: ${artifactId}` });
      }

      await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...a5, genusSpecies: updatedGs } });
      res.json({ success: true, artifactId });
    } catch (error: any) {
      console.error("[genus-species] regenerate-artifact error:", error);
      sendServerError(res, error, "Failed to regenerate artifact");
    }
  });

  // Reset workflow (starts over from Stage 1).
  app.post("/api/projects/:id/genus-species/reset", isAuthenticated, async (req, res) => {
    try {
      const a5Data = await storage.getAgentData(req.params.id, 5);
      const a5 = (a5Data?.data ?? {}) as any;
      await storage.upsertAgentData({ projectId: req.params.id, agentNumber: 5, data: { ...a5, genusSpecies: { status: "idle" } } });
      res.json({ success: true });
    } catch (error: any) {
      sendServerError(res, error, "Failed to reset");
    }
  });

  // ============================================
  // HUMAN-INPUT LEDGER ROUTES
  // ============================================
  // Pure passthrough — every textarea answer the user types across modules
  // 0–4b lands here, tagged with controlled-vocabulary tags so the Pannu
  // pre-fill engine (and future flows) can draft answers from the user's
  // own earlier words instead of asking them to retype.

  // Upsert (or delete on empty) a single ledger row. The key triple is
  // (projectId, source, sourceRefId). Body: { source, sourceRefId?,
  // promptText?, answerText, tags?, conceptId? }.
  app.post("/api/projects/:id/human-inputs", isAuthenticated, async (req, res) => {
    try {
      const body = req.body ?? {};
      const source = typeof body.source === "string" ? body.source.trim() : "";
      if (!source) return res.status(400).json({ message: "source is required" });
      const answerText = typeof body.answerText === "string" ? body.answerText : "";
      const sourceRefId = body.sourceRefId ?? null;
      const tags = Array.isArray(body.tags) ? body.tags.filter((t: any) => typeof t === "string") : [];
      for (const t of tags) {
        if (!(HUMAN_INPUT_TAGS as readonly string[]).includes(t)) {
          return res.status(400).json({ message: `unknown tag: ${t}` });
        }
      }
      // Empty answer ⇒ delete the row (so the user clearing a field removes
      // its contribution to pre-fill rather than leaving a stale row behind).
      if (!answerText.trim()) {
        await deleteHumanInput({ projectId: req.params.id, source, sourceRefId });
        return res.json({ success: true, deleted: true });
      }
      const row = await recordHumanInput({
        projectId: req.params.id,
        source,
        sourceRefId,
        promptText: body.promptText ?? null,
        answerText,
        tags,
        conceptId: body.conceptId ?? null,
      });
      res.json({ success: true, input: row });
    } catch (error: any) {
      console.error("Human-input upsert error:", error);
      sendServerError(res, error, "Failed to record human input");
    }
  });

  // List all ledger rows for a project (optionally concept-scoped). Used for
  // admin/debug surfaces and by the Pannu pre-fill page to render source chips.
  app.get("/api/projects/:id/human-inputs", isAuthenticated, async (req, res) => {
    try {
      const conceptId = typeof req.query.conceptId === "string" ? req.query.conceptId : null;
      const rows = await listHumanInputs({ projectId: req.params.id, conceptId });
      res.json({ inputs: rows });
    } catch (error: any) {
      console.error("Human-input list error:", error);
      sendServerError(res, error, "Failed to load human inputs");
    }
  });

  // Build the Pannu pre-fill payload for a given concept. Returns one entry
  // per Pannu factor with a deterministic draft + the source list that
  // contributed to it. No AI runs here.
  app.get("/api/projects/:id/pannu/prefill", isAuthenticated, async (req, res) => {
    try {
      const conceptId = typeof req.query.conceptId === "string" ? req.query.conceptId : null;
      const summarize = req.query.summarize !== "false"; // default true
      const factorParam = typeof req.query.factor === "string" ? req.query.factor : null;
      const summarizeFactor =
        factorParam === "conception" || factorParam === "quality" || factorParam === "known_concepts"
          ? factorParam
          : null;

      // Pull the concept's text + per-factor questions from the existing
      // pannu_record so the summarizer has topic-lock and per-factor question
      // context. Both are optional — the summarizer falls back to generic
      // factor questions and empty claim text if not found.
      let claimText: string | null = null;
      const factorQuestions: Partial<Record<"conception" | "quality" | "known_concepts", string>> = {};
      if (conceptId) {
        try {
          const records = await storage.getPannuRecords(req.params.id);
          const record = records.find((r) => r.conceptId === conceptId);
          if (record) {
            claimText = record.claimText ?? null;
            const qs = (record.questions ?? null) as any;
            const list = Array.isArray(qs) ? qs : Array.isArray(qs?.questions) ? qs.questions : [];
            for (const q of list) {
              if (q && typeof q.factor === "string" && typeof q.question === "string") {
                if (q.factor === "conception" || q.factor === "quality" || q.factor === "known_concepts") {
                  factorQuestions[q.factor as "conception" | "quality" | "known_concepts"] = q.question;
                }
              }
            }
          }
        } catch (e: any) {
          console.warn("[pannu prefill] could not load concept context:", e?.message);
        }
      }

      const prefill = await buildPannuPrefill({
        projectId: req.params.id,
        conceptId,
        claimText,
        factorQuestions,
        summarize,
        summarizeFactor,
      });
      res.json(prefill);
    } catch (error: any) {
      console.error("Pannu pre-fill error:", error);
      sendServerError(res, error, "Failed to build Pannu pre-fill");
    }
  });

  // ============================================
  // PANNU TEST ROUTES
  // ============================================

  // Get Pannu records for a project
  app.get("/api/projects/:id/conception", isAuthenticated, async (req, res) => {
    try {
      const records = await storage.getPannuRecords(req.params.id);
      res.json(records);
    } catch (error: any) {
      console.error("Get Pannu records error:", error);
      res.status(500).json({ message: "Failed to get Pannu records" });
    }
  });

  // Generate Pannu questions for a concept
  app.post("/api/projects/:id/conception/generate-questions", isAuthenticated, async (req, res) => {
    try {
      const { conceptId, keyConceptText, strategyContext } = req.body;

      if (!conceptId || !keyConceptText) {
        return res.status(400).json({ message: "Missing required fields: conceptId, keyConceptText" });
      }

      // Check for existing record and update, or create new
      const existingRecords = await storage.getPannuRecords(req.params.id);
      let pannuRecord = existingRecords.find(r => r.conceptId === conceptId);

      if (pannuRecord) {
        // Update existing record - clear old data for retry
        await storage.updatePannuRecord(pannuRecord.id, {
          claimText: keyConceptText,
          strategyContext: strategyContext || null,
          questions: null,
          answers: null,
          certificationStatus: null,
          confidenceScore: null,
          pannuRecordText: null,
        });
      } else {
        // Create new record
        pannuRecord = await storage.createPannuRecord({
          projectId: req.params.id,
          conceptId,
          claimText: keyConceptText,
          strategyContext: strategyContext || null,
        });
      }

      // Call n8n webhook to generate questions
      const webhookPayload = {
        claim_text: keyConceptText,
        concept_id: conceptId,
        strategy_context: strategyContext || "",
      };

      console.log("Calling Pannu questions webhook:", JSON.stringify(webhookPayload, null, 2));
      
      // Default Pannu questions based on the three factors
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
          console.log("Using default Pannu questions — agent returned no questions:", "error" in agentResponse ? agentResponse.error : "unknown");
        }
      } catch (agentError) {
        console.log("Using default Pannu questions due to agent error:", agentError);
      }
      
      await storage.updatePannuRecord(pannuRecord.id, {
        questions: questions,
      });

      res.json({
        success: true,
        pannuRecordId: pannuRecord.id,
        conceptId,
        questions,
      });
    } catch (error: any) {
      console.error("Generate Pannu questions error:", error);
      sendServerError(res, error, "Failed to generate Pannu questions");
    }
  });

  // Validate Pannu answers for a claim
  app.post("/api/projects/:id/conception/validate-answers", isAuthenticated, async (req, res) => {
    try {
      const { pannuRecordId, conceptId, keyConceptText, answers } = req.body;
      
      if (!conceptId || !keyConceptText || !answers) {
        return res.status(400).json({ message: "Missing required fields: conceptId, keyConceptText, answers" });
      }

      // Call n8n webhook to validate answers
      const webhookPayload = {
        claim_text: keyConceptText,
        concept_id: conceptId,
        human_answers: answers,
      };

      console.log("Calling Module 4/4c Pannu scorer agent...");
      const scorerResponse = await runPannuScorer(webhookPayload);
      const certificationStatus = scorerResponse.certification_status;
      const confidenceScore = scorerResponse.confidence_score;
      const pannuRecordText = scorerResponse.pannu_record_text;

      // Update Pannu record with answers and validation results
      if (pannuRecordId) {
        await storage.updatePannuRecord(pannuRecordId, {
          answers: answers,
          certificationStatus,
          confidenceScore: String(confidenceScore),
          pannuRecordText,
        });
      } else {
        // Find existing record by conceptId or create new one
        const existingRecord = await storage.getPannuRecord(req.params.id, conceptId);
        if (existingRecord) {
          await storage.updatePannuRecord(existingRecord.id, {
            answers: answers,
            certificationStatus,
            confidenceScore: String(confidenceScore),
            pannuRecordText,
          });
        } else {
          await storage.createPannuRecord({
            projectId: req.params.id,
            conceptId,
            claimText: keyConceptText,
            answers,
            certificationStatus,
            confidenceScore: String(confidenceScore),
            pannuRecordText,
          });
        }
      }

      res.json({
        success: true,
        conceptId,
        certificationStatus,
        confidenceScore,
        pannuRecordText,
      });
    } catch (error: any) {
      console.error("Validate Pannu answers error:", error);
      sendServerError(res, error, "Failed to validate Pannu answers");
    }
  });

  // Get AI suggestion for Pannu test answer
  app.post("/api/projects/:id/conception/ai-suggestion", isAuthenticated, async (req, res) => {
    try {
      const { keyConceptText, question, factor, userDraft } = req.body;

      const webhookPayload = {
        keyConceptText,
        question,
        factor,
        userDraft: typeof userDraft === "string" ? userDraft : "",
      };

      console.log("Calling Module 4/4d Pannu suggestion agent...");
      const agentResponse = await runPannuSuggestion(webhookPayload);
      const suggestion = agentResponse.success
        ? agentResponse.suggestion
        : "Unable to generate suggestion at this time.";

      res.json({
        success: true,
        suggestion,
        insufficient: agentResponse.success ? agentResponse.insufficient : false,
        missing: agentResponse.success ? agentResponse.missing : [],
      });
    } catch (error: any) {
      console.error("Pannu AI suggestion error:", error);
      sendServerError(res, error, "Failed to generate AI suggestion");
    }
  });

  // Q&A Assistant — migrated to direct AI call (server/modules/qa/qa-assistant.ts)

  app.post("/api/projects/:id/qa-assistant", isAuthenticated, async (req, res) => {
    try {
      const { message, conversationHistory, currentLocation, pageSnapshot } = req.body;
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ message: "Message is required" });
      }

      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const [agent1Data, agent2Data, agent3Data, agent4Data, agent5Data] = await Promise.all([
        storage.getAgentData(req.params.id, 1),
        storage.getAgentData(req.params.id, 2),
        storage.getAgentData(req.params.id, 3),
        storage.getAgentData(req.params.id, 4),
        storage.getAgentData(req.params.id, 5),
      ]);
      const agent1Obj = agent1Data?.data as any;
      const agent2Obj = agent2Data?.data as any;
      const agent3Obj = agent3Data?.data as any;
      const agent4Obj = agent4Data?.data as any;
      const agent5Obj = agent5Data?.data as any;

      // Trust the user's actual location. project.currentStage in the DB only
      // advances when a "proceed" mutation fires; if the user navigates the
      // URL directly, the DB lags. We derive the stage from the page the user
      // is on (pageSnapshot.route, falling back to the location label) and
      // use whichever is further along. The helper then never sees a
      // contradictory stage and won't generate "state ambiguity, please
      // refresh" replies.
      const urlPath: string =
        (pageSnapshot && typeof pageSnapshot === "object" && typeof (pageSnapshot as any).route === "string"
          ? (pageSnapshot as any).route
          : "") || (typeof currentLocation === "string" ? currentLocation : "");
      const agentMatch = urlPath.match(/\/agent\/(\d+)([a-z\-]*)?/i);
      const urlStage = agentMatch ? parseInt(agentMatch[1], 10) : 0;
      const urlSubstageRaw = agentMatch ? (agentMatch[2] || "").replace(/^-/, "") : "";
      const urlSubstage = urlSubstageRaw || null;
      const dbStage = typeof project.currentStage === "number" ? project.currentStage : 0;

      // "WHERE AM I" IS AUTHORITATIVE FROM THE PAGE — per
      // LAW_DECLARED_PHASE_AUTHORITATIVE, each workflow page declares its
      // prompt-phase (1..8) in the snapshot, because the page is the only thing
      // that truly knows which phase the inventor is in. The app's URL/DB stage
      // numbering does NOT match the prompt's phase numbering for the back half
      // of the flow (Proof of Human Conception is /agent/4-conception but
      // prompt-phase 6; Key Concepts Selection is /agent/4b but phase 5; the
      // Showcase is /agent/5 but phase 7 or 8 depending on sub-state). Deriving
      // the phase from the URL digit collapses these onto the wrong phase and
      // makes the helper run the wrong rulebook. So we trust the page's declared
      // phase when present, and fall back to the URL/DB derivation only for
      // surfaces that haven't declared one (non-workflow pages, fallback scrapes).
      const declaredPhase =
        pageSnapshot && typeof pageSnapshot === "object" && typeof (pageSnapshot as any).phase === "number"
          ? (pageSnapshot as any).phase as number
          : null;
      // Fallback when no page-declared phase: trust the URL the user is on.
      // We deliberately do NOT take Math.max(dbStage, urlStage) here. The DB
      // stage is "the farthest forward the user has been"; the URL is "where
      // the user is right now." When the inventor navigates BACK from a later
      // stage (because they didn't like the result and rolled back), dbStage
      // is stale and higher than urlStage, and max() would tell the helper
      // they're still at the page they came from — so the helper keeps
      // referencing concepts and buttons from a page the user has already
      // left. The URL is the ground truth for the user's current location;
      // dbStage is only useful when there's no URL signal at all (dashboard,
      // admin pages, fallback scrapes).
      const effectiveStage = declaredPhase ?? (urlStage > 0 ? urlStage : dbStage);

      // Polish mode = the inventor is on the Showcase page running the final
      // audit (prompt-phase 8). The helper here must audit ONLY the saved
      // final draft — any injection of the raw idea, earlier-stage concepts,
      // or prior chat history lets the model quote phrases that were never
      // carried into the draft (the "upon a user clicking" class of false
      // positives). Freshness checkpoint is the per-tab Save button on the
      // showcase; we read `agent_data.provisionalDraft` fresh on every turn.
      const isPolishMode = effectiveStage === 8;

      const polishDraftRaw = isPolishMode
        ? (agent5Obj?.provisionalDraft ?? agent4Obj?.provisionalDraft ?? null)
        : null;

      // Diagram + download gate derivation for polish mode.
      // Source of truth is `agent_data.data.diagrams` on agent_stage=5: an
      // array whose presence means generation completed. There is no DB
      // "in_progress" record — that state is purely client-side (React Query
      // mutation pending). The showcase exposes the pending state via
      // pageSnapshot.actions where the `generate-diagrams` action is present
      // but enabled=false. We honor that signal when diagrams are still empty,
      // so the helper can land on SUB-STATE B ("awaiting diagrams") and avoid
      // sending the inventor to click a button that's already in flight.
      const diagramsArrForPolish = isPolishMode
        ? (Array.isArray(agent5Obj?.diagrams) ? agent5Obj.diagrams : [])
        : [];
      const diagramsCompleteForPolish = diagramsArrForPolish.length > 0;
      const generateDiagramsActionPending = (() => {
        if (!isPolishMode) return false;
        const actions = (pageSnapshot && typeof pageSnapshot === "object" && Array.isArray((pageSnapshot as any).actions))
          ? (pageSnapshot as any).actions
          : null;
        if (!actions) return false;
        const a = actions.find((x: any) => x && x.id === "generate-diagrams");
        // Action present + explicitly disabled = mutation in flight. Absent
        // (the showcase usually hides the button once diagrams exist) does
        // NOT imply pending.
        return !!(a && a.enabled === false);
      })();
      const diagramGenerationStatusForPolish: "not_started" | "in_progress" | "complete" =
        diagramsCompleteForPolish
          ? "complete"
          : (generateDiagramsActionPending ? "in_progress" : "not_started");
      const draftDownloadAvailableForPolish =
        diagramsCompleteForPolish && !!polishDraftRaw;

      const projectContext = isPolishMode
        ? {
            // Slim polish-mode shape. The helper sees identity + the freshly
            // parsed final draft + the two substate gate fields, and nothing
            // else. All other project state is deliberately omitted so the
            // model physically cannot cite text that isn't in the audit
            // target.
            projectId: req.params.id,
            projectTitle: project.title,
            currentStage: effectiveStage,
            currentSubstage: urlSubstage,
            isPolishMode: true,
            hasProvisionalDraft: !!polishDraftRaw,
            provisionalDraft: polishDraftRaw ? parseProvisionalDraft(polishDraftRaw) : null,
            // PHASE_8 substate gates — drive the closing forward directive.
            // See LAW_POLISH_FINAL_DOC_ONLY and PHASE_8 SUB-STATE A/B/C.
            diagramGenerationStatus: diagramGenerationStatusForPolish,
            draftDownloadAvailable: draftDownloadAvailableForPolish,
          }
        : {
            projectId: req.params.id,
            projectTitle: project.title,
            currentStage: effectiveStage,
            currentSubstage: urlSubstage,
            isPolishMode: false,
            ideaSummary: agent1Obj?.ideaSummary || agent1Obj?.currentIdea || '',
            advocatePoints: agent1Obj?.advocatePoints || [],
            examinerPoints: agent1Obj?.examinerPoints || [],
            extractedIdeas: agent1Obj?.extractedIdeas || agent1Obj?.unifiedIdeas || [],
            approvedIdeas: agent1Obj?.approvedIdeas || [],
            expandedConcepts: agent2Obj?.expandedConcepts || [],
            // Stage 4 scope source — concepts that survived prior-art selection and
            // entered whitespace analysis. New shape is conceptAnalyses; legacy is
            // nuggetAnalyses. Either one's array indices define the Concept N ids
            // routing.ts uses for the leap protocol.
            conceptAnalyses: agent4Obj?.conceptAnalyses || agent4Obj?.nuggetAnalyses || [],
            priorArtResults: agent3Obj?.priorArtResults ? 'Prior art research completed' : 'Not yet completed',
            whiteSpaceAnalysis: agent4Obj?.nuggetAnalyses ? 'White space analysis completed' : 'Not yet completed',
            // Stage 5 scope source — Key Concept Sets selected after 4b.
            selectedKeyConcepts: agent4Obj?.selectedKeyConcepts || [],
            claimsGenerated: agent4Obj?.selectedKeyConcepts?.length || 0,
            provisionalDraftStatus: agent4Obj?.provisionalDraft ? 'Draft generated' : 'Not yet generated',
            hasProvisionalDraft: !!agent5Obj?.provisionalDraft,
            specificKeyConcepts: agent5Obj?.specificKeyConcepts || [],
            broaderClaims: agent5Obj?.broaderClaims || [],
            hasDiagrams: !!(agent5Obj?.diagrams?.length > 0),
            diagramCount: agent5Obj?.diagrams?.length || 0,
          };

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      (res as any).flushHeaders?.();

      // Track whether the client is still connected. When the tab/panel
      // closes, the SSE stream is torn down — we keep draining the generator
      // so its final persistence step (coachMessages.content) still runs,
      // but stop writing to a dead socket.
      let clientConnected = true;
      req.on("close", () => { clientConnected = false; });
      const send = (event: string, data: any) => {
        if (!clientConnected || res.writableEnded) return;
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          clientConnected = false;
        }
      };

      try {
        // Identity for usage-log attribution. Resolve email best-effort so
        // the admin /admin/usage page shows a name, not a UUID.
        const sessUserId = (req.session as any)?.userId as string | undefined;
        const sessUserKind = (req.session as any)?.userKind as string | undefined;
        let sessUserEmail: string | null = null;
        if (sessUserId) {
          try {
            const u = sessUserKind === "paid"
              ? await storage.getInventorUser(sessUserId)
              : await storage.getUser(sessUserId);
            sessUserEmail = u?.email ?? null;
          } catch {
            // Identity lookup failures are non-fatal — log row will just lack email.
          }
        }

        for await (const ev of runQAAssistant({
          message,
          conversationHistory: conversationHistory || [],
          projectContext,
          currentLocation: currentLocation || 'Unknown',
          sessionId: req.session?.id || '',
          userId: sessUserId ?? null,
          userEmail: sessUserEmail,
          requestId: (req.headers['x-vercel-id'] as string | undefined) ?? null,
          pageSnapshot: pageSnapshot ?? null,
        })) {
          send(ev.type, ev.data);
          // On an unrecoverable error we still stop iterating; on "done" the
          // generator has already run its final persistence step, so we can
          // break safely. If the client is gone, keep draining so the
          // generator reaches its own step 5 and the assistant message is
          // saved.
          if (ev.type === "done" || (ev.type === "error" && !ev.data?.recoverable)) break;
        }
      } catch (streamErr: any) {
        const errorId = crypto.randomBytes(4).toString("hex");
        console.error(`[ERROR ${errorId}] Q&A Assistant stream error:`, streamErr);
        send("error", { message: "Stream error", errorId, recoverable: false });
      }
      res.end();
    } catch (error: any) {
      console.error("Q&A Assistant error:", error);
      if (!res.headersSent) {
        sendServerError(res, error, "Failed to get response from Q&A Assistant");
      } else {
        const errorId = crypto.randomBytes(4).toString("hex");
        console.error(`[ERROR ${errorId}] Q&A Assistant SSE error (after headers sent):`, error);
        res.write(`event: error\ndata: ${JSON.stringify({ message: "Internal error", errorId, recoverable: false })}\n\n`);
        res.end();
      }
    }
  });

  // GET messages — chat rehydration
  app.get("/api/projects/:id/qa-assistant/messages", isAuthenticated, async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10) || 50, 200);
      res.json(await getQAMessages(req.params.id, limit));
    } catch (err: any) {
      sendServerError(res, err, "Failed to load Q&A messages");
    }
  });

  // GET POHC + Leap log
  app.get("/api/projects/:id/qa-assistant/log", isAuthenticated, async (req, res) => {
    try {
      const includeDismissed = (req.query.includeDismissed as string) === "true";
      res.json(await getQALog(req.params.id, includeDismissed));
    } catch (err: any) {
      sendServerError(res, err, "Failed to load Q&A log");
    }
  });

  // GET open questions
  app.get("/api/projects/:id/qa-assistant/open-questions", isAuthenticated, async (req, res) => {
    try {
      const includeAnswered = (req.query.includeAnswered as string) === "true";
      res.json(await getQAOpenQuestions(req.params.id, includeAnswered));
    } catch (err: any) {
      sendServerError(res, err, "Failed to load open questions");
    }
  });

  // POST manual log entry
  app.post("/api/projects/:id/qa-assistant/log", isAuthenticated, async (req, res) => {
    try {
      const { entryType, verbatimText, tags } = req.body as {
        entryType?: "pohc" | "leap" | "both"; verbatimText?: string; tags?: string[];
      };
      if (!entryType || !["pohc", "leap", "both"].includes(entryType)) {
        return res.status(400).json({ message: "entryType must be 'pohc' | 'leap' | 'both'" });
      }
      if (typeof verbatimText !== "string" || !verbatimText.trim()) {
        return res.status(400).json({ message: "verbatimText required" });
      }
      res.json(await addManualLogEntry(req.params.id, entryType, verbatimText, tags));
    } catch (err: any) {
      sendServerError(res, err, "Failed to record log entry");
    }
  });

  // PATCH log entry (edit / dismiss / re-tag)
  app.patch("/api/projects/:id/qa-assistant/log/:entryId", isAuthenticated, async (req, res) => {
    try {
      const row = await patchLogEntry(req.params.id, req.params.entryId, req.body ?? {});
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (err: any) {
      sendServerError(res, err, "Failed to update log entry");
    }
  });

  // FORCE RESET — nuclear button for the inventor. Dismisses every unanswered
  // open question for the project. POHC log entries are preserved (legal
  // record stays intact), but routing recomputes fresh on the next QA turn.
  // Surfaced as a "Start over from this stage" button in the Helper panel.
  app.post("/api/projects/:id/qa-assistant/force-reset", isAuthenticated, async (req, res) => {
    try {
      const projectId = req.params.id;
      await db.execute(drizzleSql`
        UPDATE inventor_geyser.coach_open_questions
        SET dismissed_at = NOW()
        WHERE project_id = ${projectId}
          AND answered_at IS NULL
          AND dismissed_at IS NULL
      `);
      // Optional stage scope: if body has { rollbackStage: 4 }, also dismiss
      // completion entries tagged to any Concept N from that stage so the
      // protocol re-runs every concept fresh.
      const rollbackStage = (req.body && typeof req.body.rollbackStage === "number")
        ? req.body.rollbackStage
        : null;
      if (rollbackStage !== null) {
        await db.execute(drizzleSql`
          UPDATE inventor_geyser.coach_log_entries
          SET dismissed_at = NOW()
          WHERE project_id = ${projectId}
            AND entry_type IN ('first_conceptual_leap', 'pohc_answer')
            AND dismissed_at IS NULL
        `);
      }
      res.json({ success: true, rollbackStage });
    } catch (err: any) {
      console.error("[force-reset] failed:", err);
      sendServerError(res, err, "force reset failed");
    }
  });

  // PATCH open question (dismiss)
  app.patch("/api/projects/:id/qa-assistant/open-questions/:qId", isAuthenticated, async (req, res) => {
    try {
      const row = await patchOpenQuestion(req.params.id, req.params.qId, req.body ?? {});
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (err: any) {
      sendServerError(res, err, "Failed to update open question");
    }
  });

  // Helper to extract just the claim text from broad claims webhook responses
  // The webhook returns claims_only with extra sections (Support Map, Risk Analysis, etc.)
  const extractClaimsFromBroadData = (broadKeyConcepts: any): string[] => {
    if (!broadKeyConcepts) return [];

    // New structured format: { summary: {...}, claims: [{ number, type, text, ... }] }
    if (broadKeyConcepts.claims && Array.isArray(broadKeyConcepts.claims) && broadKeyConcepts.claims.length > 0 && broadKeyConcepts.claims[0]?.text) {
      return broadKeyConcepts.claims
        .sort((a: any, b: any) => (a.number || 0) - (b.number || 0))
        .map((c: any) => c.text);
    }

    // Current format: { output: "1. A system comprising:..." }
    if (broadKeyConcepts.output && typeof broadKeyConcepts.output === 'string') {
      return extractClaimsFromBroadText(broadKeyConcepts.output);
    }

    // Legacy format: { claims_only: "..." }
    if (broadKeyConcepts.claims_only && typeof broadKeyConcepts.claims_only === 'string') {
      return extractClaimsFromBroadText(broadKeyConcepts.claims_only);
    }

    // Plain string
    if (typeof broadKeyConcepts === 'string') {
      return extractClaimsFromBroadText(broadKeyConcepts);
    }

    // Already an array of strings
    if (Array.isArray(broadKeyConcepts)) {
      if (broadKeyConcepts.length > 0 && typeof broadKeyConcepts[0] === 'object' && broadKeyConcepts[0]?.text) {
        return broadKeyConcepts.sort((a: any, b: any) => (a.number || 0) - (b.number || 0)).map((c: any) => c.text);
      }
      return broadKeyConcepts.map((c: any) => typeof c === 'string' ? c : c.text || JSON.stringify(c));
    }

    // Generic object with claims property
    if (broadKeyConcepts.claims) {
      return extractClaimsFromBroadData(broadKeyConcepts.claims);
    }

    return [];
  };

  const extractClaimsFromBroadText = (text: string): string[] => {
    if (!text) return [];
    let cleanText = text.replace(/\\n/g, '\n');
    
    // Truncate at known non-claim sections
    const sectionCutoffs = [
      /\n#{1,4}\s*\d*\.?\s*Support\s*Map/i,
      /\n#{1,4}\s*\d*\.?\s*Risk\s*Analysis/i,
      /\n#{1,4}\s*\d*\.?\s*Broadening\s*Rationale/i,
      /\n#{1,4}\s*\d*\.?\s*Execution\s*Notes/i,
      /\n#{1,4}\s*\d*\.?\s*Processing\s*Status/i,
      /\n---+\s*\n/,
    ];
    for (const pattern of sectionCutoffs) {
      const idx = cleanText.search(pattern);
      if (idx > 0) {
        cleanText = cleanText.substring(0, idx);
      }
    }
    
    // Remove intro text before first claim
    const claimStartPatterns = [
      /\*\*Claim\s*1/i,
      /Claim\s*1[:.]\s/i,
      /^\s*1\.\s+/m,
    ];
    for (const pattern of claimStartPatterns) {
      const idx = cleanText.search(pattern);
      if (idx > 0 && idx < cleanText.length * 0.5) {
        cleanText = cleanText.substring(idx);
        break;
      }
    }
    
    // Split by claim markers
    let claims: string[] = [];
    if (/\*\*Claim\s*\d+/i.test(cleanText)) {
      claims = cleanText.split(/\*\*Claim\s*\d+[:.]\*?\*?\s*/i)
        .filter((c: string) => c.trim().length > 20)
        .map((c: string) => c.replace(/\*\*/g, '').trim());
    } else if (/(?:^|\n)Claim\s*\d+\s*:/i.test(cleanText)) {
      claims = cleanText.split(/(?:^|\n)Claim\s*\d+\s*:\s*/i)
        .filter((c: string) => c.trim().length > 20)
        .map((c: string) => c.trim());
    } else if (/^\s*1\.\s+/m.test(cleanText)) {
      claims = cleanText.split(/(?=^\s*\d+\.\s+)/m)
        .map((c: string) => c.replace(/^\s*\d+\.\s+/, '').trim())
        .filter((c: string) => c.length > 20);
    } else {
      claims = cleanText.split(/\n\n+/).filter((c: string) => c.trim().length > 20);
    }
    
    return claims;
  };

  // Helper function to parse malformed provisional draft webhook responses
  const parseProvisionalDraft = (rawDraft: any): any => {
    if (!rawDraft) return {};

    // If it's already structured properly
    if (rawDraft.title && rawDraft.background) {
      // Add backward compatibility: map keyConcepts to claims
      if (rawDraft.keyConcepts && !rawDraft.claims) {
        rawDraft.claims = rawDraft.keyConcepts;
        rawDraft.claims_count = rawDraft.keyConcepts_count;
      }
      return rawDraft;
    }
    
    // If it's an array (old format)
    if (Array.isArray(rawDraft) && rawDraft[0]?.title) {
      return rawDraft[0];
    }
    
    // If webhook returned error with text blob - try to parse it
    const textBlob = JSON.stringify(rawDraft);
    
    // Helper to unescape and extract text from XML-like tags
    const extractField = (fieldName: string): string | null => {
      const regex = new RegExp(`<${fieldName}>([\\s\\S]*?)<\\/${fieldName}>`, 'i');
      const match = textBlob.match(regex);
      if (match) {
        let text = match[1].trim();
        // Unescape special characters
        text = text
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .replace(/^"|"$/g, ''); // Remove surrounding quotes
        return text;
      }
      return null;
    };
    
    // Extract claims array
    const extractClaims = (): string[] => {
      const claimsMatch = textBlob.match(/<CLAIMS>([\s\S]*?)<\/CLAIMS>/i);
      if (claimsMatch) {
        let keyConceptsText = claimsMatch[1];
        
        // First unescape the entire claims block to prevent double-encoding issues
        keyConceptsText = keyConceptsText
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .replace(/^"|"$/g, '');
        
        // Now split by double newlines to get individual claims
        const claims = keyConceptsText
          .split(/\n\n+/)
          .map(c => c.trim())
          .filter(c => c.length > 0);
        
        return claims;
      }
      return [];
    };
    
    // Build structured draft from parsed fields
    const parsedDraft: any = {};
    
    const title = extractField('TITLE');
    if (title) parsedDraft.title = title;
    
    const background = extractField('BACKGROUND');
    if (background) parsedDraft.background = background;
    
    const summary = extractField('SUMMARY');
    if (summary) parsedDraft.summary = summary;
    
    const detailedDescription = extractField('DETAILED_DESCRIPTION');
    if (detailedDescription) parsedDraft.detailed_description = detailedDescription;
    
    const ramifications = extractField('RAMIFICATIONS_AND_SCOPE');
    if (ramifications) parsedDraft.ramifications_and_scope = ramifications;
    
    const abstract = extractField('ABSTRACT');
    if (abstract) parsedDraft.abstract = abstract;
    
    const claims = extractClaims();
    if (claims.length > 0) parsedDraft.claims = claims;
    
    return Object.keys(parsedDraft).length > 0 ? parsedDraft : rawDraft;
  };

  // Helper to clean up markdown formatting in claims (asterisks, bullets, etc.)
  const cleanClaimFormatting = (text: string): string => {
    if (!text) return '';
    
    return text
      // Convert markdown bullet points (* item) to proper semicolons with indentation
      .replace(/;\s*\*\s+/g, '; ')
      .replace(/:\s*\*\s+/g, ': ')
      .replace(/\s+\*\s+/g, ' ')
      // Clean up multiple spaces
      .replace(/\s{2,}/g, ' ')
      // Fix spacing around punctuation
      .replace(/\s+;/g, ';')
      .replace(/\s+,/g, ',')
      .trim();
  };
  
  // Helper to sanitize text for PDF (removes problematic Unicode characters but preserves common symbols)
  const sanitizeForPDF = (text: string | undefined | null): string => {
    if (!text) return '';
    
    // First, convert escaped Unicode sequences (like \u00b1) to actual characters
    let processed = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => {
      return String.fromCharCode(parseInt(code, 16));
    });
    
    // Normalize Unicode using NFC (composed form - preserves symbols like ±)
    processed = processed.normalize('NFC');
    
    // Remove markdown tables (rows of dashes and pipes)
    processed = processed
      .replace(/\|[^|]*\|/g, '') // Remove pipe-delimited table cells
      .replace(/^\s*\|.*\|.*$/gm, '') // Remove lines that look like table rows
      .replace(/^[-:|]+$/gm, '') // Remove table separator lines (---|---|---)
      .replace(/-{5,}/g, '') // Remove long sequences of dashes (5 or more)
      .replace(/## \d+\.\s*Support Map.*$/gm, '') // Remove "## 2. Support Map" headings
      .replace(/Claim Limitation.*Reference Numerals.*$/gm, '') // Remove table headers
      .replace(/Supporting Specification Excerpt.*$/gm, '') // Remove table header fragments
      .replace(/\n{3,}/g, '\n\n'); // Collapse multiple blank lines
    
    // Remove only truly problematic characters
    return processed
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
      .replace(/[\u2000-\u200F]/g, ' ') // Replace special invisible spaces/joiners with regular spaces
      .replace(/[\uFFF0-\uFFFF]/g, '') // Remove specials (but not ±, which is \u00B1)
      .trim();
  };
  
  // Helper to sanitize abstract for USPTO compliance (max 150 words, no figure references)
  const sanitizeAbstractForUSPTO = (text: string | undefined | null): string => {
    if (!text) return '';
    
    let cleaned = text
      // Remove figure/image references
      .replace(/\bFigure\s*\d+\b/gi, '')
      .replace(/\bFIG\.\s*\d+\b/gi, '')
      .replace(/\bFIG\s*\d+\b/gi, '')
      .replace(/\bdiagram\s*\d+\b/gi, '')
      .replace(/\bas shown in.*?(?:\.|$)/gi, '.')
      .replace(/\bas illustrated in.*?(?:\.|$)/gi, '.')
      .replace(/\brefer(?:ring)? to.*?(?:figure|fig|diagram).*?(?:\.|$)/gi, '.')
      // Remove markdown image syntax
      .replace(/!\[.*?\]\(.*?\)/g, '')
      // Remove any bracketed references like [FIG. 1]
      .replace(/\[(?:fig|figure|diagram).*?\]/gi, '')
      // Clean up multiple spaces and periods
      .replace(/\s{2,}/g, ' ')
      .replace(/\.{2,}/g, '.')
      .replace(/\.\s*\./g, '.')
      .trim();
    
    // Limit to 150 words
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 150) {
      cleaned = words.slice(0, 147).join(' ') + '...';
    }
    
    return cleaned;
  };
  
  // Helper to fix dependent claim references (ensures they reference correct parent claim)
  const fixClaimReferences = (claims: string[]): string[] => {
    let currentIndependentClaimNum = 0;
    
    return claims.map((claim) => {
      const trimmed = claim.trim();
      // Check if this is an independent claim (starts with digit followed by period, no sub-number)
      const independentMatch = trimmed.match(/^(\d+)\.\s+(?!\d)/);
      // Check if this is a dependent claim (has format like "1.1." or "  2.3.")
      const dependentMatch = trimmed.match(/^(\d+)\.(\d+)\./);
      
      if (independentMatch) {
        currentIndependentClaimNum = parseInt(independentMatch[1], 10);
        return claim;
      } else if (dependentMatch) {
        const parentClaimNum = parseInt(dependentMatch[1], 10);
        // Fix references to "claim 1" if they should reference a different parent
        if (currentIndependentClaimNum > 0 && parentClaimNum === currentIndependentClaimNum) {
          // The claim number matches, now fix any text references
          return claim.replace(/claim\s+1\b/gi, `claim ${currentIndependentClaimNum}`);
        }
        return claim;
      }
      
      return claim;
    });
  };

  // Helper to render markdown text to PDF with proper formatting
  const renderMarkdownToPDF = async (doc: any, text: string, options: { fontSize?: number; lineGap?: number } = {}) => {
    const { marked } = await import('marked');
    const fontSize = options.fontSize || 11;
    const lineGap = options.lineGap || 4;
    
    if (!text) return;
    
    // Pre-process text - minimal changes, preserve original formatting
    let preprocessed = text
      // Convert section markers to proper headings
      .replace(/\[SECTION:\s*([^\]]+)\]/g, '\n\n## $1\n\n')
      // Convert single asterisk bullet points to proper format (avoid conflicting with bold **)
      .replace(/^\s*\*\s+(?!\*)/gm, '• ')
      .replace(/\n\s*\*\s+(?!\*)/g, '\n• ')
      // Clean up multiple newlines
      .replace(/\n{3,}/g, '\n\n');
    
    // Parse markdown to tokens
    const tokens = marked.lexer(preprocessed);
    
    // Helper to clean any remaining markdown artifacts from text
    // IMPORTANT: Do NOT trim - preserve leading/trailing spaces for inline text flow
    const cleanText = (text: string, preserveSpaces: boolean = true): string => {
      let cleaned = text
        .replace(/\*\*/g, '')  // Remove any remaining bold markers
        .replace(/^\*\s*/g, '• ')  // Convert leading asterisk to bullet
        .replace(/\s+/g, ' ');  // Normalize multiple whitespace to single space (but keep single spaces)
      
      // Only trim if explicitly requested (for standalone blocks, not inline)
      return preserveSpaces ? cleaned : cleaned.trim();
    };
    
    // Recursive function to render inline tokens (bold, italic, text)
    // IMPORTANT: Preserve spaces between tokens for proper text flow
    const renderInlineTokens = (inlineTokens: any[], continued: boolean = false) => {
      inlineTokens.forEach((token: any, idx: number) => {
        const isLast = idx === inlineTokens.length - 1;
        const shouldContinue = continued || !isLast;
        
        if (token.type === 'strong') {
          // Bold text - preserve spaces
          let boldText = token.tokens ? 
            token.tokens.map((t: any) => t.raw || t.text || '').join('') : 
            (token.text || '');
          boldText = cleanText(boldText, true);  // Keep spaces
          if (boldText && boldText.trim()) {
            doc.font('Helvetica-Bold').text(boldText, { continued: shouldContinue, lineGap });
          }
        } else if (token.type === 'em') {
          // Italic text - preserve spaces
          let italicText = token.tokens ? 
            token.tokens.map((t: any) => t.raw || t.text || '').join('') : 
            (token.text || '');
          italicText = cleanText(italicText, true);  // Keep spaces
          if (italicText && italicText.trim()) {
            doc.font('Helvetica-Oblique').text(italicText, { continued: shouldContinue, lineGap });
          }
        } else if (token.type === 'text' || token.type === 'codespan') {
          // Regular text - CRITICAL: preserve leading/trailing spaces for inline flow
          const textContent = cleanText(token.text || token.raw || '', true);
          if (textContent) {  // Don't check trim here - spaces are meaningful
            doc.font('Helvetica').text(textContent, { continued: shouldContinue, lineGap });
          }
        } else if (token.type === 'escape') {
          doc.font('Helvetica').text(token.text || '', { continued: shouldContinue, lineGap });
        } else if (token.tokens && Array.isArray(token.tokens)) {
          // Nested tokens
          renderInlineTokens(token.tokens, shouldContinue);
        } else if (token.raw) {
          const rawContent = cleanText(token.raw, true);
          if (rawContent) {
            doc.font('Helvetica').text(rawContent, { continued: shouldContinue, lineGap });
          }
        }
      });
    };
    
    // Process each block token
    tokens.forEach((token: any, blockIdx: number) => {
      doc.fontSize(fontSize);
      
      if (token.type === 'heading') {
        // Heading - make it bold and larger
        const headingSize = token.depth === 1 ? 14 : token.depth === 2 ? 13 : 12;
        doc.moveDown(0.5);
        doc.fontSize(headingSize).font('Helvetica-Bold');
        if (token.tokens) {
          renderInlineTokens(token.tokens, false);
        } else {
          doc.text(token.text || '');
        }
        doc.moveDown(0.5);
        
      } else if (token.type === 'paragraph') {
        doc.fontSize(fontSize);
        if (token.tokens) {
          renderInlineTokens(token.tokens, false);
        } else {
          doc.font('Helvetica').text(token.text || '', { lineGap });
        }
        doc.moveDown(0.8);
        
      } else if (token.type === 'list') {
        token.items.forEach((item: any, itemIdx: number) => {
          const prefix = token.ordered ? `${token.start + itemIdx}. ` : '• ';
          doc.fontSize(fontSize).font('Helvetica').text(prefix, { continued: true, lineGap });
          if (item.tokens) {
            // Get text from first paragraph in list item
            const firstPara = item.tokens.find((t: any) => t.type === 'text' || t.type === 'paragraph');
            if (firstPara && firstPara.tokens) {
              renderInlineTokens(firstPara.tokens, false);
            } else if (firstPara) {
              doc.text(firstPara.text || '', { lineGap });
            } else {
              doc.text('', { lineGap });
            }
          } else {
            doc.text(item.text || '', { lineGap });
          }
          doc.moveDown(0.4);
        });
        doc.moveDown(0.4);
        
      } else if (token.type === 'space') {
        doc.moveDown(0.5);
        
      } else if (token.type === 'code') {
        // Code block - use monospace
        doc.font('Courier').fontSize(10).text(token.text || '', { lineGap: 2 });
        doc.moveDown(0.8);
        
      } else if (token.raw) {
        // Fallback: render raw text
        doc.fontSize(fontSize).font('Helvetica').text(token.raw.trim(), { lineGap });
        doc.moveDown(0.5);
      }
    });
  };

  // Export PDF
  app.get("/api/projects/:id/export-pdf", isAuthenticated, async (req, res) => {
    try {
      const PDFDocument = (await import('pdfkit')).default;
      const project = await storage.getProject(req.params.id);
      const agent4cData = await storage.getAgentData(req.params.id, 4);
      const agent5DataForPdf = await storage.getAgentData(req.params.id, 5);
      
      if (!project || !agent4cData) {
        return res.status(404).json({ message: "Project or draft not found" });
      }

      // Edits made via /update-specification-section land in agent 5; prefer
      // that draft so PDF exports reflect user edits. Fall back to agent 4's
      // draft only if no edits have been saved yet.
      const editedDraft = (agent5DataForPdf?.data as any)?.provisionalDraft;
      const originalDraft = (agent4cData.data as any)?.provisionalDraft;
      const rawDraft = editedDraft || originalDraft || {};
      const parsedDraft = parseProvisionalDraft(rawDraft);

      const agent5DataObj = agent5DataForPdf?.data as any;
      const selectedClaimType = agent5DataObj?.selectedClaimType || 'specific';

      // Prefer claims the user saved via /update-specification-section. Only
      // fall back to broad/specific auto-derivation when no edits exist.
      let claimsToUse: any[] = [];
      const savedEditedClaims = Array.isArray(parsedDraft.claims) && parsedDraft.claims.length > 0
        ? parsedDraft.claims
        : null;
      if (savedEditedClaims) {
        claimsToUse = savedEditedClaims;
      } else if (selectedClaimType === 'broad' && agent5DataObj?.broadKeyConcepts) {
        claimsToUse = extractClaimsFromBroadData(agent5DataObj.broadKeyConcepts);
        if (!claimsToUse || claimsToUse.length === 0) {
          claimsToUse = parsedDraft.claims || [];
        }
      } else {
        claimsToUse = parsedDraft.claims || [];
      }
      
      const sanitizedClaims = Array.isArray(claimsToUse) 
        ? claimsToUse.map((c: any) => {
            const rawText = typeof c === 'string' ? c : c.text || JSON.stringify(c);
            return cleanClaimFormatting(sanitizeForPDF(rawText));
          })
        : [];
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
        size: 'LETTER'
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=patent-${project.title || req.params.id}.pdf`);
      
      doc.pipe(res);
      
      // USPTO paragraph counter for [0001], [0002], etc.
      let pdfParaCounter = 1;
      const formatPdfParaNumber = (): string => {
        const num = pdfParaCounter++;
        return `[${num.toString().padStart(4, '0')}] `;
      };
      
      // Fetch diagrams early to check if we need BRIEF DESCRIPTION OF THE DRAWINGS
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const diagrams = (agent5Data?.data as any)?.diagrams || [];
      // Filter for diagrams with imageUrl - success property may not always be present
      const successfulDiagrams = diagrams.filter((d: any) => d.imageUrl && (d.success !== false));

      // Title
      doc.fontSize(16).font('Helvetica-Bold').text(draft.title || 'Provisional Patent Application', { align: 'center' });
      doc.moveDown(1.5);

      // Background - with paragraph numbering
      if (draft.background) {
        doc.fontSize(14).font('Helvetica-Bold').text('BACKGROUND');
        doc.moveDown(0.5);
        // Add paragraph numbers to each paragraph
        const bgParagraphs = draft.background.split(/\n\n+/).filter((p: string) => p.trim());
        for (const para of bgParagraphs) {
          doc.font('Helvetica').fontSize(11).text(`${formatPdfParaNumber()}${para.trim()}`, { lineGap: 4 });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }

      // Summary - with paragraph numbering
      if (draft.summary) {
        doc.fontSize(14).font('Helvetica-Bold').text('SUMMARY OF THE INVENTION');
        doc.moveDown(0.5);
        const sumParagraphs = draft.summary.split(/\n\n+/).filter((p: string) => p.trim());
        for (const para of sumParagraphs) {
          doc.font('Helvetica').fontSize(11).text(`${formatPdfParaNumber()}${para.trim()}`, { lineGap: 4 });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }
      
      // Brief Description of the Drawings - required by USPTO when figures are present
      if (successfulDiagrams.length > 0) {
        doc.fontSize(14).font('Helvetica-Bold').text('BRIEF DESCRIPTION OF THE DRAWINGS');
        doc.moveDown(0.5);
        
        // Intro paragraph
        doc.font('Helvetica').fontSize(11).text(
          `${formatPdfParaNumber()}The accompanying drawings, which are incorporated in and form a part of this specification, illustrate embodiments of the invention and, together with the description, serve to explain the principles of the invention.`,
          { lineGap: 4 }
        );
        doc.moveDown(0.5);
        
        // Description for each figure
        for (let i = 0; i < successfulDiagrams.length; i++) {
          const diagram = successfulDiagrams[i];
          const figNum = diagram.chartNumber || (i + 1);
          const figTitle = diagram.title || `Figure ${figNum}`;
          let description = 'illustrates';
          if (diagram.chartType) {
            const chartTypeDescriptions: Record<string, string> = {
              'flowchart': 'is a flowchart illustrating',
              'sequence-diagram': 'is a sequence diagram showing',
              'entity-relationship-diagram': 'is an entity-relationship diagram depicting',
              'cloud-architecture-diagram': 'is a cloud architecture diagram showing'
            };
            description = chartTypeDescriptions[diagram.chartType] || 'illustrates';
          }
          
          doc.font('Helvetica').fontSize(11).text(
            `${formatPdfParaNumber()}`,
            { continued: true, lineGap: 4 }
          );
          doc.font('Helvetica-Bold').text(`FIG. ${figNum} `, { continued: true });
          doc.font('Helvetica').text(
            `${description} ${figTitle.toLowerCase()}, in accordance with an embodiment of the present invention.`,
            { lineGap: 4 }
          );
          doc.moveDown(0.5);
        }
        
        // Add actual figure images immediately after the descriptions (each on its own page)
        for (let i = 0; i < successfulDiagrams.length; i++) {
          const diagram = successfulDiagrams[i];
          
          try {
            // Each diagram gets its own page
            doc.addPage();
            
            // Fetch the image from URL
            const imageResponse = await fetch(diagram.imageUrl);
            if (!imageResponse.ok) continue;
            
            const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
            
            // Add diagram title
            const diagramTitle = diagram.title || `Figure ${i + 1}`;
            doc.fontSize(14).font('Helvetica-Bold').text(`Figure ${diagram.chartNumber || i + 1}: ${diagramTitle}`, {
              align: 'center'
            });
            doc.moveDown(1);
            
            // Calculate image dimensions to fit the page nicely
            const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
            const pageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 80;
            
            // Add the image centered on the page
            doc.image(imageBuffer, {
              fit: [pageWidth, pageHeight],
              align: 'center'
            });
          } catch (imgError) {
            console.error(`Failed to add diagram ${i + 1}:`, imgError);
          }
        }
      }

      // Detailed Description - with paragraph numbering - starts on new page after drawings
      if (draft.detailed_description) {
        doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold').text('DETAILED DESCRIPTION');
        doc.moveDown(0.5);
        const detParagraphs = draft.detailed_description.split(/\n\n+/).filter((p: string) => p.trim());
        for (const para of detParagraphs) {
          doc.font('Helvetica').fontSize(11).text(`${formatPdfParaNumber()}${para.trim()}`, { lineGap: 4 });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }

      // Ramifications and Scope - with paragraph numbering
      if (draft.ramifications_and_scope) {
        doc.fontSize(14).font('Helvetica-Bold').text('RAMIFICATIONS AND SCOPE');
        doc.moveDown(0.5);
        const ramParagraphs = draft.ramifications_and_scope.split(/\n\n+/).filter((p: string) => p.trim());
        for (const para of ramParagraphs) {
          doc.font('Helvetica').fontSize(11).text(`${formatPdfParaNumber()}${para.trim()}`, { lineGap: 4 });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }

      // Key Concepts — prefer user edits saved via /update-specification-section,
      // fall back to the original grouped Agent 4 selections.
      const editedKeyConceptsPdf =
        (Array.isArray((parsedDraft as any).keyConcepts) && (parsedDraft as any).keyConcepts.length > 0
          ? (parsedDraft as any).keyConcepts
          : null) ||
        (Array.isArray(parsedDraft.claims) && parsedDraft.claims.length > 0 && typeof parsedDraft.claims[0] === 'string'
          ? parsedDraft.claims
          : null);

      if (editedKeyConceptsPdf) {
        doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold').text('KEY CONCEPTS');
        doc.moveDown(0.5);
        let kcIndex = 1;
        editedKeyConceptsPdf.forEach((entry: string) => {
          const cleaned = sanitizeForPDF(String(entry || '')).trim();
          if (!cleaned) return;
          doc.font('Helvetica').fontSize(11).text(`${kcIndex}. ${cleaned}`, { lineGap: 4, align: 'left' });
          doc.moveDown(0.5);
          kcIndex++;
        });
        doc.moveDown(0.5);
      } else {
        const selectedKeyConcepts = (agent4cData.data as any)?.selectedKeyConcepts || (agent4cData.data as any)?.selectedClaims || [];
        if (Array.isArray(selectedKeyConcepts) && selectedKeyConcepts.length > 0) {
          doc.addPage();
          doc.fontSize(14).font('Helvetica-Bold').text('KEY CONCEPTS');
          doc.moveDown(0.5);

          const groupedByVariation: Record<string, any[]> = {};
          selectedKeyConcepts.forEach((concept: any) => {
            const variationId = concept.variationId || 'default';
            if (!groupedByVariation[variationId]) groupedByVariation[variationId] = [];
            groupedByVariation[variationId].push(concept);
          });

          let groupNumber = 1;
          Object.keys(groupedByVariation).forEach((variationId) => {
            const groupConcepts = groupedByVariation[variationId];
            doc.moveDown(0.3);
            doc.font('Helvetica-Bold').fontSize(12).text(`Group ${groupNumber}`, { lineGap: 4 });
            doc.moveDown(0.3);

            groupConcepts.forEach((concept: any, conceptIndex: number) => {
              const cleanedText = sanitizeForPDF(String(concept.text || '')).trim();
              const label = `Key Concept ${conceptIndex + 1}: `;
              doc.font('Helvetica').fontSize(11).text(label + cleanedText, {
                lineGap: 4,
                align: 'left'
              });
              doc.moveDown(0.5);
            });
            groupNumber++;
          });
          doc.moveDown(0.5);
        }
      }

      // Abstract - MUST be the absolute final section with zero images after it
      if (draft.abstract) {
        doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold').text('ABSTRACT');
        doc.moveDown(0.5);
        const absParagraphs = draft.abstract.split(/\n\n+/).filter((p: string) => p.trim());
        for (const para of absParagraphs) {
          doc.font('Helvetica').fontSize(11).text(`${formatPdfParaNumber()}${para.trim()}`, { lineGap: 4 });
          doc.moveDown(0.5);
        }
      }

      doc.end();

      // Provenance: provisional PDF export is a checkpoint.
      createCheckpointBackground({
        projectId: req.params.id,
        eventType: "export_provisional",
        refTable: "export",
        refId: null,
        payload: { exportType: "pdf", at: new Date().toISOString() },
      });
    } catch (error: any) {
      console.error("Export PDF error:", error);
      res.status(500).json({ message: "Failed to export PDF" });
    }
  });

  // Export PoHC (Proof of Human Conception) DOCX — a separate, evidentiary
  // file containing every verbatim record captured for this project: the
  // formal pohcLog entries (recordEntry tool calls) and the human_inputs
  // ledger (textarea-typed verbatims across all modules). Leads with a
  // prominent red WARNING that this file is for the inventor's own records
  // and MUST NOT be uploaded with the patent filing.
  app.get("/api/projects/:id/export-pohc-docx", isAuthenticated, async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ message: "Invalid project id" });
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (!sessionOwnsProject(req, project)) {
        return res.status(404).json({ message: "Project not found" });
      }

      const pohc = await buildPoHCDocx(req.params.id);
      if (!pohc) return res.status(404).json({ message: "Project not found" });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${pohc.filename}"`);
      res.send(pohc.buffer);

      createCheckpointBackground({
        projectId: req.params.id,
        eventType: "export_pohc",
        refTable: "export",
        refId: null,
        payload: { exportType: "pohc_docx", at: new Date().toISOString() },
      });
    } catch (error: any) {
      console.error("[export-pohc-docx] error:", error);
      sendServerError(res, error, "Failed to export PoHC");
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // Provenance cron — daily OpenTimestamps Bitcoin Merkle anchor.
  //
  // Protected by a shared secret. Two paths to authenticate:
  //   1. Vercel Cron sends `x-vercel-cron-signature` (validated by Vercel
  //      at the platform level when the route is in `vercel.json` crons).
  //      We accept any request that carries the `user-agent: vercel-cron/...`
  //      AND has a non-empty signature header.
  //   2. Manual / external schedulers: send `x-cron-secret` matching
  //      process.env.PROVENANCE_CRON_SECRET.
  //
  // If neither matches, return 401 with no body details (don't leak which
  // mechanism we're checking).
  app.post("/api/cron/provenance-anchor", async (req, res) => {
    const cronSecret = process.env.PROVENANCE_CRON_SECRET;
    const headerSecret = req.header("x-cron-secret");
    const vercelSig = req.header("x-vercel-cron-signature");
    const ua = req.header("user-agent") || "";

    const authedByVercel = !!vercelSig && /vercel-cron/i.test(ua);
    const authedBySecret = !!cronSecret && headerSecret === cronSecret;

    if (!authedByVercel && !authedBySecret) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      // Anchor "yesterday" UTC by default so we only fold events from a
      // day that has fully closed. Caller can override with ?date=YYYY-MM-DD
      // for backfill.
      let target: Date;
      const dateParam = String(req.query.date ?? "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        target = new Date(`${dateParam}T00:00:00.000Z`);
        if (Number.isNaN(target.getTime())) {
          return res.status(400).json({ message: "Invalid date" });
        }
      } else {
        const now = new Date();
        target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
      }

      const result = await runDailyAnchor(target);
      res.json({ ok: true, ...result });
    } catch (error: any) {
      console.error("[cron/provenance-anchor] error:", error);
      sendServerError(res, error, "Anchor run failed");
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // Provenance — chain verification + downloadable proof package.
  //
  // Wording rule (mirrors the user-facing copy elsewhere): never claim
  // ownership or that this replaces a filing. This system creates third-
  // party cryptographic evidence that a specific disclosure existed at or
  // before a verified time and has not been altered.
  // ───────────────────────────────────────────────────────────────────────

  // Verify the append-only hash chain for a project. Returns the chain
  // status plus the list of TSA stamps attached to each event.
  app.get("/api/projects/:id/provenance/verify", isAuthenticated, async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ message: "Invalid project id" });
      }
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      // Authorization: 404 (not 403) so we don't leak existence of other
      // users' projects to a guessing attacker.
      if (!sessionOwnsProject(req, project)) {
        return res.status(404).json({ message: "Project not found" });
      }

      const chain = await verifyChain(req.params.id);

      const events = await db
        .select({
          id: provenanceEvents.id,
          eventType: provenanceEvents.eventType,
          refTable: provenanceEvents.refTable,
          refId: provenanceEvents.refId,
          payloadHash: provenanceEvents.payloadHash,
          prevHash: provenanceEvents.prevHash,
          eventHash: provenanceEvents.eventHash,
          createdAt: provenanceEvents.createdAt,
        })
        .from(provenanceEvents)
        .where(drizzleEq(provenanceEvents.projectId, req.params.id))
        .orderBy(drizzleAsc(provenanceEvents.createdAt));

      const stamps = await db
        .select({
          id: provenanceStamps.id,
          eventId: provenanceStamps.eventId,
          tsaUrl: provenanceStamps.tsaUrl,
          requestHash: provenanceStamps.requestHash,
          createdAt: provenanceStamps.createdAt,
        })
        .from(provenanceStamps)
        .where(drizzleEq(provenanceStamps.projectId, req.params.id));

      const stampsByEvent = new Map<string, typeof stamps>();
      for (const s of stamps) {
        const arr = stampsByEvent.get(s.eventId) ?? [];
        arr.push(s);
        stampsByEvent.set(s.eventId, arr);
      }

      res.json({
        projectId: req.params.id,
        chain,
        events: events.map((e) => ({
          ...e,
          stamps: stampsByEvent.get(e.id) ?? [],
        })),
        tsaProviders: TSA_PROVIDERS.map((p) => ({ label: p.label, url: p.url })),
      });
    } catch (error: any) {
      console.error("[provenance/verify] error:", error);
      sendServerError(res, error, "Verification failed");
    }
  });

  // Build and stream a Proof Package zip for a specific checkpoint event.
  // Contains everything a third party needs to independently verify that
  // the disclosure bytes existed at or before each TSA's signed time:
  //   - canonical-disclosure.json   (exact bytes that were hashed)
  //   - sha256.txt                  (the imprint sent to every TSA)
  //   - timestamp-response-N.tsr    (one per TSA that responded)
  //   - tsa-certificates.pem        (cert chains for offline verify)
  //   - tsa-provider-details.json   (URL + label + policy metadata)
  //   - event-chain.json            (full hash chain for this project)
  //   - verification-instructions.txt
  // Convenience variant: serve the proof package for the most recent
  // *stamped* checkpoint event (i.e. one that has at least one TSA token).
  // Used by the UI "Download Proof Package" button.
  app.get("/api/projects/:id/provenance/proof-package", isAuthenticated, async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ message: "Invalid project id" });
      }
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (!sessionOwnsProject(req, project)) {
        return res.status(404).json({ message: "Project not found" });
      }

      const [latest] = await db
        .select({ id: provenanceEvents.id })
        .from(provenanceEvents)
        .innerJoin(provenanceStamps, drizzleEq(provenanceStamps.eventId, provenanceEvents.id))
        .where(drizzleEq(provenanceEvents.projectId, req.params.id))
        .orderBy(drizzleDesc(provenanceEvents.createdAt))
        .limit(1);

      if (!latest) {
        return res.status(404).json({
          message: "No stamped checkpoints yet. Finalize a stage or export a draft to create one.",
        });
      }

      await streamProofPackage(req, res, req.params.id, latest.id);
    } catch (error: any) {
      console.error("[provenance/proof-package latest] error:", error);
      if (!res.headersSent) {
        sendServerError(res, error, "Failed to locate proof package");
      }
    }
  });

  app.get("/api/projects/:id/provenance/proof-package/:eventId", isAuthenticated, async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.eventId)) {
        return res.status(400).json({ message: "Invalid id" });
      }
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (!sessionOwnsProject(req, project)) {
        return res.status(404).json({ message: "Project not found" });
      }

      await streamProofPackage(req, res, req.params.id, req.params.eventId);
    } catch (error: any) {
      console.error("[provenance/proof-package] error:", error);
      if (!res.headersSent) {
        sendServerError(res, error, "Failed to build proof package");
      }
    }
  });

  // Helper: builds the zip and streams it. Caller must have already
  // validated ownership and existence of the project.
  async function streamProofPackage(_req: Request, res: Response, projectId: string, eventId: string): Promise<void> {
    const [event] = await db
      .select()
      .from(provenanceEvents)
      .where(drizzleAnd(
        drizzleEq(provenanceEvents.id, eventId),
        drizzleEq(provenanceEvents.projectId, projectId),
      ))
      .limit(1);
    if (!event) {
      res.status(404).json({ message: "Checkpoint not found" });
      return;
    }

      const eventStamps = await db
        .select()
        .from(provenanceStamps)
        .where(drizzleEq(provenanceStamps.eventId, event.id))
        .orderBy(drizzleAsc(provenanceStamps.createdAt));

      const fullChain = await db
        .select()
        .from(provenanceEvents)
        .where(drizzleEq(provenanceEvents.projectId, projectId))
        .orderBy(drizzleAsc(provenanceEvents.createdAt));

      const filename = `patentgeyser-proof-${projectId}-${event.id}.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      const archive = await createZipArchive({ zlib: { level: 9 } });
      archive.on("error", (err) => {
        console.error("[proof-package] archive error:", err);
        try { res.status(500).end(); } catch {}
      });
      archive.pipe(res);

      // 1. The exact canonical bytes that produced payloadHash. Verifier
      //    recomputes sha256 of this file and confirms it equals sha256.txt
      //    AND matches the MessageImprint inside every .tsr.
      if (event.payloadCanonical) {
        archive.append(event.payloadCanonical, { name: "canonical-disclosure.json" });
      } else {
        archive.append(
          "// This checkpoint was created before canonical payload persistence " +
          "was enabled. Hash-chain verification is still possible from " +
          "event-chain.json, but the original disclosure bytes are not bundled.\n",
          { name: "canonical-disclosure.json" },
        );
      }

      archive.append(event.payloadHash + "\n", { name: "sha256.txt" });

      // 2. One .tsr per TSA that responded. Numbered in TSA_PROVIDERS order
      //    where possible so the filenames map to tsa-provider-details.json.
      const certPems: string[] = [];
      const providerDetails: any[] = [];
      eventStamps.forEach((s, i) => {
        const idx = i + 1;
        const tsrBytes = Buffer.from(s.tsaResponse, "base64");
        archive.append(tsrBytes, { name: `timestamp-response-${idx}.tsr` });

        if (s.tsaCert) {
          const certBytes = Buffer.from(s.tsaCert, "base64");
          // Best-effort: if it already looks like PEM, append as-is; otherwise
          // wrap as DER → PEM CERTIFICATE block. We don't parse here.
          const asText = certBytes.toString("utf8");
          if (asText.includes("-----BEGIN")) {
            certPems.push(asText.trim());
          } else {
            const b64 = certBytes.toString("base64");
            const wrapped = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
            certPems.push(`-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----`);
          }
        }

        providerDetails.push({
          index: idx,
          tsaUrl: s.tsaUrl,
          requestHash: s.requestHash,
          stampedAt: s.createdAt,
          tsrFile: `timestamp-response-${idx}.tsr`,
        });
      });

      if (certPems.length > 0) {
        archive.append(certPems.join("\n\n") + "\n", { name: "tsa-certificates.pem" });
      }

      archive.append(JSON.stringify(providerDetails, null, 2), { name: "tsa-provider-details.json" });

      // 3. The full project chain so the verifier can confirm this event's
      //    position and that nothing upstream has been mutated.
      const chainJson = fullChain.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        refTable: e.refTable,
        refId: e.refId,
        payloadHash: e.payloadHash,
        prevHash: e.prevHash,
        eventHash: e.eventHash,
        createdAt: e.createdAt,
      }));
      archive.append(JSON.stringify({
        projectId,
        focusEventId: event.id,
        events: chainJson,
      }, null, 2), { name: "event-chain.json" });

      // 3b. OpenTimestamps Bitcoin anchor for the day this event was
      // created (if the daily cron has already run for that date). We
      // include the raw .ots bytes from the first calendar plus a JSON
      // sidecar that contains every calendar's proof and the Merkle
      // inclusion path the verifier needs to tie this specific event back
      // to the anchored root.
      if (event.createdAt) {
        const eventDateStr = new Date(event.createdAt).toISOString().slice(0, 10);
        const [anchor] = await db
          .select()
          .from(provenanceAnchors)
          .where(drizzleAnd(
            drizzleEq(provenanceAnchors.projectId, projectId),
            drizzleEq(provenanceAnchors.anchorDate, eventDateStr),
          ))
          .limit(1);

        if (anchor) {
          // Reproduce the same day-events ordering anchor.ts used so the
          // Merkle path we ship matches the root that was anchored.
          const dayStart = new Date(`${eventDateStr}T00:00:00.000Z`);
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
          const dayEvents = await db
            .select({
              id: provenanceEvents.id,
              eventHash: provenanceEvents.eventHash,
              createdAt: provenanceEvents.createdAt,
            })
            .from(provenanceEvents)
            .where(drizzleAnd(
              drizzleEq(provenanceEvents.projectId, projectId),
              drizzleGte(provenanceEvents.createdAt, dayStart),
              drizzleLte(provenanceEvents.createdAt, new Date(dayEnd.getTime() - 1)),
            ));
          dayEvents.sort((a, b) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            if (ta !== tb) return ta - tb;
            return a.id.localeCompare(b.id);
          });

          const focusIdx = dayEvents.findIndex((e) => e.id === event.id);
          if (focusIdx >= 0) {
            const tree = buildMerkleTree(dayEvents.map((e) => e.eventHash));
            // Sanity: tree root must match the one stored on the anchor row.
            const inclusionProof = {
              anchorDate: eventDateStr,
              merkleRoot: tree.rootHex,
              storedMerkleRoot: anchor.merkleRoot,
              rootsMatch: tree.rootHex === anchor.merkleRoot,
              eventCount: tree.leafCount,
              focusEventIndex: focusIdx,
              focusLeaf: dayEvents[focusIdx].eventHash,
              auditPath: tree.proofs[focusIdx],
            };
            archive.append(
              JSON.stringify(inclusionProof, null, 2),
              { name: "merkle-proof.json" },
            );

            // Parse the stored OTS payload (JSON of base64 proofs from
            // each calendar) and emit one .ots binary per calendar plus
            // a sidecar manifest.
            try {
              const parsed = JSON.parse(anchor.otsProof);
              const calendars: Array<{ label: string; url: string; proofB64: string }> =
                parsed?.calendars ?? [];
              const manifest: any[] = [];
              calendars.forEach((c, i) => {
                const proofBytes = Buffer.from(c.proofB64, "base64");
                const name = `bitcoin-anchor-${c.label || `cal${i + 1}`}.ots`;
                archive.append(proofBytes, { name });
                manifest.push({ calendar: c.label, url: c.url, file: name });
              });
              archive.append(JSON.stringify({
                merkleRoot: anchor.merkleRoot,
                anchorDate: eventDateStr,
                calendars: manifest,
                note: "Each .ots file is an independent OpenTimestamps proof for the same Merkle root. Use `ots verify` after Bitcoin confirms the timestamp.",
              }, null, 2), { name: "bitcoin-anchor-details.json" });
            } catch (e: any) {
              console.warn("[proof-package] could not parse stored OTS payload:", e?.message || e);
            }
          }
        }
      }

      // 3c. Proof of Human Conception .docx — the inventor's private
      // inventorship record (AI Helper captures + every typed verbatim).
      // Bundled here so this single zip is the complete "evidence packet"
      // the inventor downloads from the Showcase page.
      try {
        const pohc = await buildPoHCDocx(projectId);
        if (pohc) {
          archive.append(pohc.buffer, { name: "proof-of-human-conception.docx" });
        }
      } catch (e: any) {
        console.warn("[proof-package] PoHC docx build failed (continuing):", e?.message || e);
      }

      // 4. Human-readable verification instructions. Deliberately conservative
      //    wording — describes evidence, never ownership.
      const instructions = `Patent Geyser — Proof Package verification instructions
=========================================================

What this package proves
------------------------
This package creates third-party cryptographic evidence that the specific
invention disclosure bytes in canonical-disclosure.json existed at or before
the times signed by the listed RFC 3161 Time Stamp Authorities, and have
not been altered since. It does not prove ownership of the invention and
does not replace filing a patent application.

Files in this package
---------------------
canonical-disclosure.json    The exact bytes that were hashed.
sha256.txt                   SHA-256 hex of canonical-disclosure.json.
timestamp-response-N.tsr     One RFC 3161 TimeStampToken per TSA (binary).
tsa-certificates.pem         TSA cert chains (concatenated PEM).
tsa-provider-details.json    URLs and stamp metadata per TSA.
event-chain.json             Full append-only hash chain for the project.
proof-of-human-conception.docx
                             Private inventorship record — every captured
                             verbatim. Marked "DO NOT UPLOAD WITH PATENT".
merkle-proof.json            (Optional) Inclusion path tying this event's
                             hash to the Merkle root anchored on Bitcoin.
bitcoin-anchor-*.ots         (Optional) OpenTimestamps proofs of that
                             Merkle root — one per calendar.
bitcoin-anchor-details.json  (Optional) Calendar manifest.

How to verify (OpenSSL >= 1.1)
------------------------------
1. Recompute the disclosure hash and compare to sha256.txt:
       openssl dgst -sha256 canonical-disclosure.json

2. Verify each TSA token signs that same hash. For each timestamp-response-N.tsr:
       openssl ts -verify \\
         -in timestamp-response-N.tsr \\
         -data canonical-disclosure.json \\
         -CAfile tsa-certificates.pem
   Expected output: "Verification: OK"

3. Read the signed time inside each token:
       openssl ts -reply -in timestamp-response-N.tsr -text

4. Confirm chain integrity. For each event in event-chain.json, recompute
       event_hash = sha256(prev_hash || payload_hash || event_type || created_at_iso)
   and confirm it matches the stored event_hash. Any mismatch indicates the
   chain has been tampered with after the fact.

Multiple TSA tokens
-------------------
This package may contain timestamp tokens from more than one independent
Time Stamp Authority. Each token is independently verifiable. Two or more
matching signed times from independent TSAs is materially stronger evidence
than a single TSA.

Bitcoin anchor (long-term verification)
---------------------------------------
If the package contains bitcoin-anchor-*.ots files, the Merkle root in
merkle-proof.json was committed to the Bitcoin blockchain via the
OpenTimestamps protocol. Verify with the "ots" CLI
(https://github.com/opentimestamps/opentimestamps-client):

    ots verify bitcoin-anchor-alice.ots
    ots verify bitcoin-anchor-bob.ots

Then confirm the event's inclusion in the anchored root by walking the
audit path in merkle-proof.json. Bitcoin anchoring may take several hours
to several days to fully confirm; until then "ots upgrade" will fetch the
upgraded proof from the calendar.

Generated by Patent Geyser.
`;
      archive.append(instructions, { name: "verification-instructions.txt" });

      // Record the proof-package export as its own checkpoint so the
      // download itself is part of the chain.
      createCheckpointBackground({
        projectId,
        eventType: "export_proof_package",
        refTable: "provenance_events",
        refId: event.id,
        payload: {
          focusEventId: event.id,
          tsaStampCount: eventStamps.length,
          at: new Date().toISOString(),
        },
      });

      await archive.finalize();
  }

  // Export DOCX
  app.get("/api/projects/:id/export-docx", isAuthenticated, async (req, res) => {
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Footer, PageNumber } = await import('docx');
      const { marked } = await import('marked');
      const project = await storage.getProject(req.params.id);
      const agent4cData = await storage.getAgentData(req.params.id, 4);
      const agent5DataForDocx = await storage.getAgentData(req.params.id, 5);

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Edits made via /update-specification-section land in agent 5.
      // Prefer that draft so DOCX exports reflect user edits; fall back to
      // agent 4's draft if no edits have been saved yet.
      const editedDraft = (agent5DataForDocx?.data as any)?.provisionalDraft;
      const originalDraft = (agent4cData?.data as any)?.provisionalDraft;
      const rawDraft = editedDraft || originalDraft || {};

      if (!editedDraft && !originalDraft) {
        return res.status(404).json({ message: "Draft not found" });
      }

      const parsedDraft = parseProvisionalDraft(rawDraft);
      
      // Fix claim references and convert escaped Unicode for DOCX
      const processTextForDocx = (text: string | undefined | null): string => {
        if (!text) return '';
        // Convert escaped Unicode sequences (like \u00b1) to actual characters
        let processed = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => {
          return String.fromCharCode(parseInt(code, 16));
        });
        
        // Remove markdown tables (rows of dashes and pipes)
        processed = processed
          .replace(/\|[^|]*\|/g, '') // Remove pipe-delimited table cells
          .replace(/^\s*\|.*\|.*$/gm, '') // Remove lines that look like table rows
          .replace(/^[-:|]+$/gm, '') // Remove table separator lines (---|---|---)
          .replace(/-{5,}/g, '') // Remove long sequences of dashes (5 or more)
          .replace(/## \d+\.\s*Support Map.*$/gm, '') // Remove "## 2. Support Map" headings
          .replace(/Claim Limitation.*Reference Numerals.*$/gm, '') // Remove table headers
          .replace(/Supporting Specification Excerpt.*$/gm, '') // Remove table header fragments
          .replace(/\n{3,}/g, '\n\n'); // Collapse multiple blank lines
        
        return processed.trim();
      };
      
      // Check if user has selected broad claims
      const agent5DocxObj = agent5DataForDocx?.data as any;
      const selectedClaimType = agent5DocxObj?.selectedClaimType || 'specific';
      
      // Prefer edits the user saved via /update-specification-section (which
      // land in parsedDraft.claims). Only fall back to broad/specific
      // auto-derivation when no edits exist.
      let claimsToUse: any[] = [];
      const savedEditedClaims = Array.isArray(parsedDraft.claims) && parsedDraft.claims.length > 0
        ? parsedDraft.claims
        : null;
      if (savedEditedClaims) {
        claimsToUse = savedEditedClaims;
      } else if (selectedClaimType === 'broad' && agent5DocxObj?.broadKeyConcepts) {
        claimsToUse = extractClaimsFromBroadData(agent5DocxObj.broadKeyConcepts);
        if (!claimsToUse || claimsToUse.length === 0) {
          claimsToUse = parsedDraft.claims || [];
        }
      } else {
        claimsToUse = parsedDraft.claims || [];
      }
      
      const processedClaims = Array.isArray(claimsToUse) 
        ? claimsToUse.map((c: any) => {
            const rawText = typeof c === 'string' ? c : c.text || JSON.stringify(c);
            return cleanClaimFormatting(processTextForDocx(rawText));
          })
        : [];
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
      
      // Helper to preprocess markdown text
      const preprocessMarkdown = (text: string): string => {
        if (!text) return '';
        return text
          .replace(/\[SECTION:\s*([^\]]+)\]/g, '\n\n## $1\n\n')
          .replace(/([.!?)])(\d+)\.\s+/g, '$1\n\n$2. ')
          .replace(/([.!?)])(\*\*[A-Z])/g, '$1\n\n$2')
          .replace(/\n{3,}/g, '\n\n');
      };
      
      // Helper to convert inline markdown tokens to TextRun array
      const tokensToTextRuns = (inlineTokens: any[]): any[] => {
        const runs: any[] = [];
        
        inlineTokens.forEach((token: any) => {
          if (token.type === 'strong') {
            const text = token.tokens ? 
              token.tokens.map((t: any) => t.text || t.raw || '').join('') : 
              (token.text || '');
            if (text.trim()) {
              runs.push(new TextRun({ text: text, bold: true }));
            }
          } else if (token.type === 'em') {
            const text = token.tokens ? 
              token.tokens.map((t: any) => t.text || t.raw || '').join('') : 
              (token.text || '');
            if (text.trim()) {
              runs.push(new TextRun({ text: text, italics: true }));
            }
          } else if (token.type === 'text' || token.type === 'codespan') {
            const text = (token.text || token.raw || '').replace(/\*\*/g, '');
            if (text) {
              runs.push(new TextRun({ text: text }));
            }
          } else if (token.tokens && Array.isArray(token.tokens)) {
            runs.push(...tokensToTextRuns(token.tokens));
          } else if (token.raw) {
            const text = token.raw.replace(/\*\*/g, '');
            if (text.trim()) {
              runs.push(new TextRun({ text: text }));
            }
          }
        });
        
        return runs;
      };
      
      // Standard font size for body text (12pt = 24 half-points)
      const bodyFontSize = 24;
      // Line spacing: 1.2 = 288 (240 * 1.2) in twips
      const lineSpacing = 288;
      
      // Helper to convert inline markdown tokens to TextRun array with consistent font size
      const tokensToTextRunsWithSize = (inlineTokens: any[], fontSize: number = bodyFontSize): any[] => {
        const runs: any[] = [];
        
        inlineTokens.forEach((token: any) => {
          if (token.type === 'strong') {
            const text = token.tokens ? 
              token.tokens.map((t: any) => t.text || t.raw || '').join('') : 
              (token.text || '');
            if (text.trim()) {
              runs.push(new TextRun({ text: text, bold: true, size: fontSize }));
            }
          } else if (token.type === 'em') {
            const text = token.tokens ? 
              token.tokens.map((t: any) => t.text || t.raw || '').join('') : 
              (token.text || '');
            if (text.trim()) {
              runs.push(new TextRun({ text: text, italics: true, size: fontSize }));
            }
          } else if (token.type === 'text' || token.type === 'codespan') {
            const text = (token.text || token.raw || '').replace(/\*\*/g, '');
            if (text) {
              runs.push(new TextRun({ text: text, size: fontSize }));
            }
          } else if (token.tokens && Array.isArray(token.tokens)) {
            runs.push(...tokensToTextRunsWithSize(token.tokens, fontSize));
          } else if (token.raw) {
            const text = token.raw.replace(/\*\*/g, '');
            if (text.trim()) {
              runs.push(new TextRun({ text: text, size: fontSize }));
            }
          }
        });
        
        return runs;
      };
      
      // USPTO paragraph counter for [0001], [0002], etc.
      let usptoParaCounter = 1;
      
      // Format paragraph number as [0001]
      const formatParaNumber = (): string => {
        const num = usptoParaCounter++;
        return `[${num.toString().padStart(4, '0')}] `;
      };
      
      // Helper to convert markdown text to DOCX paragraphs with USPTO numbering
      const markdownToParagraphs = (text: string, afterSpacing: number = 240, addNumbering: boolean = true): any[] => {
        const paras: any[] = [];
        const preprocessed = preprocessMarkdown(text);
        const tokens = marked.lexer(preprocessed);
        
        tokens.forEach((token: any) => {
          if (token.type === 'heading') {
            // Sub-headings: 13pt bold - no paragraph number for headings
            const headingSize = 26; // 13pt in half-points
            paras.push(new Paragraph({
              children: token.tokens ? 
                tokensToTextRunsWithSize(token.tokens, headingSize).map((r: any) => {
                  r.bold = true;
                  return r;
                }) : 
                [new TextRun({ text: token.text || '', bold: true, size: headingSize })],
              spacing: { before: 240, after: 120, line: lineSpacing },
            }));
          } else if (token.type === 'paragraph') {
            const runs: any[] = [];
            // Add USPTO paragraph number at the start
            if (addNumbering) {
              runs.push(new TextRun({ text: formatParaNumber(), size: bodyFontSize }));
            }
            const contentRuns = token.tokens ? tokensToTextRunsWithSize(token.tokens, bodyFontSize) : [new TextRun({ text: token.text || '', size: bodyFontSize })];
            runs.push(...contentRuns);
            if (runs.length > 0) {
              paras.push(new Paragraph({
                children: runs,
                spacing: { after: afterSpacing, line: lineSpacing },
              }));
            }
          } else if (token.type === 'list') {
            token.items.forEach((item: any, itemIdx: number) => {
              const prefix = token.ordered ? `${token.start + itemIdx}. ` : '• ';
              const itemRuns: any[] = [];
              // Add paragraph number for list items too
              if (addNumbering) {
                itemRuns.push(new TextRun({ text: formatParaNumber(), size: bodyFontSize }));
              }
              itemRuns.push(new TextRun({ text: prefix, size: bodyFontSize }));
              
              if (item.tokens) {
                const firstPara = item.tokens.find((t: any) => t.type === 'text' || t.type === 'paragraph');
                if (firstPara && firstPara.tokens) {
                  itemRuns.push(...tokensToTextRunsWithSize(firstPara.tokens, bodyFontSize));
                } else if (firstPara) {
                  itemRuns.push(new TextRun({ text: firstPara.text || '', size: bodyFontSize }));
                }
              } else if (item.text) {
                itemRuns.push(new TextRun({ text: item.text, size: bodyFontSize }));
              }
              
              paras.push(new Paragraph({
                children: itemRuns,
                spacing: { after: 120, line: lineSpacing },
                indent: { left: 360 },
              }));
            });
          } else if (token.type === 'space') {
            // Skip - just adds spacing between blocks
          } else if (token.raw && token.raw.trim()) {
            // Fallback for unrecognized tokens - add numbering
            const runs: any[] = [];
            if (addNumbering) {
              runs.push(new TextRun({ text: formatParaNumber(), size: bodyFontSize }));
            }
            runs.push(new TextRun({ text: token.raw.replace(/\*\*/g, '').trim(), size: bodyFontSize }));
            paras.push(new Paragraph({
              children: runs,
              spacing: { after: afterSpacing, line: lineSpacing },
            }));
          }
        });
        
        return paras;
      };
      
      const paragraphs: any[] = [];
      
      // Fetch diagrams early to check if we need BRIEF DESCRIPTION OF THE DRAWINGS
      const { ImageRun, PageBreak } = await import('docx');
      const agent5Data = await storage.getAgentData(req.params.id, 5);
      const diagrams = (agent5Data?.data as any)?.diagrams || [];
      // Filter for diagrams with imageUrl - success property may not always be present
      const successfulDiagrams = diagrams.filter((d: any) => d.imageUrl && (d.success !== false));

      // Title
      paragraphs.push(
        new Paragraph({
          text: draft.title || 'Provisional Patent Application',
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
        })
      );

      // Background
      if (draft.background) {
        paragraphs.push(
          new Paragraph({
            text: 'BACKGROUND',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing },
          }),
          ...markdownToParagraphs(draft.background, 240)
        );
      }

      // Summary
      if (draft.summary) {
        paragraphs.push(
          new Paragraph({
            text: 'SUMMARY OF THE INVENTION',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing },
          }),
          ...markdownToParagraphs(draft.summary, 240)
        );
      }

      // Brief Description of the Drawings - required by USPTO when figures are present
      if (successfulDiagrams.length > 0) {
        paragraphs.push(
          new Paragraph({
            text: 'BRIEF DESCRIPTION OF THE DRAWINGS',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing },
          })
        );
        
        // Add paragraph introducing the drawings
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: formatParaNumber(), size: bodyFontSize }),
              new TextRun({ 
                text: 'The accompanying drawings, which are incorporated in and form a part of this specification, illustrate embodiments of the invention and, together with the description, serve to explain the principles of the invention.', 
                size: bodyFontSize 
              })
            ],
            spacing: { after: 240, line: lineSpacing },
          })
        );
        
        // Add a description for each figure
        successfulDiagrams.forEach((diagram: any, i: number) => {
          const figNum = diagram.chartNumber || (i + 1);
          const figTitle = diagram.title || `Figure ${figNum}`;
          // Generate a brief description based on the diagram title/type
          let description = '';
          if (diagram.chartType) {
            const chartTypeDescriptions: Record<string, string> = {
              'flowchart': 'is a flowchart illustrating',
              'sequence-diagram': 'is a sequence diagram showing',
              'entity-relationship-diagram': 'is an entity-relationship diagram depicting',
              'cloud-architecture-diagram': 'is a cloud architecture diagram showing'
            };
            description = chartTypeDescriptions[diagram.chartType] || 'illustrates';
          } else {
            description = 'illustrates';
          }
          
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: formatParaNumber(), size: bodyFontSize }),
                new TextRun({ text: `FIG. ${figNum} `, bold: true, size: bodyFontSize }),
                new TextRun({ text: `${description} ${figTitle.toLowerCase()}, in accordance with an embodiment of the present invention.`, size: bodyFontSize })
              ],
              spacing: { after: 240, line: lineSpacing },
            })
          );
        });
        
        // Helper to get PNG dimensions from buffer
        const getPngDimensions = (buffer: Buffer): { width: number; height: number } | null => {
          try {
            if (buffer.length < 24) return null;
            const width = buffer.readUInt32BE(16);
            const height = buffer.readUInt32BE(20);
            return { width, height };
          } catch {
            return null;
          }
        };
        
        // Add actual figure images immediately after the descriptions (each on its own page)
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
                children: [new PageBreak()],
              }),
              new Paragraph({
                children: [new TextRun({ 
                  text: `Figure ${diagram.chartNumber || i + 1}: ${diagramTitle}`, 
                  bold: true, 
                  size: 28
                })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400, line: lineSpacing },
              }),
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imageBuffer,
                    transformation: { width: imgWidth, height: imgHeight },
                    type: 'png',
                  })
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
              })
            );
          } catch (imgError) {
            console.error(`Failed to add diagram ${i + 1} to DOCX:`, imgError);
          }
        }
      }

      // Detailed Description - starts on new page after drawings
      if (draft.detailed_description) {
        paragraphs.push(
          new Paragraph({
            children: [new PageBreak()],
          }),
          new Paragraph({
            text: 'DETAILED DESCRIPTION',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing },
          }),
          ...markdownToParagraphs(draft.detailed_description, 240)
        );
      }

      // Ramifications and Scope
      if (draft.ramifications_and_scope) {
        paragraphs.push(
          new Paragraph({
            text: 'RAMIFICATIONS AND SCOPE',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing },
          }),
          ...markdownToParagraphs(draft.ramifications_and_scope, 240)
        );
      }

      // Key Concepts — prefer the user's edits saved via
      // /update-specification-section (which land in parsedDraft.claims /
      // parsedDraft.keyConcepts). If no edits exist, render the original
      // grouped Agent 4 selections.
      const editedKeyConcepts =
        (Array.isArray((parsedDraft as any).keyConcepts) && (parsedDraft as any).keyConcepts.length > 0
          ? (parsedDraft as any).keyConcepts
          : null) ||
        (Array.isArray(parsedDraft.claims) && parsedDraft.claims.length > 0 && typeof parsedDraft.claims[0] === 'string'
          ? parsedDraft.claims
          : null);

      if (editedKeyConcepts) {
        paragraphs.push(
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({
            text: 'KEY CONCEPTS',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing },
          })
        );
        let kcIndexDocx = 1;
        editedKeyConcepts.forEach((entry: any) => {
          // Handle both string entries (G&S-expanded array) and object entries
          // ({ text: "..." }) just in case the data shape varies by project.
          const raw = typeof entry === "string"
            ? entry
            : (entry && typeof entry === "object" && typeof entry.text === "string" ? entry.text : "");
          const cleaned = processTextForDocx(String(raw || '')).trim();
          if (!cleaned) return;
          // Strip any pre-existing "N." / "N)" prefix so we don't double-number
          // entries that were already numbered upstream.
          const stripped = cleaned.replace(/^\s*\d+\s*[.):\-]\s*/, "");
          paragraphs.push(
            new Paragraph({
              children: [
                // BOTH are mandatory: the USPTO paragraph number [00NN] (so
                // numbering continues from the rest of the document) and the
                // "Key Concept N: " label (so the inventor can see exactly
                // which concept they're reading).
                new TextRun({ text: formatParaNumber(), size: bodyFontSize }),
                new TextRun({ text: `Key Concept ${kcIndexDocx}: ${stripped}`, size: bodyFontSize }),
              ],
              spacing: { after: 240, line: lineSpacing },
            })
          );
          kcIndexDocx++;
        });
      } else {
        const selectedKeyConceptsDocx = (agent4cData?.data as any)?.selectedKeyConcepts || (agent4cData?.data as any)?.selectedClaims || [];
        if (Array.isArray(selectedKeyConceptsDocx) && selectedKeyConceptsDocx.length > 0) {
          paragraphs.push(
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph({
              text: 'KEY CONCEPTS',
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 400, after: 240, line: lineSpacing },
            })
          );

          const groupedByVariationDocx: Record<string, any[]> = {};
          selectedKeyConceptsDocx.forEach((concept: any) => {
            const variationId = concept.variationId || 'default';
            if (!groupedByVariationDocx[variationId]) {
              groupedByVariationDocx[variationId] = [];
            }
            groupedByVariationDocx[variationId].push(concept);
          });

          // Flat continuous numbering across all groups so the Key Concepts
          // read as "1.", "2.", "3." like every other numbered paragraph in
          // the document, rather than "Key Concept 1:" within each group.
          let flatIndex = 1;
          Object.keys(groupedByVariationDocx).forEach((variationId) => {
            const groupConcepts = groupedByVariationDocx[variationId];
            groupConcepts.forEach((concept: any) => {
              const raw = typeof concept === "string"
                ? concept
                : (concept && typeof concept === "object" && typeof concept.text === "string" ? concept.text : "");
              const cleanedText = processTextForDocx(String(raw || '')).trim();
              if (!cleanedText) return;
              const stripped = cleanedText.replace(/^\s*\d+\s*[.):\-]\s*/, "");
              paragraphs.push(
                new Paragraph({
                  children: [new TextRun({ text: `${flatIndex}. ${stripped}`, size: bodyFontSize })],
                  spacing: { after: 240, line: lineSpacing },
                })
              );
              flatIndex++;
            });
          });
        }
      }

      // Abstract - MUST be the absolute final section with zero images after it
      if (draft.abstract) {
        paragraphs.push(
          new Paragraph({
            children: [new PageBreak()],
          }),
          new Paragraph({
            text: 'ABSTRACT',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 240, line: lineSpacing },
          }),
          ...markdownToParagraphs(draft.abstract, 240)
        );
      }

      const doc = new Document({
        sections: [{
          properties: {},
          // Page X of Y in the footer of every page.
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: "Page ", size: 20 }),
                    new TextRun({ children: [PageNumber.CURRENT], size: 20 }),
                    new TextRun({ text: " of ", size: 20 }),
                    new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 20 }),
                  ],
                }),
              ],
            }),
          },
          children: paragraphs,
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename=patent-${project.title || req.params.id}.docx`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Export DOCX error:", error);
      res.status(500).json({ message: "Failed to export DOCX" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
