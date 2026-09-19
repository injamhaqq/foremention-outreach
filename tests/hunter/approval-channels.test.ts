import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema";
import { createHunterRepository } from "../../lib/hunter/repository";
import { enrollApprovedHunterDraft } from "../../lib/hunter/approval";

test("enrollment can restrict tracks to the healthy channel set", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, domain TEXT);
    CREATE TABLE targets (id TEXT PRIMARY KEY, company_id TEXT, email TEXT, linkedin_url TEXT);
    CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE list_targets (list_id TEXT, target_id TEXT, PRIMARY KEY(list_id,target_id));
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE email_accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE workflow_steps (id TEXT PRIMARY KEY, workflow_id TEXT, step_order INTEGER, track TEXT, step_type TEXT);
    CREATE TABLE runs (id TEXT PRIMARY KEY, workflow_id TEXT, list_id TEXT, account_id TEXT, email_account_id TEXT, status TEXT);
    CREATE TABLE run_profiles (id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT, email_account_id TEXT, UNIQUE(run_id,target_id));
    CREATE TABLE run_profile_tracks (id TEXT PRIMARY KEY, run_profile_id TEXT, track TEXT, state TEXT, current_step INTEGER, UNIQUE(run_profile_id,track));
    INSERT INTO companies VALUES ('c1','Acme','acme.com');
    INSERT INTO targets VALUES ('t1','c1','jane@acme.com','https://linkedin.com/in/jane');
    INSERT INTO lists VALUES ('l1','Hunter');
    INSERT INTO accounts VALUES ('a1','LI');
    INSERT INTO email_accounts VALUES ('e1','Email');
    INSERT INTO workflows VALUES ('w1','Multichannel');
    INSERT INTO workflow_steps VALUES ('s1','w1',1,'email','email');
    INSERT INTO workflow_steps VALUES ('s2','w1',1,'linkedin','message');
    INSERT INTO runs VALUES ('r1','w1','l1','a1','e1','running');
  `);
  ensureHunterSchema(db);
  const repo = createHunterRepository(db);
  const draft = repo.saveHunterDraft({ targetId:"t1", companyId:"c1", channel:"email", subject:"Hi", body:"Evidence", evidenceIds:["x"], firstTouchFingerprint:"t1:email:first" });
  repo.setHunterApproval({ draftId:draft.id, state:"approved", approvedBy:"autopilot" });
  enrollApprovedHunterDraft(db, { draftId:draft.id, runId:"r1", allowedChannels:["email"] });
  const tracks = db.prepare("SELECT track FROM run_profile_tracks").all() as Array<{track:string}>;
  assert.deepEqual(tracks.map((row)=>row.track), ["email"]);
});
