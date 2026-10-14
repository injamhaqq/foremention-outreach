import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema.ts";
import {
  assertHumanApprovedDraft,
  HumanApprovalRequiredError,
  isHumanApproved,
  isHumanApprover,
} from "../../lib/hunter/send-guard.ts";

test("human approver detection rejects automation identities", () => {
  for (const value of ["founder", "test-founder", "Jane Doe", "jane@foremention.com"]) {
    assert.equal(isHumanApprover(value), true, value);
  }
  for (const value of ["", "  ", null, undefined, "autopilot", "autopilot:full_auto", "AUTO", "system", "runner", "scheduler", "bot", "cron", "agent"]) {
    assert.equal(isHumanApprover(value), false, String(value));
  }
});

test("isHumanApproved needs approved state, timestamp and a human approver", () => {
  assert.equal(isHumanApproved({ state: "approved", approved_by: "founder", approved_at: "2026-10-13T00:00:00Z" }), true);
  assert.equal(isHumanApproved({ state: "pending", approved_by: "founder", approved_at: "2026-10-13T00:00:00Z" }), false);
  assert.equal(isHumanApproved({ state: "approved", approved_by: "founder", approved_at: null }), false);
  assert.equal(isHumanApproved({ state: "approved", approved_by: "autopilot:guarded_auto", approved_at: "2026-10-13T00:00:00Z" }), false);
  assert.equal(isHumanApproved(undefined), false);
});

test("assertHumanApprovedDraft throws for missing or automated approvals", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE targets (id TEXT PRIMARY KEY, company_id TEXT, email TEXT);
    INSERT INTO companies VALUES ('c1','Acme');
    INSERT INTO targets VALUES ('t1','c1','jane@acme.example');
  `);
  ensureHunterSchema(db);
  db.exec(`
    INSERT INTO hunter_message_drafts (id, target_id, company_id, channel, subject, body, evidence_ids_json, first_touch_fingerprint, status)
    VALUES ('d1','t1','c1','email','s','b','[]','fp1','approved'), ('d2','t1','c1','email','s','b','[]','fp2','approved');
    INSERT INTO hunter_approvals (id, draft_id, state, approved_by, approved_at)
    VALUES ('a1','d1','approved','autopilot:full_auto','2026-10-13T00:00:00Z');
  `);
  assert.throws(() => assertHumanApprovedDraft(db, "d1"), HumanApprovalRequiredError);
  assert.throws(() => assertHumanApprovedDraft(db, "d2"), HumanApprovalRequiredError);
  db.prepare("UPDATE hunter_approvals SET approved_by = 'founder' WHERE id = 'a1'").run();
  assert.doesNotThrow(() => assertHumanApprovedDraft(db, "d1"));
});

test("sequencer email step refuses to send without a human-approved draft", () => {
  const source = readFileSync("lib/linkedin/runner.ts", "utf8");
  const emailStep = source.slice(source.indexOf('} else if (step.step_type === "email") {'));
  const guardAt = emailStep.indexOf("if (!hunterFirstTouchDraft) {");
  const sendAt = emailStep.indexOf("await sendEmail(");
  assert.ok(guardAt > 0, "approval guard present in email step");
  assert.ok(sendAt > guardAt, "guard runs before sendEmail");
  assert.match(emailStep.slice(guardAt, guardAt + 400), /trSkip\(db, tr, HUMAN_APPROVAL_REQUIRED_MESSAGE\)/);
  assert.match(emailStep.slice(guardAt, guardAt + 400), /return;/);
});

test("autopilot execution no longer records approvals or enrolls", () => {
  const source = readFileSync("lib/hunter/autopilot-execution.ts", "utf8");
  assert.doesNotMatch(source, /setHunterApproval\(/);
  assert.doesNotMatch(source, /enrollApprovedHunterDraft\(/);
});
