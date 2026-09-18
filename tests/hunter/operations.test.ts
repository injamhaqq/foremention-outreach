import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema";
import { loadHunterOperationsSnapshot } from "../../lib/hunter/operations";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT);
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, company_id TEXT, full_name TEXT, title TEXT,
      email TEXT, email_status TEXT, linkedin_url TEXT
    );
    INSERT INTO companies VALUES ('c1','Acme','acme.com'),('c2','Beta','beta.com');
    INSERT INTO targets VALUES
      ('t1','c1','Jane Doe','Head of SEO','jane@acme.com','verified','https://linkedin.com/in/jane'),
      ('t2','c2','John Doe','VP Marketing','john@beta.com','unverified','https://linkedin.com/in/john');
  `);
  ensureHunterSchema(db);
  return db;
}

test("operations snapshot reports truthful today, pipeline, health and cost metrics", () => {
  const db = makeDb();
  const now = new Date("2026-09-18T15:00:00.000Z");

  db.exec(`
    INSERT INTO hunter_discovery_evidence
      (id, company_id, dedupe_key, query, source_url, source_name, evidence_text, observed_at, last_seen_at, created_at)
    VALUES
      ('de1','c1','d1','q','https://acme.com/a','search','evidence','2026-09-18T10:00:00.000Z','2026-09-18T10:00:00.000Z','2026-09-18T10:00:00.000Z'),
      ('de2','c2','d2','q','https://beta.com/a','search','evidence','2026-09-17T10:00:00.000Z','2026-09-17T10:00:00.000Z','2026-09-17T10:00:00.000Z');

    INSERT INTO hunter_signals
      (id, company_id, target_id, dedupe_key, type, title, summary, source_url, source_name, evidence_text,
       observed_at, confidence, score_contribution, created_at, updated_at)
    VALUES
      ('s1','c1','t1','s1','ai_search_hiring','Hiring','Hiring','https://acme.com/jobs','Acme','evidence',
       '2026-09-18T11:00:00.000Z',0.9,20,'2026-09-18T11:00:00.000Z','2026-09-18T11:00:00.000Z');

    INSERT INTO hunter_buyer_provenance
      (id,target_id,company_id,dedupe_key,provider,provider_person_id,confidence,last_seen_at,created_at)
    VALUES ('bp1','t1','c1','bp1','apollo','p1',0.9,'2026-09-18T11:10:00.000Z','2026-09-18T11:10:00.000Z');

    INSERT INTO hunter_message_drafts
      (id,target_id,company_id,channel,subject,body,evidence_ids_json,first_touch_fingerprint,status,created_at,updated_at)
    VALUES ('d1','t1','c1','email','Hi','Body','["s1"]','fp1','draft','2026-09-18T11:20:00.000Z','2026-09-18T11:20:00.000Z');

    INSERT INTO hunter_reply_classifications
      (id,target_id,source_reply_id,channel,classification,confidence,classifier,created_at)
    VALUES
      ('r1','t1','reply1','email','positive',0.95,'test','2026-09-18T12:00:00.000Z'),
      ('r2','t2','reply2','linkedin','negative',0.9,'test','2026-09-18T12:10:00.000Z');

    INSERT INTO hunter_opportunities
      (id,company_id,target_id,dedupe_key,stage,next_action,commercial_evidence_json,created_at,updated_at)
    VALUES
      ('o1','c1','t1','c1|t1','meeting_booked','Prepare','[]','2026-09-18T12:30:00.000Z','2026-09-18T12:30:00.000Z'),
      ('o2','c2','t2','c2|t2','pilot_active','Deliver','[]','2026-09-18T12:40:00.000Z','2026-09-18T12:40:00.000Z');

    INSERT INTO hunter_source_runs
      (id,provider_id,query,status,candidate_count,error,started_at,finished_at,created_at)
    VALUES ('sr1','firecrawl','q','failed',0,'timeout','2026-09-18T13:00:00.000Z','2026-09-18T13:00:10.000Z','2026-09-18T13:00:00.000Z');

    INSERT INTO hunter_channel_health_snapshots
      (id,channel,account_id,healthy,remaining_capacity,reasons_json,measured_at,created_at)
    VALUES
      ('h1','email','e1',1,12,'[]','2026-09-18T14:00:00.000Z','2026-09-18T14:00:00.000Z'),
      ('h2','linkedin','l1',0,0,'["checkpoint_detected"]','2026-09-18T14:05:00.000Z','2026-09-18T14:05:00.000Z');

    INSERT INTO hunter_cost_events
      (id,company_id,target_id,provider,event_type,amount_usd,units,metadata_json,occurred_at,created_at)
    VALUES
      ('cost1','c1','t1','apollo','enrichment',0.08,1,'{}','2026-09-18T14:10:00.000Z','2026-09-18T14:10:00.000Z');

    INSERT INTO hunter_sales_tasks
      (id,company_id,target_id,dedupe_key,task_type,status,priority,reason,source_reply_id,due_at,metadata_json,created_at,updated_at)
    VALUES
      ('task1','c1','t1','task1','human_reply','pending','high','Positive reply','reply1','2026-09-18T14:15:00.000Z','{}','2026-09-18T14:15:00.000Z','2026-09-18T14:15:00.000Z');

    INSERT INTO hunter_autopilot_decisions
      (id,company_id,target_id,mode,action,allowed_email,allowed_linkedin,reasons_json,decided_at,created_at)
    VALUES ('ad1','c1','t1','assisted','approval_required',1,1,'["first_touch_review_policy"]','2026-09-18T14:20:00.000Z','2026-09-18T14:20:00.000Z');
  `);

  const snapshot = loadHunterOperationsSnapshot(db, now);
  assert.equal(snapshot.today.accountsMonitored, 1);
  assert.equal(snapshot.today.newSignals, 1);
  assert.equal(snapshot.today.buyersDiscovered, 1);
  assert.equal(snapshot.today.verifiedContacts, 1);
  assert.equal(snapshot.today.messagesWaitingApproval, 1);
  assert.equal(snapshot.today.replies, 2);
  assert.equal(snapshot.today.positiveReplies, 1);
  assert.equal(snapshot.pipeline.meetingsOrBeyond, 2);
  assert.equal(snapshot.pipeline.activePilotsOrBeyond, 1);
  assert.equal(snapshot.pipeline.paidCustomers, 0);
  assert.equal(snapshot.health.sourceFailures24h, 1);
  assert.equal(snapshot.health.channels.email.healthy, true);
  assert.equal(snapshot.health.channels.linkedin.healthy, false);
  assert.deepEqual(snapshot.health.channels.linkedin.reasons, ["checkpoint_detected"]);
  assert.equal(snapshot.costs.todayUsd, 0.08);
  assert.equal(snapshot.autopilot.approvalRequiredToday, 1);
  assert.equal(snapshot.salesTasks.pending, 1);
  assert.equal(snapshot.salesTasks.highPriority, 1);
});
