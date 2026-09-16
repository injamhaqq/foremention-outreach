import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema.ts";
import { applyHunterReplyEvent } from "../../lib/hunter/replies.ts";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY);
    CREATE TABLE targets (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      email TEXT,
      email_replied_at TEXT,
      last_replied_at TEXT,
      reply_kind TEXT
    );
    CREATE TABLE run_profiles (id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT);
    CREATE TABLE run_profile_tracks (
      id TEXT PRIMARY KEY,
      run_profile_id TEXT,
      track TEXT,
      state TEXT,
      error_message TEXT,
      next_step_at TEXT
    );
    INSERT INTO companies VALUES ('company-1');
    INSERT INTO targets VALUES ('target-1', 'company-1', 'jane@acme.example', NULL, NULL, NULL);
    INSERT INTO run_profiles VALUES ('rp-1', 'run-1', 'target-1');
    INSERT INTO run_profile_tracks VALUES ('rt-li', 'rp-1', 'linkedin', 'in_progress', NULL, NULL);
    INSERT INTO run_profile_tracks VALUES ('rt-email', 'rp-1', 'email', 'in_progress', NULL, NULL);
  `);
  ensureHunterSchema(db);
  return db;
}

for (const kind of ["positive", "question", "objection", "not_now", "referral"] as const) {
  test(`${kind} human reply stops both outreach tracks`, () => {
    const db = makeDb();
    const result = applyHunterReplyEvent(db, { targetId: "target-1", channel: "email", kind, receivedAt: "2026-09-16T12:00:00.000Z" });
    assert.equal(result.stopped, true);
    const states = db.prepare("SELECT state FROM run_profile_tracks ORDER BY id").all() as Array<{ state: string }>;
    assert.deepEqual(states.map((row) => row.state), ["skipped", "skipped"]);
    const target = db.prepare("SELECT email_replied_at, reply_kind FROM targets WHERE id = 'target-1'").get() as { email_replied_at: string; reply_kind: string };
    assert.equal(target.email_replied_at, "2026-09-16T12:00:00.000Z");
    assert.equal(target.reply_kind, kind);
  });
}

test("unsubscribe creates a durable target suppression and stops both tracks", () => {
  const db = makeDb();
  applyHunterReplyEvent(db, { targetId: "target-1", channel: "email", kind: "unsubscribe", receivedAt: "2026-09-16T12:00:00.000Z" });
  const suppression = db.prepare("SELECT kind FROM hunter_suppressions WHERE target_id = 'target-1'").get() as { kind: string };
  assert.equal(suppression.kind, "unsubscribe");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM run_profile_tracks WHERE state = 'skipped'").get() as { c: number }).c, 2);
});

test("complaint and negative intent suppress future outreach", () => {
  for (const kind of ["complaint", "negative"] as const) {
    const db = makeDb();
    applyHunterReplyEvent(db, { targetId: "target-1", channel: "linkedin", kind, receivedAt: "2026-09-16T12:00:00.000Z" });
    assert.equal((db.prepare("SELECT COUNT(*) c FROM hunter_suppressions WHERE target_id = 'target-1'").get() as { c: number }).c, 1);
  }
});

test("OOO is not treated as a genuine human reply and can be rescheduled", () => {
  const db = makeDb();
  const result = applyHunterReplyEvent(db, { targetId: "target-1", channel: "email", kind: "ooo", receivedAt: "2026-09-16T12:00:00.000Z", resumeAt: "2026-09-20T09:00:00.000Z" });
  assert.equal(result.stopped, false);
  const rows = db.prepare("SELECT state, next_step_at FROM run_profile_tracks ORDER BY id").all() as Array<{ state: string; next_step_at: string | null }>;
  assert.equal(rows.every((row) => row.state === "in_progress"), true);
  assert.equal(rows.find((row) => row.next_step_at)?.next_step_at, "2026-09-20T09:00:00.000Z");
});
