import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { evaluateHunterReadiness } from "../../lib/hunter/readiness";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, is_authenticated INTEGER);
    CREATE TABLE email_accounts (id TEXT PRIMARY KEY, is_verified INTEGER);
    CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT);
    INSERT INTO accounts VALUES ('li-1',1);
    INSERT INTO email_accounts VALUES ('mail-1',1);
    INSERT INTO runs VALUES ('run-1','running');
  `);
  return db;
}

test("readiness separates core acquisition execution from Foremention-native advantage", () => {
  const db = makeDb();
  const env = {
    HUNTER_DISCOVERY_ENABLED: "true",
    SEARXNG_URL: "http://searxng:8080",
    HUNTER_API_KEY: "hunter-key",
    HUNTER_AI_PROVIDER: "groq",
    GROQ_API_KEY: "groq-key",
    GROQ_MODEL: "compound",
    FOREMENTION_OUTREACH_URL: "https://foremention.com",
    FOREMENTION_OUTREACH_SECRET: "shared-secret",
    HUNTER_AUTOPILOT_MODE: "assisted",
    HUNTER_DEFAULT_RUN_ID: "run-1",
  } as NodeJS.ProcessEnv;

  const ready = evaluateHunterReadiness(db, env);
  assert.equal(ready.discovery.ready, true);
  assert.equal(ready.buyers.ready, true);
  assert.equal(ready.ai.ready, true);
  assert.equal(ready.execution.ready, true);
  assert.equal(ready.forementionMiniAudit.ready, true);
  assert.equal(ready.fullyReady, true);

  const withoutNativeAudit = evaluateHunterReadiness(db, { ...env, FOREMENTION_OUTREACH_SECRET: "" });
  assert.equal(withoutNativeAudit.execution.ready, true);
  assert.equal(withoutNativeAudit.forementionMiniAudit.ready, false);
  assert.equal(withoutNativeAudit.fullyReady, false);
});

test("readiness reports concrete blockers instead of silently appearing idle", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, is_authenticated INTEGER);
    CREATE TABLE email_accounts (id TEXT PRIMARY KEY, is_verified INTEGER);
    CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT);
  `);

  const result = evaluateHunterReadiness(db, {
    HUNTER_DISCOVERY_ENABLED: "true",
    HUNTER_AUTOPILOT_MODE: "assisted",
  } as NodeJS.ProcessEnv);

  assert.equal(result.fullyReady, false);
  assert.equal(result.discovery.reasons.includes("no_discovery_provider"), true);
  assert.equal(result.buyers.reasons.includes("no_buyer_provider"), true);
  assert.equal(result.ai.reasons.includes("ai_provider_not_configured"), true);
  assert.equal(result.execution.reasons.includes("no_outreach_channel"), true);
  assert.equal(result.execution.reasons.includes("default_run_not_configured"), true);
});
