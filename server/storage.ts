// Storage layer implementation using DatabaseStorage as per javascript_database blueprint
import { users, inventorsUsers, projects, agentData, pannuRecords, ideaSnapshots, priorArtSearches, emailWhitelist, type User, type InsertUser, type InventorUser, type InsertInventorUser, type Project, type InsertProject, type AgentData, type InsertAgentData, type PannuRecord, type InsertPannuRecord, type IdeaSnapshot, type InsertIdeaSnapshot, type PriorArtSearch, type InsertPriorArtSearch, type EmailWhitelistEntry } from "@shared/schema";
import { db, pool } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";

// 2FA update data type
export interface Update2FAData {
  twoFactorEnabled?: boolean;
  twoFactorMethod?: string | null;
  totpSecret?: string | null;
  pendingTwoFactorCode?: string | null;
  pendingTwoFactorExpiry?: Date | null;
  twoFactorVerifiedAt?: Date | null;
}

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser2FA(userId: string, data: Update2FAData): Promise<User | undefined>;
  updateUserPassword(userId: string, hashedPassword: string): Promise<User | undefined>;

  // Inventor user operations
  getInventorUser(id: string): Promise<InventorUser | undefined>;
  getInventorUserByEmail(email: string): Promise<InventorUser | undefined>;
  createInventorUser(user: InsertInventorUser): Promise<InventorUser>;
  updateInventorUser2FA(userId: string, data: Update2FAData): Promise<InventorUser | undefined>;
  updateInventorUserPassword(userId: string, hashedPassword: string): Promise<InventorUser | undefined>;
  setInventorUserProjectLimit(userId: string, projectLimit: number): Promise<InventorUser | undefined>;
  incrementInventorUserProjectLimit(userId: string, delta: number): Promise<InventorUser | undefined>;
  updateInventorUserLastLogin(userId: string): Promise<void>;
  getInventorUsersAdminView(): Promise<Array<{
    id: string;
    email: string;
    projectLimit: number;
    projectCount: number;
    twoFactorEnabled: boolean;
    lastLoginAt: string | null;
    createdAt: string | null;
  }>>;

  // Project operations
  getProject(id: string): Promise<Project | undefined>;
  getProjectsByUserId(userId: string): Promise<Project[]>;
  getProjectsByOwner(owner: { kind: "legacy"; userId: string } | { kind: "paid"; inventorsUserId: string }): Promise<Project[]>;
  countProjectsByInventorUserId(inventorsUserId: string): Promise<number>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;
  
  // Agent data operations
  getAgentData(projectId: string, agentNumber: number): Promise<AgentData | undefined>;
  upsertAgentData(data: InsertAgentData): Promise<AgentData>;
  mergeAgentData(projectId: string, agentNumber: number, partialData: Record<string, any>): Promise<AgentData>;
  deleteAgentData(projectId: string, agentNumber: number): Promise<void>;
  getAllAgentDataForProject(projectId: string): Promise<AgentData[]>;
  
  // Pannu record operations
  getPannuRecords(projectId: string): Promise<PannuRecord[]>;
  getPannuRecord(projectId: string, conceptId: string): Promise<PannuRecord | undefined>;
  createPannuRecord(record: InsertPannuRecord): Promise<PannuRecord>;
  updatePannuRecord(id: string, data: Partial<InsertPannuRecord>): Promise<PannuRecord | undefined>;
  
  // Idea snapshot operations
  getIdeaSnapshots(projectId: string): Promise<IdeaSnapshot[]>;
  getLatestIdeaSnapshot(projectId: string): Promise<IdeaSnapshot | undefined>;
  createIdeaSnapshot(snapshot: InsertIdeaSnapshot): Promise<IdeaSnapshot>;
  getNextSnapshotVersion(projectId: string): Promise<number>;
  
  // Prior art search operations
  getPriorArtSearches(owner: { kind: "legacy" | "paid"; userId: string }): Promise<PriorArtSearch[]>;
  createPriorArtSearch(search: InsertPriorArtSearch): Promise<PriorArtSearch>;
  deletePriorArtSearch(id: string): Promise<void>;

  // Email whitelist operations
  isEmailWhitelisted(email: string): Promise<boolean>;
  getWhitelistEntry(email: string): Promise<EmailWhitelistEntry | undefined>;
  getWhitelistedEmails(): Promise<EmailWhitelistEntry[]>;
  addEmailToWhitelist(email: string, note?: string): Promise<EmailWhitelistEntry>;
  removeEmailFromWhitelist(email: string): Promise<void>;
  updateWhitelistStatus(email: string, status: string): Promise<EmailWhitelistEntry>;

  // Admin user overview
  getAdminUsers(): Promise<Array<{
    id: string;
    email: string;
    twoFactorEnabled: boolean;
    subscriptionStatus: string | null;
    note: string | null;
    projectCount: number;
    lastLoginAt: string | null;
    createdAt: string | null;
  }>>;
  updateLastLogin(userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async updateUser2FA(userId: string, data: Update2FAData): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user || undefined;
  }

  async updateUserPassword(userId: string, hashedPassword: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user || undefined;
  }

  // Inventor user operations
  async getInventorUser(id: string): Promise<InventorUser | undefined> {
    const [user] = await db.select().from(inventorsUsers).where(eq(inventorsUsers.id, id));
    return user || undefined;
  }

  async getInventorUserByEmail(email: string): Promise<InventorUser | undefined> {
    const normalized = email.toLowerCase().trim();
    const [user] = await db.select().from(inventorsUsers).where(eq(inventorsUsers.email, normalized));
    return user || undefined;
  }

  async createInventorUser(insert: InsertInventorUser): Promise<InventorUser> {
    const [user] = await db
      .insert(inventorsUsers)
      .values({ ...insert, email: insert.email.toLowerCase().trim() })
      .returning();
    return user;
  }

  async updateInventorUser2FA(userId: string, data: Update2FAData): Promise<InventorUser | undefined> {
    const [user] = await db
      .update(inventorsUsers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(inventorsUsers.id, userId))
      .returning();
    return user || undefined;
  }

  async updateInventorUserPassword(userId: string, hashedPassword: string): Promise<InventorUser | undefined> {
    const [user] = await db
      .update(inventorsUsers)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(inventorsUsers.id, userId))
      .returning();
    return user || undefined;
  }

  async setInventorUserProjectLimit(userId: string, projectLimit: number): Promise<InventorUser | undefined> {
    const [user] = await db
      .update(inventorsUsers)
      .set({ projectLimit, updatedAt: new Date() })
      .where(eq(inventorsUsers.id, userId))
      .returning();
    return user || undefined;
  }

  async incrementInventorUserProjectLimit(userId: string, delta: number): Promise<InventorUser | undefined> {
    const [user] = await db
      .update(inventorsUsers)
      .set({ projectLimit: sql`${inventorsUsers.projectLimit} + ${delta}`, updatedAt: new Date() })
      .where(eq(inventorsUsers.id, userId))
      .returning();
    return user || undefined;
  }

  async updateInventorUserLastLogin(userId: string): Promise<void> {
    await db.update(inventorsUsers).set({ lastLoginAt: new Date() }).where(eq(inventorsUsers.id, userId));
  }

  async getInventorUsersAdminView(): Promise<Array<{
    id: string;
    email: string;
    projectLimit: number;
    projectCount: number;
    twoFactorEnabled: boolean;
    lastLoginAt: string | null;
    createdAt: string | null;
  }>> {
    const result = await pool.query(`
      SELECT
        pu.id,
        pu.email,
        pu.project_limit AS "projectLimit",
        pu.two_factor_enabled AS "twoFactorEnabled",
        COUNT(p.id)::int AS "projectCount",
        pu.last_login_at AS "lastLoginAt",
        pu.created_at AS "createdAt"
      FROM inventor_geyser.inventors_users pu
      LEFT JOIN inventor_geyser.projects p ON p.inventors_user_id = pu.id
      GROUP BY pu.id, pu.email, pu.project_limit, pu.two_factor_enabled, pu.last_login_at, pu.created_at
      ORDER BY pu.created_at DESC NULLS LAST
    `);
    return result.rows;
  }

  // Project operations
  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project || undefined;
  }

  async getProjectsByUserId(userId: string): Promise<Project[]> {
    return await db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt));
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await db
      .insert(projects)
      .values(insertProject)
      .returning();
    return project;
  }

  async getProjectsByOwner(
    owner: { kind: "legacy"; userId: string } | { kind: "paid"; inventorsUserId: string }
  ): Promise<Project[]> {
    if (owner.kind === "legacy") {
      return await db
        .select()
        .from(projects)
        .where(eq(projects.userId, owner.userId))
        .orderBy(desc(projects.updatedAt));
    }
    return await db
      .select()
      .from(projects)
      .where(eq(projects.inventorsUserId, owner.inventorsUserId))
      .orderBy(desc(projects.updatedAt));
  }

  async countProjectsByInventorUserId(inventorsUserId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(eq(projects.inventorsUserId, inventorsUserId));
    return row?.count ?? 0;
  }

  async updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined> {
    const [project] = await db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return project || undefined;
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  // Agent data operations
  async getAgentData(projectId: string, agentNumber: number): Promise<AgentData | undefined> {
    const [data] = await db
      .select()
      .from(agentData)
      .where(and(eq(agentData.projectId, projectId), eq(agentData.agentNumber, agentNumber)))
      .orderBy(desc(agentData.createdAt));
    return data || undefined;
  }

  async upsertAgentData(insertData: InsertAgentData): Promise<AgentData> {
    const existing = await this.getAgentData(insertData.projectId, insertData.agentNumber);
    
    if (existing) {
      const [updated] = await db
        .update(agentData)
        .set({ data: insertData.data, updatedAt: new Date() })
        .where(eq(agentData.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(agentData)
        .values(insertData)
        .returning();
      return created;
    }
  }

  async mergeAgentData(projectId: string, agentNumber: number, partialData: Record<string, any>): Promise<AgentData> {
    const existing = await this.getAgentData(projectId, agentNumber);
    
    if (existing) {
      const [updated] = await db
        .update(agentData)
        .set({ 
          data: sql`${agentData.data} || ${JSON.stringify(partialData)}::jsonb`,
          updatedAt: new Date() 
        })
        .where(eq(agentData.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(agentData)
        .values({ projectId, agentNumber, data: partialData })
        .returning();
      return created;
    }
  }

  async deleteAgentData(projectId: string, agentNumber: number): Promise<void> {
    await db
      .delete(agentData)
      .where(and(eq(agentData.projectId, projectId), eq(agentData.agentNumber, agentNumber)));
  }

  async getAllAgentDataForProject(projectId: string): Promise<AgentData[]> {
    return await db
      .select()
      .from(agentData)
      .where(eq(agentData.projectId, projectId))
      .orderBy(agentData.agentNumber);
  }

  // Pannu record operations
  async getPannuRecords(projectId: string): Promise<PannuRecord[]> {
    return await db
      .select()
      .from(pannuRecords)
      .where(eq(pannuRecords.projectId, projectId))
      .orderBy(desc(pannuRecords.createdAt));
  }

  async getPannuRecord(projectId: string, conceptId: string): Promise<PannuRecord | undefined> {
    const [record] = await db
      .select()
      .from(pannuRecords)
      .where(and(eq(pannuRecords.projectId, projectId), eq(pannuRecords.conceptId, conceptId)));
    return record || undefined;
  }

  async createPannuRecord(insertRecord: InsertPannuRecord): Promise<PannuRecord> {
    const [record] = await db
      .insert(pannuRecords)
      .values(insertRecord)
      .returning();
    return record;
  }

  async updatePannuRecord(id: string, data: Partial<InsertPannuRecord>): Promise<PannuRecord | undefined> {
    const [record] = await db
      .update(pannuRecords)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(pannuRecords.id, id))
      .returning();
    return record || undefined;
  }

  // Idea snapshot operations
  async getIdeaSnapshots(projectId: string): Promise<IdeaSnapshot[]> {
    return await db
      .select()
      .from(ideaSnapshots)
      .where(eq(ideaSnapshots.projectId, projectId))
      .orderBy(ideaSnapshots.version);
  }

  async getLatestIdeaSnapshot(projectId: string): Promise<IdeaSnapshot | undefined> {
    const [snapshot] = await db
      .select()
      .from(ideaSnapshots)
      .where(eq(ideaSnapshots.projectId, projectId))
      .orderBy(desc(ideaSnapshots.version))
      .limit(1);
    return snapshot || undefined;
  }

  async createIdeaSnapshot(insertSnapshot: InsertIdeaSnapshot): Promise<IdeaSnapshot> {
    const [snapshot] = await db
      .insert(ideaSnapshots)
      .values(insertSnapshot)
      .returning();
    return snapshot;
  }

  async getNextSnapshotVersion(projectId: string): Promise<number> {
    const latest = await this.getLatestIdeaSnapshot(projectId);
    return (latest?.version || 0) + 1;
  }

  // Prior art search operations
  async getPriorArtSearches(owner: { kind: "legacy" | "paid"; userId: string }): Promise<PriorArtSearch[]> {
    const col = owner.kind === "paid" ? priorArtSearches.inventorsUserId : priorArtSearches.userId;
    return await db
      .select()
      .from(priorArtSearches)
      .where(eq(col, owner.userId))
      .orderBy(desc(priorArtSearches.createdAt));
  }

  async createPriorArtSearch(insertSearch: InsertPriorArtSearch): Promise<PriorArtSearch> {
    const [search] = await db
      .insert(priorArtSearches)
      .values(insertSearch)
      .returning();
    return search;
  }

  async deletePriorArtSearch(id: string): Promise<void> {
    await db.delete(priorArtSearches).where(eq(priorArtSearches.id, id));
  }

  // Email whitelist operations
  async isEmailWhitelisted(email: string): Promise<boolean> {
    const [entry] = await db.select().from(emailWhitelist).where(eq(emailWhitelist.email, email.toLowerCase().trim()));
    return !!entry;
  }

  async getWhitelistEntry(email: string): Promise<EmailWhitelistEntry | undefined> {
    const [entry] = await db.select().from(emailWhitelist).where(eq(emailWhitelist.email, email.toLowerCase().trim()));
    return entry || undefined;
  }

  async getWhitelistedEmails(): Promise<EmailWhitelistEntry[]> {
    return await db.select().from(emailWhitelist).orderBy(emailWhitelist.addedAt);
  }

  async addEmailToWhitelist(email: string, note?: string): Promise<EmailWhitelistEntry> {
    const [entry] = await db
      .insert(emailWhitelist)
      .values({ email: email.toLowerCase().trim(), note: note || null, status: "active" })
      .returning();
    return entry;
  }

  async removeEmailFromWhitelist(email: string): Promise<void> {
    await db.delete(emailWhitelist).where(eq(emailWhitelist.email, email.toLowerCase().trim()));
  }

  async updateWhitelistStatus(email: string, status: string): Promise<EmailWhitelistEntry> {
    const [entry] = await db
      .update(emailWhitelist)
      .set({ status })
      .where(eq(emailWhitelist.email, email.toLowerCase().trim()))
      .returning();
    if (!entry) throw new Error("Email not found in whitelist");
    return entry;
  }

  async getAdminUsers(): Promise<Array<{
    id: string;
    email: string;
    twoFactorEnabled: boolean;
    subscriptionStatus: string | null;
    note: string | null;
    projectCount: number;
    lastLoginAt: string | null;
    createdAt: string | null;
    projectStages: Array<{ stage: number; substage: string | null }>;
  }>> {
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
      FROM inventor_geyser.users u
      LEFT JOIN inventor_geyser.email_whitelist w ON lower(u.email) = w.email
      LEFT JOIN inventor_geyser.projects p ON p.user_id = u.id
      GROUP BY u.id, u.email, u.two_factor_enabled, w.status, w.note, u.last_login_at, u.created_at
      ORDER BY u.last_login_at DESC NULLS LAST
    `);
    return result.rows;
  }

  async updateLastLogin(userId: string): Promise<void> {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  }
}

export const storage = new DatabaseStorage();
