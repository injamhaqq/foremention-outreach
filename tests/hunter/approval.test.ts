import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema.ts";
import { createHunterRepository } from "../../lib/hunter/repository.ts";
import { enrollApprovedHunterDraft } from "../../lib/hunter/approval.ts";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT);
    CREATE TABLE targets (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      email TEXT,
      linkedin_url TEXT
    );
    CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE list_targets (list_id TEXT, target_id TEXT, PRIMARY KEY(list_id, target_id));
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, email TEXT);
    CREATE TABLE email_accounts (id TEXT PRIMARY KEY, name TEXT, from_email TEXT);
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE workflow_steps (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      step_order INTEGER NOT NULL,
      track TEXT NOT NULL,
      step_type TEXT NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      list_id TEXT,
      account_id TEXT,
      email_account_id TEXT,
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE run_profiles (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      target_id TEXT,
      email_account_id TEXT,
      UNIQUE(run_id, target_id)
    );
    CREATE TABLE run_profile_tracks (
      id TEXT PRIMARY KEY,
      run_profile_id TEXT,
      track TEXT,
      state TEXT,
      current_step INTEGER,
      UNIQUE(run_profile_id, track)
    );
    INSERT INTO companies VALUES ('company-1', 'Acme', 'acme.example');
    INSERT INTO targets VALUES ('target-1', 'company-1', 'jane@acme.example', 'https://linkedin.com/in/jane');
    INSERT INTO lists VALUES ('list-1', 'Foremention Buyers');
    INSERT INTO accounts VALUES ('li-1', 'LinkedIn 1', 'li@example.com');
    INSERT INTO email_accounts VALUES ('email-1', 'Email 1', 'outreach@example.com');
    INSERT INTO workflows VALUES ('workflow-1', 'Foremention Assisted Outreach');
    INSERT INTO workflow_steps VALUES ('step-li', 'workflow-1', 1, 'linkedin', 'message');
    INSERT INTO workflow_steps VALUES ('step-email', 'workflow-1', 1, 'email', 'email');
    INSERT INTO runs VALUES ('run-1', 'workflow-1', 'list-1', 'li-1', 'email-1', 'running');
  `);
  ensureHunterSchema(db);
  return db;
}

function addDraft(db: Database.Database) {
  return createHunterRepository(db).saveHunterDraft({
    targetId: "target-1",
    companyId: "company-1",
    channel: "email",
    subject: "AI search gap",
    body: "I noticed a relevant AI-search signal.",
    evidenceIds: ["signal-1"],
    firstTouchFingerprint: "target-1:email:first",
  });
}

test("unapproved first touch cannot enroll", () => {
  const db = makeDb();
  const draft = addDraft(db);
  assert.throws(() => enrollApprovedHunterDraft(db, { draftId: draft.id, runId: "run-1" }), /approval required/i);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM run_profiles").get() as { c: number }).c, 0);
});

test("approved first touch enrolls exactly once", () => {
  const db = makeDb();
  const repo = createHunterRepository(db);
  const draft = addDraft(db);
  repo.setHunterApproval({ draftId: draft.id, state: "approved", approvedBy: "founder" });

  const first = enrollApprovedHunterDraft(db, { draftId: draft.id, runId: "run-1" });
  const second = enrollApprovedHunterDraft(db, { draftId: draft.id, runId: "run-1" });

  assert.equal(first.enrolled, true);
  assert.equal(second.enrolled, false);
  assert.equal(second.alreadyEnrolled, true);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM run_profiles WHERE target_id = 'target-1'").get() as { c: number }).c, 1);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM run_profile_tracks").get() as { c: number }).c, 2);
});

test("suppressed contact can never enroll even after approval", () => {
  const db = makeDb();
  const repo = createHunterRepository(db);
  const draft = addDraft(db);
  repo.setHunterApproval({ draftId: draft.id, state: "approved", approvedBy: "founder" });
  repo.upsertHunterSuppression({ targetId: "target-1", companyId: "company-1", kind: "unsubscribe", value: "jane@acme.example", reason: "Unsubscribed", source: "reply" });

  assert.throws(() => enrollApprovedHunterDraft(db, { draftId: draft.id, runId: "run-1" }), /suppressed/i);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM run_profiles").get() as { c: number }).c, 0);
});


test("production enrollment is blocked until persistent storage is verified", () => {
  const db = makeDb();
  const repo = createHunterRepository(db);
  const draft = addDraft(db);
  repo.setHunterApproval({ draftId: draft.id, state: "approved", approvedBy: "founder" });

  assert.throws(
    () => enrollApprovedHunterDraft(db, {
      draftId: draft.id,
      runId: "run-1",
      env: {
        NODE_ENV: "production",
        RAILWAY_PROJECT_ID: "project-1",
        RAILWAY_DEPLOYMENT_ID: "deploy-1",
      } as NodeJS.ProcessEnv,
    }),
    /persistent storage verification is required/i,
  );
  assert.equal((db.prepare("SELECT COUNT(*) c FROM run_profiles").get() as { c: number }).c, 0);
});
