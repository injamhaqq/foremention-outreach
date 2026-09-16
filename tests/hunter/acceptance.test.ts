import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema.ts";
import { createHunterRepository } from "../../lib/hunter/repository.ts";
import { qualifyHunterCandidate } from "../../lib/hunter/qualification.ts";
import { buildResearchBrief } from "../../lib/hunter/research.ts";
import { enrollApprovedHunterDraft } from "../../lib/hunter/approval.ts";
import { transitionHunterOpportunity } from "../../lib/hunter/opportunities.ts";
import { runHunterMaintenanceCycle } from "../../lib/hunter/runner.ts";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, industry TEXT, location TEXT, notes TEXT);
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, company_id TEXT, full_name TEXT, title TEXT, email TEXT, linkedin_url TEXT,
      email_status TEXT, email_replied_at TEXT, last_replied_at TEXT, reply_kind TEXT
    );
    CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE list_targets (list_id TEXT, target_id TEXT, PRIMARY KEY(list_id, target_id));
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE email_accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE workflow_steps (id TEXT PRIMARY KEY, workflow_id TEXT, step_order INTEGER, track TEXT, step_type TEXT);
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, workflow_id TEXT, list_id TEXT, account_id TEXT, email_account_id TEXT,
      status TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE run_profiles (id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT, email_account_id TEXT, UNIQUE(run_id, target_id));
    CREATE TABLE run_profile_tracks (
      id TEXT PRIMARY KEY, run_profile_id TEXT, track TEXT, state TEXT, current_step INTEGER,
      error_message TEXT, next_step_at TEXT
    );
    CREATE TABLE email_replies (
      id TEXT PRIMARY KEY, target_id TEXT, run_id TEXT, from_email TEXT, subject TEXT, body_text TEXT,
      received_at TEXT, classification_json TEXT, classified_at TEXT, classification_error TEXT,
      dispatched_at TEXT, dispatch_result_json TEXT, manually_edited INTEGER DEFAULT 0
    );

    INSERT INTO companies VALUES ('company-1','Acme','acme.example','B2B software','US',NULL);
    INSERT INTO targets VALUES ('target-1','company-1','Jane Doe','Head of SEO','jane@acme.example','https://linkedin.com/in/jane','verified',NULL,NULL,NULL);
    INSERT INTO lists VALUES ('list-1','Hunter approved');
    INSERT INTO accounts VALUES ('li-1','LinkedIn 1');
    INSERT INTO email_accounts VALUES ('mail-1','Sender 1');
    INSERT INTO workflows VALUES ('wf-1','Foremention multichannel');
    INSERT INTO workflow_steps VALUES ('step-li','wf-1',1,'linkedin','message');
    INSERT INTO workflow_steps VALUES ('step-email','wf-1',1,'email','email');
    INSERT INTO runs (id, workflow_id, list_id, account_id, email_account_id, status) VALUES ('run-1','wf-1','list-1','li-1','mail-1','running');
  `);
  ensureHunterSchema(db);
  return db;
}

test("synthetic signal to approved outreach to human reply stops both channels and updates pipeline", async () => {
  const db = makeDb();
  const repository = createHunterRepository(db);
  const signal = repository.upsertHunterSignal({
    companyId: "company-1",
    targetId: "target-1",
    type: "ai_search_hiring",
    title: "Hiring for AI-search SEO",
    summary: "The role explicitly mentions generative search.",
    sourceUrl: "https://acme.example/jobs/seo",
    sourceName: "Acme careers",
    evidenceText: "Own SEO strategy across AI Overviews and generative search.",
    observedAt: "2026-09-16T12:00:00.000Z",
    expiresAt: "2026-10-16T12:00:00.000Z",
    confidence: 0.95,
    scoreContribution: 20,
  });

  const qualified = qualifyHunterCandidate({
    fit: { b2bSoftware: true, employeeBandFit: false, organicMotion: false, marketFit: false },
    signals: [{ type: "ai_search_hiring", strength: 20, sourceUrl: signal.sourceUrl, observedAt: signal.observedAt }],
    buyer: { role: "Head of SEO", hasEmail: true, hasLinkedIn: true },
  });
  assert.equal(qualified.outreachReady, true);
  repository.saveHunterScore({ companyId: "company-1", targetId: "target-1", result: qualified, computedAt: "2026-09-16T12:01:00.000Z" });

  const packet = buildResearchBrief({
    target: { id: "target-1", fullName: "Jane Doe", role: "Head of SEO", email: "jane@acme.example", linkedinUrl: "https://linkedin.com/in/jane" },
    company: { id: "company-1", name: "Acme", domain: "acme.example" },
    signals: [{ id: signal.id, type: signal.type, title: signal.title, summary: signal.summary, evidenceText: signal.evidenceText, sourceUrl: signal.sourceUrl, observedAt: signal.observedAt, confidence: signal.confidence }],
  });
  assert.equal(packet.evidence.length, 1);

  const draft = repository.saveHunterDraft({
    targetId: "target-1", companyId: "company-1", channel: "email",
    subject: "AI search visibility at Acme",
    body: "Noticed the new AI-search SEO role. Happy to send the evidence breakdown if useful.",
    evidenceIds: [signal.id], firstTouchFingerprint: "synthetic-first-touch-email",
  });
  repository.setHunterApproval({ draftId: draft.id, state: "approved", approvedBy: "test-founder" });
  const enrollment = enrollApprovedHunterDraft(db, { draftId: draft.id, runId: "run-1" });
  assert.equal(enrollment.enrolled, true);

  transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "contacted", allowForwardSkip: true });
  db.prepare(`INSERT INTO email_replies (id, target_id, run_id, from_email, subject, body_text, received_at) VALUES ('reply-1','target-1','run-1','jane@acme.example','Re: AI search','Yes, send me the breakdown and let us talk.','2026-09-16T13:00:00.000Z')`).run();

  const cycle = await runHunterMaintenanceCycle(db);
  assert.equal(cycle.emailRepliesProcessed, 1);
  const activeTracks = (db.prepare("SELECT COUNT(*) c FROM run_profile_tracks WHERE state NOT IN ('completed','failed','skipped')").get() as { c: number }).c;
  assert.equal(activeTracks, 0);
  const opportunity = db.prepare("SELECT stage FROM hunter_opportunities WHERE company_id = 'company-1' AND target_id = 'target-1'").get() as { stage: string };
  assert.equal(opportunity.stage, "interested");
});
