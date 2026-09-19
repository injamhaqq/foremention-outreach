import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { evaluateHunterPersistenceReadiness } from "../../lib/hunter/persistence-readiness";

test("non-production local development does not require a deployment persistence witness", () => {
  const db = new Database(":memory:");
  const result = evaluateHunterPersistenceReadiness(db, {} as NodeJS.ProcessEnv);
  assert.equal(result.ready, true);
  assert.equal(result.mode, "not_required");
});

test("Railway production becomes persistence-ready only after state survives a deployment change", () => {
  const db = new Database(":memory:");

  const first = evaluateHunterPersistenceReadiness(db, {
    NODE_ENV: "production",
    RAILWAY_PROJECT_ID: "project-1",
    RAILWAY_DEPLOYMENT_ID: "deploy-1",
  } as NodeJS.ProcessEnv);
  assert.equal(first.ready, false);
  assert.equal(first.mode, "awaiting_cross_deployment_witness");

  const same = evaluateHunterPersistenceReadiness(db, {
    NODE_ENV: "production",
    RAILWAY_PROJECT_ID: "project-1",
    RAILWAY_DEPLOYMENT_ID: "deploy-1",
  } as NodeJS.ProcessEnv);
  assert.equal(same.ready, false);

  const second = evaluateHunterPersistenceReadiness(db, {
    NODE_ENV: "production",
    RAILWAY_PROJECT_ID: "project-1",
    RAILWAY_DEPLOYMENT_ID: "deploy-2",
  } as NodeJS.ProcessEnv);
  assert.equal(second.ready, true);
  assert.equal(second.mode, "verified_cross_deployment");
  assert.equal(second.previousDeploymentId, "deploy-1");

  const later = evaluateHunterPersistenceReadiness(db, {
    NODE_ENV: "production",
    RAILWAY_PROJECT_ID: "project-1",
    RAILWAY_DEPLOYMENT_ID: "deploy-3",
  } as NodeJS.ProcessEnv);
  assert.equal(later.ready, true);
  assert.equal(later.mode, "verified_cross_deployment");
});

test("a fresh database on the next Railway deployment does not falsely verify persistence", () => {
  const firstDb = new Database(":memory:");
  evaluateHunterPersistenceReadiness(firstDb, {
    NODE_ENV: "production",
    RAILWAY_PROJECT_ID: "project-1",
    RAILWAY_DEPLOYMENT_ID: "deploy-1",
  } as NodeJS.ProcessEnv);

  const lostDb = new Database(":memory:");
  const result = evaluateHunterPersistenceReadiness(lostDb, {
    NODE_ENV: "production",
    RAILWAY_PROJECT_ID: "project-1",
    RAILWAY_DEPLOYMENT_ID: "deploy-2",
  } as NodeJS.ProcessEnv);
  assert.equal(result.ready, false);
  assert.equal(result.mode, "awaiting_cross_deployment_witness");
});

test("explicit operator confirmation supports production hosts without a deployment id", () => {
  const db = new Database(":memory:");
  const result = evaluateHunterPersistenceReadiness(db, {
    NODE_ENV: "production",
    HUNTER_PERSISTENT_STORAGE_CONFIRMED: "true",
  } as NodeJS.ProcessEnv);
  assert.equal(result.ready, true);
  assert.equal(result.mode, "operator_confirmed");
});
