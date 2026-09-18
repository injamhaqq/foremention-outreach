import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { applyHardBounce } from "../../lib/email/bounces";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE targets (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      email TEXT,
      email_status TEXT,
      notes TEXT
    );
    CREATE TABLE run_profiles (
      id TEXT PRIMARY KEY,
      target_id TEXT
    );
    CREATE TABLE run_profile_tracks (
      id TEXT PRIMARY KEY,
      run_profile_id TEXT,
      track TEXT,
      state TEXT,
      error_message TEXT
    );

    INSERT INTO targets VALUES
      ('t1','c1','bad@acme.com','verified',NULL),
      ('t2','c1','good@acme.com','verified',NULL);
    INSERT INTO run_profiles VALUES
      ('rp1','t1'),
      ('rp2','t2');
    INSERT INTO run_profile_tracks VALUES
      ('rp1-email','rp1','email','in_progress',NULL),
      ('rp1-li','rp1','linkedin','in_progress',NULL),
      ('rp2-email','rp2','email','in_progress',NULL),
      ('rp2-li','rp2','linkedin','in_progress',NULL);
  `);
  return db;
}

test("one mailbox hard bounce invalidates only that address and only its email track", () => {
  const db = makeDb();
  const result = applyHardBounce(db, "bad@acme.com", new Date("2026-09-18T15:00:00.000Z"));

  assert.deepEqual(result, { applied: true, targetId: "t1", companyId: "c1" });

  const targets = db.prepare("SELECT id, email_status FROM targets ORDER BY id").all() as Array<{
    id: string;
    email_status: string;
  }>;
  assert.deepEqual(targets, [
    { id: "t1", email_status: "invalid" },
    { id: "t2", email_status: "verified" },
  ]);

  const tracks = db.prepare("SELECT id, state FROM run_profile_tracks ORDER BY id").all() as Array<{
    id: string;
    state: string;
  }>;
  assert.deepEqual(tracks, [
    { id: "rp1-email", state: "skipped" },
    { id: "rp1-li", state: "in_progress" },
    { id: "rp2-email", state: "in_progress" },
    { id: "rp2-li", state: "in_progress" },
  ]);
});

test("replaying the same hard bounce is idempotent", () => {
  const db = makeDb();
  assert.equal(applyHardBounce(db, "bad@acme.com").applied, true);
  assert.deepEqual(applyHardBounce(db, "bad@acme.com"), {
    applied: false,
    reason: "already_invalid",
  });
});
