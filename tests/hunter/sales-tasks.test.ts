import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema";
import { applyHunterReplyEvent } from "../../lib/hunter/replies";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT);
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, company_id TEXT, email_replied_at TEXT, last_replied_at TEXT, reply_kind TEXT
    );
    CREATE TABLE run_profiles (id TEXT PRIMARY KEY, target_id TEXT);
    CREATE TABLE run_profile_tracks (
      id TEXT PRIMARY KEY, run_profile_id TEXT, state TEXT, error_message TEXT, next_step_at TEXT
    );
    INSERT INTO companies VALUES ('c1','Acme','acme.com');
    INSERT INTO targets VALUES ('t1','c1',NULL,NULL,NULL);
    INSERT INTO run_profiles VALUES ('rp1','t1');
    INSERT INTO run_profile_tracks VALUES ('rt1','rp1','in_progress',NULL,NULL);
  `);
  ensureHunterSchema(db);
  return db;
}

test("positive and question replies create idempotent high-priority human sales tasks", () => {
  const db = makeDb();
  applyHunterReplyEvent(db, {
    targetId: "t1",
    channel: "email",
    kind: "positive",
    receivedAt: "2026-09-18T15:00:00.000Z",
    sourceReplyId: "reply-1",
  });

  const task = db.prepare(`
    SELECT task_type, status, priority, reason, source_reply_id
    FROM hunter_sales_tasks
  `).get() as {
    task_type: string; status: string; priority: string; reason: string; source_reply_id: string;
  };
  assert.equal(task.task_type, "human_reply");
  assert.equal(task.status, "pending");
  assert.equal(task.priority, "high");
  assert.match(task.reason, /positive/i);
  assert.equal(task.source_reply_id, "reply-1");

  // Replaying the same reply cannot create a second operator task.
  applyHunterReplyEvent(db, {
    targetId: "t1",
    channel: "email",
    kind: "positive",
    receivedAt: "2026-09-18T15:00:00.000Z",
    sourceReplyId: "reply-1",
  });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM hunter_sales_tasks").get() as { c: number }).c, 1);
});

test("not-now replies create a future follow-up task while opt-outs create no sales task", () => {
  const db = makeDb();
  applyHunterReplyEvent(db, {
    targetId: "t1",
    channel: "linkedin",
    kind: "not_now",
    receivedAt: "2026-09-18T15:00:00.000Z",
    sourceReplyId: "reply-2",
    resumeAt: "2026-10-18T15:00:00.000Z",
  });
  const task = db.prepare("SELECT task_type, priority, due_at FROM hunter_sales_tasks").get() as {
    task_type: string; priority: string; due_at: string;
  };
  assert.equal(task.task_type, "follow_up_later");
  assert.equal(task.priority, "normal");
  assert.equal(task.due_at, "2026-10-18T15:00:00.000Z");

  db.prepare("DELETE FROM hunter_sales_tasks").run();
  applyHunterReplyEvent(db, {
    targetId: "t1",
    channel: "email",
    kind: "unsubscribe",
    receivedAt: "2026-09-18T16:00:00.000Z",
    sourceReplyId: "reply-3",
  });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM hunter_sales_tasks").get() as { c: number }).c, 0);
});
