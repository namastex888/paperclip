import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { getTestDb, cleanDb, closeCleanupConnection } from "./helpers/test-db.js";
import type { TestDb } from "./helpers/test-db.js";
import { actorMiddleware } from "../middleware/auth.js";
import { userApiKeys, authUsers, companies, companyMemberships, instanceUserRoles } from "@paperclipai/db";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const TEST_USER_ID = "pat-test-user-1";
const TEST_COMPANY_ID = "00000000-0000-4000-a000-000000000001";
const VALID_PAT = "pclip_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const REVOKED_PAT = "pclip_revoked_key_1234567890abcdef";
const EXPIRED_PAT = "pclip_expired_key_1234567890abcdef";
const NO_EXPIRY_PAT = "pclip_noexpiry_1234567890abcdef12";

describe("actorMiddleware — PAT resolution", () => {
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

    // Seed user
    await testDb.db.insert(authUsers).values({
      id: TEST_USER_ID,
      name: "PAT Test User",
      email: "pat-test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed company
    await testDb.db.insert(companies).values({
      id: TEST_COMPANY_ID,
      name: "Test Company",
    });

    // Seed membership
    await testDb.db.insert(companyMemberships).values({
      principalType: "user",
      principalId: TEST_USER_ID,
      companyId: TEST_COMPANY_ID,
      membershipRole: "owner",
      status: "active",
    });

    // Seed valid PAT (no expiry, not revoked)
    await testDb.db.insert(userApiKeys).values({
      userId: TEST_USER_ID,
      name: "valid-key",
      keyPrefix: VALID_PAT.slice(0, 8),
      keyHash: hashToken(VALID_PAT),
    });

    // Seed PAT with no expiresAt (should work forever until revoked)
    await testDb.db.insert(userApiKeys).values({
      userId: TEST_USER_ID,
      name: "no-expiry-key",
      keyPrefix: NO_EXPIRY_PAT.slice(0, 8),
      keyHash: hashToken(NO_EXPIRY_PAT),
      expiresAt: null,
    });

    // Seed revoked PAT
    await testDb.db.insert(userApiKeys).values({
      userId: TEST_USER_ID,
      name: "revoked-key",
      keyPrefix: REVOKED_PAT.slice(0, 8),
      keyHash: hashToken(REVOKED_PAT),
      revokedAt: new Date("2026-01-01T00:00:00Z"),
    });

    // Seed expired PAT
    await testDb.db.insert(userApiKeys).values({
      userId: TEST_USER_ID,
      name: "expired-key",
      keyPrefix: EXPIRED_PAT.slice(0, 8),
      keyHash: hashToken(EXPIRED_PAT),
      expiresAt: new Date("2025-01-01T00:00:00Z"),
    });
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(testDb.db, { deploymentMode: "authenticated" }));
    app.get("/test", (req: express.Request, res: express.Response) => {
      res.json({ actor: (req as any).actor });
    });
    return app;
  }

  it("resolves a valid PAT as a board actor with source user_api_key", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/test")
      .set("Authorization", `Bearer ${VALID_PAT}`);

    expect(res.status).toBe(200);
    expect(res.body.actor).toMatchObject({
      type: "board",
      userId: TEST_USER_ID,
      companyIds: [TEST_COMPANY_ID],
      source: "user_api_key",
    });
  });

  it("resolves PAT with null expiresAt (never expires)", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/test")
      .set("Authorization", `Bearer ${NO_EXPIRY_PAT}`);

    expect(res.status).toBe(200);
    expect(res.body.actor).toMatchObject({
      type: "board",
      userId: TEST_USER_ID,
      source: "user_api_key",
    });
  });

  it("rejects a revoked PAT with 401", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/test")
      .set("Authorization", `Bearer ${REVOKED_PAT}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key has been revoked" });
  });

  it("rejects an expired PAT with 401", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/test")
      .set("Authorization", `Bearer ${EXPIRED_PAT}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API key has expired" });
  });

  it("falls through to none actor for unknown bearer tokens", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/test")
      .set("Authorization", "Bearer unknown_token_value");

    expect(res.status).toBe(200);
    expect(res.body.actor.type).toBe("none");
  });

  it("resolves isInstanceAdmin from instance_user_roles", async () => {
    await testDb.db.insert(instanceUserRoles).values({
      userId: TEST_USER_ID,
      role: "instance_admin",
    });

    const app = createApp();
    const res = await request(app)
      .get("/test")
      .set("Authorization", `Bearer ${VALID_PAT}`);

    expect(res.status).toBe(200);
    expect(res.body.actor).toMatchObject({
      type: "board",
      userId: TEST_USER_ID,
      isInstanceAdmin: true,
      source: "user_api_key",
    });
  });
});
