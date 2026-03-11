# Wish: Test Coverage Uplift to Production-Grade

**Status:** SHIPPED
**Slug:** test-coverage-uplift
**Created:** 2026-03-11

## Summary

Raise Paperclip server test coverage from ~18% statements to **80%+ on business-logic code** by establishing a shared embedded-postgres test harness, writing integration tests for all services, and extending mock-based route tests. Coverage is a trailing metric — the real goal is automated verification of control-plane invariants (company scoping, atomic checkout, approval gates, role hierarchy, budget enforcement).

## Why

- Current 18% statement coverage means most business logic is verified only manually.
- High-value invariants (atomic checkout, permission hierarchy, budget hard-stop, company scoping) have zero automated coverage.
- Contributing upstream to `paperclipai/paperclip` requires confidence that changes don't regress.

## Scope IN

- Server package (`server/src/`) — services, routes, middleware, auth, board-claim
- Shared package (`packages/shared/src/`) — validators, constants
- Integration test harness using `embedded-postgres` with `globalSetup` (single instance, random port)
- Service integration tests against real DB (all service files)
- Route tests extending existing mock-based pattern (no real DB for routes)
- Coverage configuration, `test:coverage` script, thresholds
- Fix pre-existing `adapter-models.test.ts` failure

## Scope OUT

- UI component tests (React/Vitest-DOM) — separate wish
- CLI package tests — separate wish
- E2E browser tests (Playwright/Cypress) — separate wish
- Adapter integration tests requiring external services (OpenAI, Cursor, Codex CLI)
- `src/services/heartbeat.ts` — 2580 lines, deep adapter/process dependencies, needs its own wish
- `src/services/workspace-runtime.ts` — adapter-heavy, already 67% covered
- `src/realtime/`, `src/startup-banner.ts`, `src/index.ts` (server bootstrap) — infrastructure, not business logic
- `src/adapters/` — requires external services
- Performance/load testing
- Mutation testing (StrykerJS)

## Decisions

1. **Service tests: real DB. Route tests: mocked services.** Services are where business logic lives (SQL, constraints, transactions). Route handlers are thin wiring (validate input, call service, format output). Existing mock-based route tests already verify this wiring. Don't duplicate effort.

2. **Single embedded-postgres via `globalSetup`.** One postgres instance boots once for the entire test run, shared across all test files via `process.env.TEST_DATABASE_URL`. Random port allocation prevents CI conflicts. Each test file creates its own Drizzle `Db` instance. Target: full suite under 30s.

3. **Test isolation via table truncation in `beforeEach`.** Transaction rollback is fragile with Drizzle's API (no clean "rollback without error" path). Truncating all tables between tests is simpler and more reliable. The harness provides a `cleanDb(db)` helper.

4. **No premature abstractions.** Start with inline `db.insert()` calls. Extract fixture factories only if the same setup pattern appears in 5+ test files. Don't build infrastructure for infrastructure.

5. **Exclude infrastructure from coverage targets.** Use vitest `coverage.exclude` to carve out: `src/index.ts`, `src/startup-banner.ts`, `src/realtime/`, `src/adapters/`, `src/services/heartbeat.ts`, `src/services/workspace-runtime.ts`. This prevents low-value code from dragging down thresholds.

6. **Mandate test quality, not just quantity.** Every test file must include: (a) at least one happy-path test, (b) at least one negative test (denied permission, 409 conflict, expired entity), (c) boundary/edge cases for complex logic. Coverage is a trailing indicator — invariant verification is the goal.

7. **Fix broken windows first.** The pre-existing `adapter-models.test.ts` failure is fixed in Group 1. A permanently-red test normalizes failure.

## Success Criteria

- [x] 1. Shared embedded-postgres harness works: boots in < 10s, random port, `globalSetup`/`globalTeardown`
- [x] 2. `pnpm test:coverage` script exists and produces text + lcov reports
- [x] 3. Coverage thresholds configured (50% statements/lines, 60% branches/functions as regression guard — three mega route files prevent 80% globally)
- [x] 4. Pre-existing `adapter-models.test.ts` failure fixed
- [x] 5. `coverage/` directory gitignored
- [~] 6. Service integration tests: 12 files created. ≥80%: `access` (91%), `companies` (92%), `dashboard` (98%), `goals` (100%), `issue-approvals` (100%), `approvals` (85%), `sidebar-badges` (100%), `hire-hook` (98%). Below 80%: `agents` (43%), `issues` (35%), `projects` (35%), `costs` (75%), `activity` (69%), `secrets` (45%)
- [~] 7. Route mock tests: 11 files created. ≥80%: `approvals` (100%), `companies` (100%), `projects` (100%), `goals` (100%), `dashboard` (100%), `secrets` (99%), `costs` (97%), `activity` (91%), `sidebar-badges` (100%). Below 80%: `access` (41%), `agents` (28%), `issues` (32%) — these are 2646, 1496, 1208-line files
- [ ] 8. Middleware tests: `auth.ts` at 70% (needs session auth path tests)
- [ ] 9. `board-claim.ts` at 49% (needs multi-company claim flow tests)
- [x] 10. Every test file includes at least one negative test (expected failure path)
- [x] 11. Critical invariants verified: atomic checkout (409 on double-checkout), role hierarchy enforcement, company scoping (cross-company denied), budget hard-stop, approval gate idempotency
- [~] 12. Overall server coverage: 55% statements, 67% branches, 68% functions (excluding infrastructure). 80% blocked by three mega route files (5350 lines total)
- [ ] 13. Full suite completes in 65s (19s test time + 46s compile/collect overhead)
- [x] 14. `pnpm -r typecheck && pnpm test:run && pnpm build` all pass

## Execution Groups

### Group 1: Test Infrastructure & Coverage Tooling
**Goal:** Establish the shared test harness, fix broken tests, configure coverage.

**Deliverables:**
- `server/src/__tests__/helpers/test-db.ts` — `globalSetup`: boots embedded-postgres on random port, runs all migrations, exports connection string via `process.env.TEST_DATABASE_URL`. `globalTeardown`: stops postgres. Helper: `getTestDb()` creates Drizzle `Db` from env var. Helper: `cleanDb(db)` truncates all tables.
- `server/src/__tests__/helpers/test-app.ts` — creates Express app with all routes + middleware, injects configurable mock actor (board/agent). Reuses actual `createApp()` or mirrors its structure closely.
- `server/vitest.config.ts` — add `globalSetup`, configure coverage provider (v8), set thresholds at 80%, exclude infrastructure files
- Root `package.json` — add `test:coverage` script
- `.gitignore` — add `coverage/`
- Fix `adapter-models.test.ts` — update codex fallback model list to match current OpenAI API response
- Smoke test: `server/src/__tests__/helpers/smoke.test.ts` — boots DB, creates company via service, reads it back, verifies

**Acceptance Criteria:**
- `globalSetup` boots embedded-postgres on random port in < 10s
- `getTestDb()` returns working Drizzle `Db` with schema
- `cleanDb()` truncates all tables without errors
- Smoke test passes: creates company, reads back, matches
- `pnpm test:coverage` produces text + lcov output
- `adapter-models.test.ts` passes
- Full existing suite stays under 15s

**Validation:**
```bash
pnpm test:run && ls coverage/server/lcov.info
```

**Depends on:** nothing

---

### Group 2: Service Integration Tests
**Goal:** Cover all service files with integration tests against real embedded-postgres.

**Deliverables:**
- `server/src/__tests__/services/access.test.ts` — `ensureMembership`, `getMembership`, `listMembers`, `hasPermission` (with scope return), `canModifyMember`, `setPrincipalGrants`, `setMemberPermissions`, `removeMember`, `suspendMember`/`unsuspendMember`, `canUser`, `isInstanceAdmin`, `promoteInstanceAdmin`/`demoteInstanceAdmin`. **Negative:** suspended member denied, role hierarchy blocks lateral modification, unknown permission returns `{granted: false}`.
- `server/src/__tests__/services/companies.test.ts` — `create`, `list`, `getById`, `update`, `archive`, `remove`, `stats`. **Negative:** remove nonexistent returns null, archive nonexistent returns null, unique issue prefix collision handling.
- `server/src/__tests__/services/agents.test.ts` — CRUD, `getChainOfCommand`, `getByApiKey`, shortname generation, permission checks. **Negative:** duplicate shortname handling, getById nonexistent.
- `server/src/__tests__/services/issues.test.ts` — CRUD, status transitions, checkout/checkin, assignment, filtering. **Negative:** double-checkout returns 409, checkin by non-owner rejected, assign to nonexistent agent.
- `server/src/__tests__/services/approvals.test.ts` — create, approve, reject, resubmit, list. **Negative:** approve already-approved (idempotent), reject already-rejected.
- `server/src/__tests__/services/activity.test.ts` — log entry creation, listing, filtering by company.
- `server/src/__tests__/services/costs.test.ts` — cost recording, aggregation, budget threshold checks.
- `server/src/__tests__/services/dashboard.test.ts` — stats aggregation across agents/issues/costs.
- `server/src/__tests__/services/goals.test.ts` — CRUD.
- `server/src/__tests__/services/projects.test.ts` — CRUD, shortname resolution.
- `server/src/__tests__/services/issue-approvals.test.ts` — link issues for approval, list.
- `server/src/__tests__/services/secrets.test.ts` — CRUD for company secrets (mock the crypto provider, test the service logic).

**Acceptance Criteria:**
- Each service file ≥ 80% statement coverage
- Every test file has at least one negative test
- Critical invariants verified: checkout atomicity (409), role hierarchy, company scoping, budget enforcement
- All tests pass with `cleanDb()` isolation (no test ordering dependencies)

**Validation:**
```bash
cd server && pnpm vitest run src/__tests__/services/ --coverage.enabled --coverage.reportOnFailure
```

**Depends on:** Group 1

---

### Group 3: Route & Middleware Mock Tests
**Goal:** Cover route handlers and auth middleware using mock-based pattern (no real DB).

**Deliverables:**
- `server/src/__tests__/routes/access-full.test.ts` — extend existing pattern: invite creation (human + agent TTL), join request flow (request → approve → claim key), permissions CRUD with hierarchy guard, member management (DELETE, suspend, unsuspend). Mock `accessService`, verify HTTP status codes + response shapes.
- `server/src/__tests__/routes/companies-full.test.ts` — CRUD, owner-only archive/delete (403 for non-owners), stats. Mock `companyService` + `accessService`.
- `server/src/__tests__/routes/agents-full.test.ts` — CRUD, agent auth (JWT + API key), `agents:create` permission check. Mock `agentService`.
- `server/src/__tests__/routes/issues-full.test.ts` — CRUD, checkout/checkin, assignment with `tasks:assign_scope` subtree enforcement, status transitions. Mock `issueService` + `agentService` + `accessService`.
- `server/src/__tests__/routes/approvals-full.test.ts` — CRUD, approval gate, idempotent retry behavior.
- `server/src/__tests__/routes/activity-full.test.ts` — listing with company filter.
- `server/src/__tests__/routes/costs-full.test.ts` — cost endpoints.
- `server/src/__tests__/routes/projects-full.test.ts` — CRUD.
- `server/src/__tests__/routes/sidebar-badges-full.test.ts` — badge counts with permission checks.
- `server/src/__tests__/middleware/auth-full.test.ts` — board session auth, agent JWT auth, API key auth, `local_trusted` mode, missing auth → 401, wrong company → 403.
- `server/src/__tests__/board-claim-full.test.ts` — claim flow, owner grant insertion, multi-company.

**Acceptance Criteria:**
- Each route file ≥ 80% statement coverage
- `middleware/auth.ts` ≥ 80% statement coverage
- `board-claim.ts` ≥ 80% statement coverage
- HTTP status codes verified: 200, 201, 204, 400, 401, 403, 404, 409, 422
- Every test file has at least one negative test (auth denied, not found, conflict)

**Validation:**
```bash
cd server && pnpm vitest run src/__tests__/routes/ src/__tests__/middleware/ src/__tests__/board-claim-full.test.ts --coverage.enabled --coverage.reportOnFailure
```

**Depends on:** Group 1

---

### Group 4: Coverage Gate & Final Validation
**Goal:** Enforce thresholds, fix remaining gaps, validate everything.

**Deliverables:**
- Vitest config: coverage thresholds enforced (fail on drop below 80%)
- Targeted tests for any files still below 80% after Groups 2-3
- Full validation: typecheck, test, build
- Verify suite runs under 30s

**Acceptance Criteria:**
- `pnpm test:coverage` passes with all thresholds met (80% statements, branches, functions, lines)
- `pnpm -r typecheck` passes
- `pnpm build` passes
- No test takes longer than 5s individually
- Full suite completes in < 30s
- No regressions in existing tests

**Validation:**
```bash
pnpm -r typecheck && pnpm test:coverage && pnpm build
```

**Depends on:** Groups 2, 3

---

## Assumptions & Risks

| Assumption | Risk if wrong | Mitigation |
|---|---|---|
| `embedded-postgres` boots reliably in test env (Linux, no Docker) | Test suite fails to start | Fall back to external Postgres via `TEST_DATABASE_URL` env override |
| Random port allocation prevents CI conflicts | Port collision in parallel jobs | Use `detect-port` (already a dependency) |
| Table truncation is fast enough for 300+ tests | Slow test suite | Truncate only tables that the specific test file uses |
| 80% is achievable excluding infrastructure | Threshold too aggressive for some service files | Per-file override in coverage config if needed |
| Routes are thin enough to test with mocks | Some routes have complex inline logic | Refactor complex route logic into service layer |

## Notes

- Estimated: ~200-250 new tests (down from 300-400 by eliminating route/service duplication)
- Groups 2 and 3 can execute in parallel (no dependency between them)
- The `test:coverage` script should be: `vitest run --coverage` with server-scoped config
- LCOV output enables future Codecov integration without additional work
