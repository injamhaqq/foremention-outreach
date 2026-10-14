import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { hunterRunnersEnabled } from "../../lib/hunter/runner-flags.ts";
import { ensureHunterRunnerStarted } from "../../lib/hunter/runner.ts";
import { ensureHunterSchema } from "../../lib/hunter/schema.ts";
import { runHunterAcquisitionCycle } from "../../lib/hunter/acquisition-runner.ts";

test("runners are off unless HUNTER_RUNNERS_ENABLED is exactly true", () => {
  assert.equal(hunterRunnersEnabled({} as NodeJS.ProcessEnv), false);
  for (const value of ["", "false", "0", "1", "yes", "on", "enabled", "TRUEISH"]) {
    assert.equal(hunterRunnersEnabled({ HUNTER_RUNNERS_ENABLED: value } as NodeJS.ProcessEnv), false, value);
  }
  for (const value of ["true", "TRUE", " true "]) {
    assert.equal(hunterRunnersEnabled({ HUNTER_RUNNERS_ENABLED: value } as NodeJS.ProcessEnv), true, value);
  }
});

test("Hunter continuous runner does not start (no timer) when disabled", () => {
  const holder = globalThis as typeof globalThis & { __forementionHunterRunnerStarted?: boolean; __forementionHunterTimer?: unknown };
  delete holder.__forementionHunterRunnerStarted;
  delete holder.__forementionHunterTimer;
  assert.equal(ensureHunterRunnerStarted({} as NodeJS.ProcessEnv), false);
  assert.equal(ensureHunterRunnerStarted({ HUNTER_RUNNERS_ENABLED: "false" } as NodeJS.ProcessEnv), false);
  assert.equal(holder.__forementionHunterRunnerStarted, undefined);
  assert.equal(holder.__forementionHunterTimer, undefined);
});

test("instrumentation, sequencer, run-start API and compose all default runners to off", () => {
  const instrumentation = readFileSync("instrumentation.ts", "utf8");
  assert.match(instrumentation, /hunterRunnersEnabled\(process\.env\)/);
  const gated = instrumentation.slice(instrumentation.indexOf("if (runnersEnabled) {"));
  assert.ok(gated.indexOf("ensureGlobalRunnerStarted()") > 0);
  assert.ok(gated.indexOf("ensureHunterRunnerStarted()") > 0);
  assert.equal(instrumentation.indexOf("ensureGlobalRunnerStarted()") > instrumentation.indexOf("if (runnersEnabled) {"), true);

  const sequencer = readFileSync("lib/linkedin/runner.ts", "utf8");
  const start = sequencer.slice(sequencer.indexOf("export function ensureGlobalRunnerStarted"));
  assert.ok(start.indexOf("if (!hunterRunnersEnabled(env))") < start.indexOf("globalLoop()"));

  const runStart = readFileSync("pages/api/runs/[id]/start.ts", "utf8");
  assert.ok(runStart.indexOf("hunterRunnersEnabled(process.env)") < runStart.indexOf("UPDATE runs SET status = 'running'"));

  const compose = readFileSync("docker-compose.yml", "utf8");
  assert.match(compose, /HUNTER_RUNNERS_ENABLED:\s*\$\{HUNTER_RUNNERS_ENABLED:-false\}/);
  const envExample = readFileSync(".env.example", "utf8");
  assert.match(envExample, /^HUNTER_RUNNERS_ENABLED=false$/m);
});

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, industry TEXT, location TEXT, linkedin_url TEXT, website TEXT, notes TEXT);
    CREATE TABLE targets (id TEXT PRIMARY KEY, company_id TEXT, full_name TEXT, title TEXT, email TEXT, email_status TEXT, linkedin_url TEXT, last_replied_at TEXT, email_replied_at TEXT);
    CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE list_targets (list_id TEXT, target_id TEXT, PRIMARY KEY(list_id,target_id));
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, is_authenticated INTEGER DEFAULT 1, daily_connection_limit INTEGER DEFAULT 20, daily_message_limit INTEGER DEFAULT 50, daily_inmail_limit INTEGER DEFAULT 15);
    CREATE TABLE email_accounts (id TEXT PRIMARY KEY, name TEXT, daily_email_limit INTEGER DEFAULT 50, ramp_up_enabled INTEGER DEFAULT 0, ramp_start_date TEXT, is_verified INTEGER DEFAULT 1);
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE workflow_steps (id TEXT PRIMARY KEY, workflow_id TEXT, step_order INTEGER, track TEXT, step_type TEXT);
    CREATE TABLE runs (id TEXT PRIMARY KEY, workflow_id TEXT, list_id TEXT, account_id TEXT, email_account_id TEXT, status TEXT);
    CREATE TABLE run_profiles (id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT, email_account_id TEXT, UNIQUE(run_id,target_id));
    CREATE TABLE run_profile_tracks (id TEXT PRIMARY KEY, run_profile_id TEXT, track TEXT, state TEXT, current_step INTEGER);
    CREATE TABLE logs (id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT, level TEXT, message TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);
  ensureHunterSchema(db);
  return db;
}

test("background acquisition skips autopilot drafting when runners are disabled; founder-triggered runs still draft", async () => {
  const db = makeDb();
  const env = { HUNTER_DISCOVERY_ENABLED: "false" } as NodeJS.ProcessEnv;
  const background = await runHunterAcquisitionCycle(db, { env, discoveryProviders: [], buyerProviders: [] });
  assert.equal(background.autopilotSkippedReason, "runners_disabled");
  assert.equal(background.autopilotTargetsProcessed, 0);

  const manual = await runHunterAcquisitionCycle(db, { env, discoveryProviders: [], buyerProviders: [], manualTrigger: true });
  assert.notEqual(manual.autopilotSkippedReason, "runners_disabled");
});
