// Authentication + authorization middleware and the small helpers around it.
//
// This file was carved out of routes.ts so route-domain modules
// (server/routes/auth.ts, server/routes/admin.ts, server/routes/projects.ts,
// etc.) can import a single canonical copy of each middleware rather than
// pulling from the monolith. routes.ts itself also imports from here — the
// definitions only live in one place.
//
// What lives here:
//   - getSession()             session-cookie config (pg-backed store)
//   - isAuthenticated          gate: requires a logged-in session
//   - loadAuthUser / withAuthUser  resolve the session to a typed AuthUser
//   - find*AcrossTables        legacy-vs-paid user-table dispatch
//   - update2FAByKind / updatePasswordByKind  paired writers per kind
//   - sessionOwnsProject       project-ownership check (works for both kinds)
//   - ADMIN_EMAILS + isAdmin   admin gate, sourced from ADMIN_EMAILS env var
//   - isActiveSubscriber       blocks AI/n8n writes for read-only subscribers
//   - SALT_ROUNDS              bcrypt cost factor (auth-only constant)
//
// Anything that's strictly a per-route helper (e.g. registerRequestSchema)
// stays in its route module so this file's surface stays focused on
// "middleware shared by multiple domains".

import type { Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import type { InventorUser, User } from "@shared/schema";
import { pool } from "../db";
import { storage, type Update2FAData } from "../storage";
import { runWithUsageContext } from "../ai/request-context";
import { requireEnv, requireEnvList } from "./env";

export const SALT_ROUNDS = 10;

// Session configuration
export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    pool: pool as any,
    createTableIfMissing: true,
    ttl: sessionTtl,
  });

  return session({
    secret: requireEnv("SESSION_SECRET"),
    store: sessionStore,
    resave: true, // Resave session on each request to keep it alive
    rolling: true, // Reset maxAge on every request - keeps active users logged in
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

// Authentication middleware. Also seeds the per-request usage-attribution
// context so any AI call made during this request gets logged with the
// correct user/project/request identifiers, regardless of how deep the
// call stack runs. Email is best-effort (cached on the session after the
// first lookup to keep the hot path cheap).
export const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  const sess = req.session as any;
  if (!sess?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const projectIdParam = (req.params?.id as string | undefined) ?? null;
  const requestId = (req.headers["x-vercel-id"] as string | undefined) ?? null;

  // Look up email at most once per session, then cache. Skip the lookup
  // entirely if it's already on the session — most requests will hit
  // this fast path.
  const finish = (userEmail: string | null) => {
    runWithUsageContext(
      {
        userId: sess.userId,
        userEmail,
        projectId: projectIdParam,
        requestId,
      },
      () => next(),
    );
  };

  if (sess.userEmail) {
    return finish(sess.userEmail);
  }
  const kind = sess.userKind === "paid" ? "paid" : "legacy";
  (kind === "paid"
    ? storage.getInventorUser(sess.userId)
    : storage.getUser(sess.userId)
  )
    .then((u: any) => {
      if (u?.email) sess.userEmail = u.email;
      finish(u?.email ?? null);
    })
    .catch(() => finish(null));
};

// Phase 1 paid-projects: session may carry a userKind discriminator.
export type UserKind = "legacy" | "paid";

export interface AuthUser {
  id: string;
  email: string;
  kind: UserKind;
}

export async function loadAuthUser(req: Request): Promise<AuthUser | null> {
  const session = req.session as any;
  const userId: string | undefined = session?.userId;
  if (!userId) return null;
  const kind: UserKind = session.userKind === "paid" ? "paid" : "legacy";
  if (kind === "paid") {
    const user = await storage.getInventorUser(userId);
    if (!user) return null;
    return { id: user.id, email: user.email, kind: "paid" };
  }
  const user = await storage.getUser(userId);
  if (!user) return null;
  return { id: user.id, email: user.email, kind: "legacy" };
}

export const withAuthUser = async (req: Request, res: Response, next: NextFunction) => {
  const user = await loadAuthUser(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  (req as any).authUser = user;
  next();
};

// Phase 1 paid-projects: dual-table lookup helpers for auth/2FA/password flows.
// Many endpoints originally only queried the legacy `users` table; we need them
// to transparently work for inventor users in `inventors_users` as well.
export type AuthLookup =
  | { kind: "paid"; record: InventorUser }
  | { kind: "legacy"; record: User };

export async function findUserByEmailAcrossTables(email: string): Promise<AuthLookup | null> {
  const inv = await storage.getInventorUserByEmail(email);
  if (inv) return { kind: "paid", record: inv };
  const leg = await storage.getUserByEmail(email);
  if (leg) return { kind: "legacy", record: leg };
  return null;
}

export async function findUserByIdAcrossTables(
  kind: UserKind,
  userId: string,
): Promise<AuthLookup | null> {
  if (kind === "paid") {
    const inv = await storage.getInventorUser(userId);
    return inv ? { kind: "paid", record: inv } : null;
  }
  const leg = await storage.getUser(userId);
  return leg ? { kind: "legacy", record: leg } : null;
}

export async function update2FAByKind(
  kind: UserKind,
  userId: string,
  data: Update2FAData,
) {
  return kind === "paid"
    ? storage.updateInventorUser2FA(userId, data)
    : storage.updateUser2FA(userId, data);
}

export async function updatePasswordByKind(
  kind: UserKind,
  userId: string,
  hashedPassword: string,
) {
  return kind === "paid"
    ? storage.updateInventorUserPassword(userId, hashedPassword)
    : storage.updateUserPassword(userId, hashedPassword);
}

// Checks that the current session owns the given project, whether they are a
// legacy user (project.userId) or an inventor user (project.inventorsUserId).
export function sessionOwnsProject(
  req: Request,
  project: { userId: string | null; inventorsUserId: string | null },
): boolean {
  const session = req.session as any;
  const sid: string | undefined = session?.userId;
  if (!sid) return false;
  const kind: UserKind = session.userKind === "paid" ? "paid" : "legacy";
  return kind === "paid" ? project.inventorsUserId === sid : project.userId === sid;
}

// Admin access is sourced from the ADMIN_EMAILS env var (comma-separated).
// Required at boot — no source-code fallback, no silent grant if unset. To add
// or rotate an admin, edit the env var only. requireEnvList throws at module
// load if ADMIN_EMAILS is missing or empty, so a misconfigured deploy refuses
// to start instead of silently running with the wrong access set.
export const ADMIN_EMAILS = new Set(
  requireEnvList("ADMIN_EMAILS").map((e) => e.toLowerCase().trim()),
);

export const isAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const userId = (req.session as any)?.userId;
  const userKind = (req.session as any)?.userKind;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const user = userKind === "paid"
    ? await storage.getInventorUser(userId)
    : await storage.getUser(userId);
  if (!user || !ADMIN_EMAILS.has(user.email.toLowerCase().trim())) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
};

// Block AI/n8n actions for read-only (lapsed) subscribers
export const isActiveSubscriber = (req: Request, res: Response, next: NextFunction) => {
  const status = (req.session as any)?.whitelistStatus;
  if (status === "read_only") {
    return res.status(403).json({
      message: "Your subscription has lapsed. Please renew to continue building. You can still view your existing projects.",
      code: "SUBSCRIPTION_LAPSED",
    });
  }
  return next();
};
