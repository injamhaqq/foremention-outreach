import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema.ts";
import { evaluateHunterReadiness } from "../../lib/hunter/readiness.ts";
import { loadStoredResearchInputs, StoredEvidenceError } from "../../lib/hunter/stored-evidence.ts";
import { buildResearchBrief } from "../../lib/hunter/research.ts";

// Fixes added by docs/safety/hunter-verification.md. Synthetic data only.

function readinessDb(linkedIn: number, email: number) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, is_authenticated INTEGER);
    CREATE TABLE email_accounts (id TEXT PRIMARY KEY, is_verified INTEGER);
    CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT);
    INSERT INTO runs VALUES ('run-1','running');
  `);
  for (let i = 0; i < linkedIn; i += 1) db.prepare("INSERT INTO accounts VALUES (?, 1)").run(`li-${i}`);
  for (let i = 0; i < email; i += 1) db.prepare("INSERT INTO email_accounts VALUES (?, 1)").run(`mail-${i}`);
  return db;
}

const BASE_ENV = {
  HUNTER_DISCOVERY_ENABLED: "true",
  SEARXNG_URL: "http://searxng:8080",
  HUNTER_DEFAULT_RUN_ID: "run-1",
} as NodeJS.ProcessEnv;

test("an authenticated LinkedIn account is not an automated outreach channel", () => {
  const linkedInOnly = evaluateHunterReadiness(readinessDb(1, 0), BASE_ENV);
  assert.equal(linkedInOnly.execution.reasons.includes("no_outreach_channel"), true);
  assert.equal(linkedInOnly.execution.ready, false);
  assert.equal(linkedInOnly.sending.linkedinAutomation, "disabled_manual_only");

  const withEmail = evaluateHunterReadiness(readinessDb(1, 1), BASE_ENV);
  assert.equal(withEmail.execution.reasons.includes("no_outreach_channel"), false);
});

test("readiness reports sending as locked by default and keeps it out of fullyReady", () => {
  const result = evaluateHunterReadiness(readinessDb(0, 1), BASE_ENV);
  assert.equal(result.sending.ready, false);
  assert.deepEqual(result.sending.reasons, ["email_sending_locked", "email_compliance_not_configured", "runners_disabled"]);
  assert.equal(result.sending.emailSendingEnabled, false);
  assert.equal(result.sending.runnersEnabled, false);

  const unlocked = evaluateHunterReadiness(readinessDb(0, 1), {
    ...BASE_ENV,
    OUTREACH_EMAIL_SENDING_ENABLED: "true",
    OUTREACH_POSTAL_ADDRESS: "1 Example Street",
    OUTREACH_UNSUBSCRIBE_BASE_URL: "https://outreach.example.test",
    OUTREACH_UNSUBSCRIBE_SECRET: "unit-test-unsubscribe-secret-0123456789",
    HUNTER_RUNNERS_ENABLED: "true",
  } as NodeJS.ProcessEnv);
  assert.equal(unlocked.sending.ready, true);
});

function evidenceDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT);
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, company_id TEXT, email TEXT, linkedin_url TEXT,
      full_name TEXT, title TEXT
    );
    INSERT INTO companies VALUES ('c1','Acme','acme.example'), ('c2','Beta','beta.example');
    INSERT INTO targets VALUES ('t1','c1','jane@acme.example',NULL,'Jane Smith','Head of SEO');
  `);
  ensureHunterSchema(db);
  db.prepare(`
    INSERT INTO hunter_signals (
      id, company_id, dedupe_key, type, title, summary, source_url, evidence_text,
      observed_at, confidence, score_contribution
    ) VALUES ('sig-1','c1','k1','ai_search_hiring','Hiring for AI search','Acme is hiring an SEO lead.',
      'https://acme.example/jobs/seo','Job post mentions AI Overviews.','2026-09-16T00:00:00.000Z',0.9,20)
  `).run();
  return db;
}

test("research inputs are reloaded from stored signals, not client-posted text", () => {
  const db = evidenceDb();
  const stored = loadStoredResearchInputs(db, { targetId: "t1", companyId: "c1", signalIds: ["sig-1"] });
  assert.equal(stored.signals.length, 1);
  assert.equal(stored.signals[0].evidenceText, "Job post mentions AI Overviews.");
  assert.equal(stored.target.fullName, "Jane Smith");
  const packet = buildResearchBrief({ ...stored, miniAudit: null });
  assert.deepEqual(packet.evidence.map((item) => item.id), ["sig-1"]);
});

test("fabricated, foreign, or mini-audit evidence ids are rejected", () => {
  const db = evidenceDb();
  assert.throws(
    () => loadStoredResearchInputs(db, { targetId: "t1", companyId: "c1", signalIds: ["sig-1", "made-up"] }),
    StoredEvidenceError,
  );
  assert.throws(
    () => loadStoredResearchInputs(db, { targetId: "t1", companyId: "c1", signalIds: ["mini:1:1"] }),
    StoredEvidenceError,
  );
  // Target must belong to the company the evidence is for.
  assert.throws(
    () => loadStoredResearchInputs(db, { targetId: "t1", companyId: "c2", signalIds: [] }),
    StoredEvidenceError,
  );
  assert.throws(
    () => loadStoredResearchInputs(db, { targetId: "nobody", companyId: "c1" }),
    StoredEvidenceError,
  );
});

test("research and draft routes only take ids from the client", () => {
  const research = readFileSync("pages/api/hunter/research.ts", "utf8");
  const drafts = readFileSync("pages/api/hunter/drafts.ts", "utf8");
  for (const source of [research, drafts]) {
    assert.match(source, /loadStoredResearchInputs\(/);
    assert.match(source, /miniAudit: null/);
  }
  assert.doesNotMatch(research, /body\.miniAudit/);
});

test("approval route requires a founder session and never trusts a client-supplied approver", () => {
  const source = readFileSync("pages/api/hunter/approve.ts", "utf8");
  assert.match(source, /getToken\(/);
  assert.match(source, /status\(403\)/);
  assert.doesNotMatch(source, /req\.body\?\.approvedBy/);
  assert.match(source, /founder:\$\{/);
  // LinkedIn drafts are never enrolled into automated runs.
  assert.match(source, /draft\.channel === "linkedin"/);
  assert.match(source, /manualSendRequired: true/);
  assert.match(source, /allowedChannels: \["email"\]/);
  const page = readFileSync("pages/hunter/research.tsx", "utf8");
  assert.doesNotMatch(page, /approvedBy/);
  assert.doesNotMatch(page, /Linki now owns sequence execution/);
});

test("Customer Hunter UI copy no longer advertises automated multichannel outreach", () => {
  const page = readFileSync("pages/hunter/index.tsx", "utf8");
  assert.doesNotMatch(page, /multichannel cold outreach/);
  assert.doesNotMatch(page, /\} auto · \{/);
  assert.match(page, /LinkedIn is draft-only/);
  const layout = readFileSync("components/layout/Layout.tsx", "utf8");
  assert.match(layout, /LinkedIn automation .* is disabled/);
});

test("docker compose keeps outbound email locked by default", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  assert.match(compose, /OUTREACH_EMAIL_SENDING_ENABLED: \$\{OUTREACH_EMAIL_SENDING_ENABLED:-false\}/);
  const envExample = readFileSync(".env.example", "utf8");
  assert.match(envExample, /^OUTREACH_EMAIL_SENDING_ENABLED=false$/m);
});
