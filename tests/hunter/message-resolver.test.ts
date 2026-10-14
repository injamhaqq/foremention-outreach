import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema";
import {
  getPendingHunterFirstTouch,
  markHunterFirstTouchDelivered,
} from "../../lib/hunter/message-resolver";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT);
    CREATE TABLE targets (id TEXT PRIMARY KEY, company_id TEXT, full_name TEXT, email TEXT, linkedin_url TEXT);
    INSERT INTO companies VALUES ('company-1','Acme','acme.com');
    INSERT INTO targets VALUES ('target-1','company-1','Jane Doe','jane@acme.com','https://linkedin.com/in/jane');
  `);
  ensureHunterSchema(db);
  db.prepare(`
    INSERT INTO hunter_message_drafts (
      id, target_id, company_id, channel, subject, body, evidence_ids_json,
      first_touch_fingerprint, status
    ) VALUES
      ('email-draft','target-1','company-1','email','AI search at Acme','Email body','["e1"]','fp-email','enrolled'),
      ('linkedin-draft','target-1','company-1','linkedin',NULL,'LinkedIn body','["e1"]','fp-linkedin','enrolled')
  `).run();
  db.prepare(`
    INSERT INTO hunter_approvals (id, draft_id, state, approved_by, approved_at) VALUES
      ('ha-email','email-draft','approved','founder','2026-09-18T12:00:00.000Z'),
      ('ha-linkedin','linkedin-draft','approved','founder','2026-09-18T12:00:00.000Z')
  `).run();
  return db;
}

test("enrolled Hunter email draft is the first-touch source until delivery succeeds", () => {
  const db = makeDb();
  const draft = getPendingHunterFirstTouch(db, { targetId: "target-1", runId: "run-1", channel: "email" });
  assert.equal(draft?.id, "email-draft");
  assert.equal(draft?.subject, "AI search at Acme");
  assert.equal(draft?.body, "Email body");

  // A failed transport does not mark delivery: reading again still returns it.
  const retry = getPendingHunterFirstTouch(db, { targetId: "target-1", runId: "run-1", channel: "email" });
  assert.equal(retry?.id, "email-draft");

  markHunterFirstTouchDelivered(db, { draftId: "email-draft", runId: "run-1", targetId: "target-1", channel: "email" });
  assert.equal(getPendingHunterFirstTouch(db, { targetId: "target-1", runId: "run-1", channel: "email" }), null);
});

test("email and LinkedIn first touches are consumed independently", () => {
  const db = makeDb();
  markHunterFirstTouchDelivered(db, { draftId: "email-draft", runId: "run-1", targetId: "target-1", channel: "email" });
  assert.equal(getPendingHunterFirstTouch(db, { targetId: "target-1", runId: "run-1", channel: "email" }), null);
  assert.equal(getPendingHunterFirstTouch(db, { targetId: "target-1", runId: "run-1", channel: "linkedin" })?.id, "linkedin-draft");
});

test("delivery recording is idempotent", () => {
  const db = makeDb();
  const input = { draftId: "email-draft", runId: "run-1", targetId: "target-1", channel: "email" as const };
  markHunterFirstTouchDelivered(db, input);
  markHunterFirstTouchDelivered(db, input);
  const row = db.prepare("SELECT COUNT(*) c FROM hunter_draft_deliveries").get() as { c: number };
  assert.equal(row.c, 1);
});

test("drafts without a human approval are never returned as automated first-touch content", () => {
  const db = makeDb();
  db.prepare("DELETE FROM hunter_approvals WHERE draft_id = 'email-draft'").run();
  assert.equal(getPendingHunterFirstTouch(db, { targetId: "target-1", runId: "run-1", channel: "email" }), null);

  db.prepare(`INSERT INTO hunter_approvals (id, draft_id, state, approved_by, approved_at)
    VALUES ('ha-email','email-draft','approved','autopilot:full_auto','2026-09-18T12:00:00.000Z')`).run();
  assert.equal(getPendingHunterFirstTouch(db, { targetId: "target-1", runId: "run-1", channel: "email" }), null);

  db.prepare("UPDATE hunter_approvals SET approved_by = 'founder', state = 'rejected' WHERE draft_id = 'email-draft'").run();
  assert.equal(getPendingHunterFirstTouch(db, { targetId: "target-1", runId: "run-1", channel: "email" }), null);

  db.prepare("UPDATE hunter_approvals SET state = 'approved' WHERE draft_id = 'email-draft'").run();
  assert.equal(getPendingHunterFirstTouch(db, { targetId: "target-1", runId: "run-1", channel: "email" })?.id, "email-draft");
});
