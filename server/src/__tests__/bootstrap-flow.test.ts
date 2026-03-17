import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestDb, cleanDb, closeCleanupConnection } from "./helpers/test-db.js";
import type { TestDb } from "./helpers/test-db.js";
import { actorMiddleware } from "../middleware/auth.js";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";
import { agentRoutes } from "../routes/agents.js";
import { userApiKeyRoutes } from "../routes/user-api-keys.js";
import { companyRoutes } from "../routes/companies.js";
import { errorHandler } from "../middleware/index.js";
import {
  authUsers,
  companies,
  companyMemberships,
  instanceUserRoles,
  userApiKeys,
  agents,
} from "@paperclipai/db";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const TEST_USER_ID = "bootstrap-test-user";
const TEST_COMPANY_ID = "00000000-0000-4000-a000-000000000100";
const BOOTSTRAP_PAT = "pclip_deadbeef12345678abcdef0987654321";

/**
 * Integration test for the fresh-instance bootstrap flow.
 *
 * Proves the chicken-and-egg problem is resolved:
 *   user account exists → PAT created → PAT used to hire agent
 *
 * Uses the REAL actorMiddleware (authenticated mode) and boardMutationGuard
 * against an embedded Postgres test database — no mock actors.
 */
describe("Fresh Bootstrap Flow — PAT authentication end-to-end", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = getTestDb();
  });

  afterAll(async () => {
    await closeCleanupConnection();
    await testDb.close();
  });

  beforeEach(async () => {
    await cleanDb();

    // Seed: user exists (created via UI sign-up or `paperclipai onboard`)
    await testDb.db.insert(authUsers).values({
      id: TEST_USER_ID,
      name: "Bootstrap Test User",
      email: "bootstrap@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed: company exists
    await testDb.db.insert(companies).values({
      id: TEST_COMPANY_ID,
      name: "Bootstrap Test Company",
    });

    // Seed: user is company owner
    await testDb.db.insert(companyMemberships).values({
      principalType: "user",
      principalId: TEST_USER_ID,
      companyId: TEST_COMPANY_ID,
      membershipRole: "owner",
      status: "active",
    });

    // Seed: user is instance admin (typical for fresh-instance owner)
    await testDb.db.insert(instanceUserRoles).values({
      userId: TEST_USER_ID,
      role: "instance_admin",
    });

    // Seed: PAT exists (created via `paperclipai auth create-key`)
    await testDb.db.insert(userApiKeys).values({
      userId: TEST_USER_ID,
      name: "bootstrap-key",
      keyPrefix: BOOTSTRAP_PAT.slice(0, 14),
      keyHash: hashToken(BOOTSTRAP_PAT),
    });
  });

  /**
   * Creates an Express app with REAL auth middleware (authenticated mode),
   * boardMutationGuard, and the routes needed for the bootstrap flow.
   */
  function createAuthenticatedApp() {
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(testDb.db, { deploymentMode: "authenticated" }));
    app.use(boardMutationGuard());

    const api = express.Router();
    api.use("/companies", companyRoutes(testDb.db));
    api.use(agentRoutes(testDb.db));
    api.use(userApiKeyRoutes(testDb.db));
    app.use("/api", api);

    app.use(errorHandler);
    return app;
  }

  // ── Core bootstrap flow ─────────────────────────────────────────────

  it("PAT resolves as board actor and can hire an agent", async () => {
    const app = createAuthenticatedApp();

    const res = await request(app)
      .post(`/api/companies/${TEST_COMPANY_ID}/agent-hires`)
      .set("Authorization", `Bearer ${BOOTSTRAP_PAT}`)
      .send({ name: "first-agent", role: "general" });

    expect(res.status).toBe(201);
    expect(res.body.agent).toMatchObject({
      name: "first-agent",
      role: "general",
      companyId: TEST_COMPANY_ID,
    });
    expect(res.body.agent.id).toBeDefined();

    // Verify agent persisted in DB
    const [agentRow] = await testDb.db
      .select()
      .from(agents)
      .where(eq(agents.id, res.body.agent.id));
    expect(agentRow).toBeDefined();
    expect(agentRow.name).toBe("first-agent");
  });

  it("complete bootstrap: create PAT → use new PAT to hire agent → verify", async () => {
    const app = createAuthenticatedApp();

    // Step 1: Use the bootstrap PAT to create a second PAT (simulates `auth create-key`)
    const keyRes = await request(app)
      .post("/api/users/me/api-keys")
      .set("Authorization", `Bearer ${BOOTSTRAP_PAT}`)
      .send({ name: "cli-key" });

    expect(keyRes.status).toBe(201);
    const newPat = keyRes.body.key;
    expect(newPat).toMatch(/^pclip_[a-f0-9]{32}$/);

    // Step 2: Use the NEW PAT to hire an agent
    const hireRes = await request(app)
      .post(`/api/companies/${TEST_COMPANY_ID}/agent-hires`)
      .set("Authorization", `Bearer ${newPat}`)
      .send({
        name: "bootstrap-agent",
        role: "general",
        title: "Integration Test Agent",
      });

    expect(hireRes.status).toBe(201);
    expect(hireRes.body.agent).toMatchObject({
      name: "bootstrap-agent",
      role: "general",
      companyId: TEST_COMPANY_ID,
    });

    // Step 3: Verify the agent is visible via list
    const listRes = await request(app)
      .get(`/api/companies/${TEST_COMPANY_ID}/agents`)
      .set("Authorization", `Bearer ${newPat}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.some((a: { name: string }) => a.name === "bootstrap-agent")).toBe(true);
  });

  // ── Board mutation guard bypass ─────────────────────────────────────

  it("PAT bypasses board mutation guard (no Origin header required)", async () => {
    const app = createAuthenticatedApp();

    // POST without Origin/Referer headers — PAT should still work
    const res = await request(app)
      .post(`/api/companies/${TEST_COMPANY_ID}/agent-hires`)
      .set("Authorization", `Bearer ${BOOTSTRAP_PAT}`)
      .send({ name: "no-origin-agent", role: "general" });

    expect(res.status).toBe(201);
  });

  // ── PAT key management via PAT ──────────────────────────────────────

  it("PAT can create additional PATs", async () => {
    const app = createAuthenticatedApp();

    const res = await request(app)
      .post("/api/users/me/api-keys")
      .set("Authorization", `Bearer ${BOOTSTRAP_PAT}`)
      .send({ name: "second-key" });

    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^pclip_[a-f0-9]{32}$/);
    expect(res.body.name).toBe("second-key");
  });

  it("PAT can list own keys (full key never exposed)", async () => {
    const app = createAuthenticatedApp();

    const res = await request(app)
      .get("/api/users/me/api-keys")
      .set("Authorization", `Bearer ${BOOTSTRAP_PAT}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("bootstrap-key");
    expect(res.body[0].key).toBeUndefined();
    expect(res.body[0].keyHash).toBeUndefined();
  });

  it("PAT can revoke a key", async () => {
    const app = createAuthenticatedApp();

    // Create a key to revoke
    const createRes = await request(app)
      .post("/api/users/me/api-keys")
      .set("Authorization", `Bearer ${BOOTSTRAP_PAT}`)
      .send({ name: "to-revoke" });
    const keyId = createRes.body.id;

    // Revoke it
    const revokeRes = await request(app)
      .delete(`/api/users/me/api-keys/${keyId}`)
      .set("Authorization", `Bearer ${BOOTSTRAP_PAT}`);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body).toEqual({ revoked: true });
  });

  // ── Rejection paths ─────────────────────────────────────────────────

  it("revoked PAT is rejected with 401", async () => {
    // Revoke the bootstrap PAT
    await testDb.db
      .update(userApiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(userApiKeys.keyHash, hashToken(BOOTSTRAP_PAT)));

    const app = createAuthenticatedApp();

    const res = await request(app)
      .get("/api/users/me/api-keys")
      .set("Authorization", `Bearer ${BOOTSTRAP_PAT}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key has been revoked" });
  });

  it("expired PAT is rejected with 401", async () => {
    // Set PAT expiration to the past
    await testDb.db
      .update(userApiKeys)
      .set({ expiresAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(userApiKeys.keyHash, hashToken(BOOTSTRAP_PAT)));

    const app = createAuthenticatedApp();

    const res = await request(app)
      .get("/api/users/me/api-keys")
      .set("Authorization", `Bearer ${BOOTSTRAP_PAT}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key has expired" });
  });

  it("unauthenticated request is rejected", async () => {
    const app = createAuthenticatedApp();

    const res = await request(app)
      .post(`/api/companies/${TEST_COMPANY_ID}/agent-hires`)
      .send({ name: "test-agent", role: "general" });

    // No auth header → actor type "none" → unauthorized
    expect(res.status).toBe(401);
  });

  it("unknown bearer token falls through to none actor (401)", async () => {
    const app = createAuthenticatedApp();

    const res = await request(app)
      .post(`/api/companies/${TEST_COMPANY_ID}/agent-hires`)
      .set("Authorization", "Bearer unknown_token_not_in_db")
      .send({ name: "test-agent", role: "general" });

    expect(res.status).toBe(401);
  });

  // ── Existing agent auth is unaffected ───────────────────────────────

  it("agent JWT/key auth paths are not broken by PAT resolution", async () => {
    const app = createAuthenticatedApp();

    // A garbage bearer token that isn't a PAT, JWT, or agent key
    // should fall through all checks and resolve as "none"
    const res = await request(app)
      .get(`/api/companies/${TEST_COMPANY_ID}/agents`)
      .set("Authorization", "Bearer not_a_real_agent_key_at_all");

    expect(res.status).toBe(401);
  });
});
