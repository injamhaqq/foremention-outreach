import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema";
import { createHunterRepository } from "../../lib/hunter/repository";
import { processHunterAutopilotTarget } from "../../lib/hunter/autopilot-execution";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, industry TEXT, location TEXT);
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, company_id TEXT, full_name TEXT, title TEXT, email TEXT, email_status TEXT,
      linkedin_url TEXT, last_replied_at TEXT, email_replied_at TEXT
    );
    CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE list_targets (list_id TEXT, target_id TEXT, PRIMARY KEY(list_id,target_id));
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE email_accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE workflow_steps (id TEXT PRIMARY KEY, workflow_id TEXT, step_order INTEGER, track TEXT, step_type TEXT);
    CREATE TABLE runs (id TEXT PRIMARY KEY, workflow_id TEXT, list_id TEXT, account_id TEXT, email_account_id TEXT, status TEXT);
    CREATE TABLE run_profiles (id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT, email_account_id TEXT, UNIQUE(run_id,target_id));
    CREATE TABLE run_profile_tracks (id TEXT PRIMARY KEY, run_profile_id TEXT, track TEXT, state TEXT, current_step INTEGER);
    INSERT INTO companies VALUES ('company-1','Acme','acme.com','B2B software','US');
    INSERT INTO targets VALUES ('target-1','company-1','Jane Doe','Head of SEO','jane@acme.com','verified','https://linkedin.com/in/jane',NULL,NULL);
    INSERT INTO lists VALUES ('list-1','Hunter');
    INSERT INTO accounts VALUES ('li-1','LinkedIn');
    INSERT INTO email_accounts VALUES ('mail-1','Email');
    INSERT INTO workflows VALUES ('wf-1','Hunter Multichannel');
    INSERT INTO workflow_steps VALUES ('email-step','wf-1',1,'email','email');
    INSERT INTO workflow_steps VALUES ('li-step','wf-1',1,'linkedin','message');
    INSERT INTO runs VALUES ('run-1','wf-1','list-1','li-1','mail-1','running');
  `);
  ensureHunterSchema(db);
  const repo = createHunterRepository(db);
  const signal = repo.upsertHunterSignal({
    companyId: "company-1", targetId: "target-1", type: "ai_search_hiring",
    title: "AI search hiring", summary: "Hiring for generative search",
    sourceUrl: "https://acme.com/jobs/seo", sourceName: "Acme careers",
    evidenceText: "Own AI Overviews and generative search.",
    observedAt: "2026-09-18T12:00:00.000Z", expiresAt: "2026-10-18T12:00:00.000Z",
    confidence: 0.95, scoreContribution: 20,
  });
  repo.saveHunterScore({
    companyId: "company-1", targetId: "target-1",
    result: { fitScore: 25, intentScore: 20, buyerScore: 20, totalScore: 65, route: "good_cold", outreachReady: true, reason: "TWO_SIGNAL_RULE", strongSignalCount: 1 },
    computedAt: "2026-09-18T12:01:00.000Z",
  });
  return { db, signal };
}

const ai = {
  generateStructured: async ({ system }: { system: string }) => {
    if (/cold outreach/i.test(system)) {
      return { subject: "AI search at Acme", body: "Saw your AI-search hiring signal. Happy to send the evidence.", evidenceIds: ["hs-placeholder"] };
    }
    return { summary: "Acme is hiring for AI search.", whyNow: "Current hiring signal.", outreachAngle: "Offer evidence.", claims: [] };
  },
};

test("assisted mode creates evidence-backed drafts but does not enroll them", async () => {
  const { db, signal } = makeDb();
  const provider = {
    generateStructured: async () => ({ subject: "AI search at Acme", body: "Saw your current AI-search hiring signal.", evidenceIds: [signal.id] }),
  };
  const result = await processHunterAutopilotTarget(db, {
    companyId: "company-1", targetId: "target-1", mode: "assisted", runId: "run-1",
    emailHealthy: true, linkedinHealthy: true, aiProvider: provider,
    now: new Date("2026-09-18T12:05:00.000Z"),
  });
  assert.equal(result.action, "approval_required");
  assert.equal(result.drafts.length, 2);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM run_profiles").get() as {c:number}).c, 0);
});

test("guarded auto approves and enrolls both healthy channels for a good-cold buyer", async () => {
  const { db, signal } = makeDb();
  const provider = {
    generateStructured: async ({ system }: { system: string }) => ({
      ...(system.includes("email") ? { subject: "AI search at Acme" } : {}),
      body: "Saw your current AI-search hiring signal. Happy to send the evidence.",
      evidenceIds: [signal.id],
    }),
  };
  const result = await processHunterAutopilotTarget(db, {
    companyId: "company-1", targetId: "target-1", mode: "guarded_auto", runId: "run-1",
    emailHealthy: true, linkedinHealthy: true, aiProvider: provider,
    now: new Date("2026-09-18T12:05:00.000Z"),
  });
  assert.equal(result.action, "auto_start");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM run_profiles").get() as {c:number}).c, 1);
  const tracks = db.prepare("SELECT track FROM run_profile_tracks ORDER BY track").all() as Array<{track:string}>;
  assert.deepEqual(tracks.map((row) => row.track), ["email", "linkedin"]);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM hunter_approvals WHERE state = 'approved'").get() as {c:number}).c, 2);
});

test("guarded auto only enrolls a healthy channel and never bypasses suppression", async () => {
  const { db, signal } = makeDb();
  const provider = {
    generateStructured: async ({ system }: { system: string }) => ({
      ...(system.includes("email") ? { subject: "AI search at Acme" } : {}),
      body: "Evidence-backed note.",
      evidenceIds: [signal.id],
    }),
  };
  const result = await processHunterAutopilotTarget(db, {
    companyId: "company-1", targetId: "target-1", mode: "guarded_auto", runId: "run-1",
    emailHealthy: true, linkedinHealthy: false, aiProvider: provider,
    now: new Date("2026-09-18T12:05:00.000Z"),
  });
  assert.equal(result.action, "auto_start");
  const tracks = db.prepare("SELECT track FROM run_profile_tracks").all() as Array<{track:string}>;
  assert.deepEqual(tracks.map((row) => row.track), ["email"]);

  db.prepare("DELETE FROM run_profile_tracks").run();
  db.prepare("DELETE FROM run_profiles").run();
  createHunterRepository(db).upsertHunterSuppression({
    targetId: "target-1", companyId: "company-1", kind: "unsubscribe",
    value: "jane@acme.com", reason: "Unsubscribed", source: "reply",
  });
  const blocked = await processHunterAutopilotTarget(db, {
    companyId: "company-1", targetId: "target-1", mode: "guarded_auto", runId: "run-1",
    emailHealthy: true, linkedinHealthy: true, aiProvider: provider,
    now: new Date("2026-09-18T12:06:00.000Z"),
  });
  assert.equal(blocked.action, "blocked");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM run_profiles").get() as {c:number}).c, 0);
});


test("unverified email is never approved for email outreach even when LinkedIn is healthy", async () => {
  const { db, signal } = makeDb();
  db.prepare("UPDATE targets SET email_status = 'unverified' WHERE id = 'target-1'").run();
  const provider = {
    generateStructured: async () => ({
      body: "Evidence-backed note.",
      evidenceIds: [signal.id],
    }),
  };
  const result = await processHunterAutopilotTarget(db, {
    companyId: "company-1", targetId: "target-1", mode: "guarded_auto", runId: "run-1",
    emailHealthy: true, linkedinHealthy: true, aiProvider: provider,
    now: new Date("2026-09-18T12:05:00.000Z"),
  });
  assert.equal(result.allowedChannels.email, false);
  assert.equal(result.allowedChannels.linkedin, true);
  assert.deepEqual(result.drafts.map((draft) => draft.channel), ["linkedin"]);
  const tracks = db.prepare("SELECT track FROM run_profile_tracks").all() as Array<{track:string}>;
  assert.deepEqual(tracks.map((row) => row.track), ["linkedin"]);
});
