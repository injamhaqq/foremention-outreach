import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema";
import { measureHunterRunChannelHealth, runHunterAcquisitionCycle } from "../../lib/hunter/acquisition-runner";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, industry TEXT, location TEXT,
      linkedin_url TEXT, website TEXT, notes TEXT
    );
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, company_id TEXT, full_name TEXT, title TEXT, email TEXT, email_status TEXT,
      linkedin_url TEXT, last_replied_at TEXT, email_replied_at TEXT
    );
    CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE list_targets (list_id TEXT, target_id TEXT, PRIMARY KEY(list_id,target_id));
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT, is_authenticated INTEGER DEFAULT 1,
      daily_connection_limit INTEGER DEFAULT 20, daily_message_limit INTEGER DEFAULT 50,
      daily_inmail_limit INTEGER DEFAULT 15
    );
    CREATE TABLE email_accounts (
      id TEXT PRIMARY KEY, name TEXT, daily_email_limit INTEGER DEFAULT 50,
      ramp_up_enabled INTEGER DEFAULT 0, ramp_start_date TEXT, is_verified INTEGER DEFAULT 1
    );
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE workflow_steps (
      id TEXT PRIMARY KEY, workflow_id TEXT, step_order INTEGER, track TEXT, step_type TEXT
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, workflow_id TEXT, list_id TEXT, account_id TEXT,
      email_account_id TEXT, status TEXT
    );
    CREATE TABLE run_profiles (
      id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT, email_account_id TEXT,
      UNIQUE(run_id,target_id)
    );
    CREATE TABLE run_profile_tracks (
      id TEXT PRIMARY KEY, run_profile_id TEXT, track TEXT, state TEXT, current_step INTEGER
    );
    CREATE TABLE logs (
      id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT, level TEXT, message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    INSERT INTO lists VALUES ('list-1','Hunter');
    INSERT INTO accounts VALUES ('li-1','LinkedIn',1,2,3,1);
    INSERT INTO email_accounts VALUES ('mail-1','Email',4,0,NULL,1);
    INSERT INTO workflows VALUES ('wf-1','Hunter multichannel');
    INSERT INTO workflow_steps VALUES ('email-step','wf-1',1,'email','email');
    INSERT INTO workflow_steps VALUES ('li-step','wf-1',1,'linkedin','message');
    INSERT INTO runs VALUES ('run-1','wf-1','list-1','li-1','mail-1','running');
  `);
  ensureHunterSchema(db);
  return db;
}

test("live channel health uses the configured run accounts and persists snapshots", () => {
  const db = makeDb();
  const health = measureHunterRunChannelHealth(db, "run-1", new Date("2026-09-18T12:00:00.000Z"));

  assert.equal(health.email.healthy, true);
  assert.equal(health.email.remainingCapacity, 4);
  assert.equal(health.linkedin.healthy, true);
  assert.equal(health.linkedin.remainingCapacity, 6);
  assert.equal(
    (db.prepare("SELECT COUNT(*) c FROM hunter_channel_health_snapshots").get() as { c: number }).c,
    2,
  );

  db.prepare("UPDATE email_accounts SET is_verified = 0 WHERE id = 'mail-1'").run();
  const unverified = measureHunterRunChannelHealth(db, "run-1", new Date("2026-09-18T12:01:00.000Z"));
  assert.equal(unverified.email.healthy, false);
  assert.equal(unverified.email.reasons.includes("email_account_unverified"), true);
});

test("acquisition cycle discovers, qualifies and drafts once, then respects discovery cadence", async () => {
  const db = makeDb();
  let discoveryCalls = 0;
  let aiCalls = 0;

  const discoveryProviders = [{
    id: "fake-search",
    search: async () => {
      discoveryCalls += 1;
      return [{
        name: "Acme",
        domain: "acme.com",
        sourceUrl: "https://acme.com/jobs/seo",
        sourceName: "Acme careers",
        evidenceText: "Acme is a B2B SaaS platform hiring a Head of SEO to own AI Overviews and generative search.",
      }];
    },
  }];

  const buyerProviders = [{
    id: "fake-buyers",
    findBuyers: async () => [{
      fullName: "Jane Doe",
      role: "Head of SEO",
      email: "jane@acme.com",
      emailStatus: "verified",
      linkedinUrl: "https://linkedin.com/in/jane",
      sourceName: "fake-buyers",
      providerPersonId: "jane-1",
      confidence: 0.99,
    }],
  }];

  const aiProvider = {
    generateStructured: async ({ user }: { user: string }) => {
      aiCalls += 1;
      const packet = JSON.parse(user) as { evidence: Array<{ id: string }> };
      return {
        subject: "AI search at Acme",
        body: "Saw your current AI-search hiring signal. Happy to send the evidence.",
        evidenceIds: [packet.evidence[0].id],
      };
    },
  };

  const env = {
    HUNTER_DISCOVERY_ENABLED: "true",
    HUNTER_DISCOVERY_QUERIES: "AI search SaaS",
    HUNTER_DISCOVERY_INTERVAL_MS: String(6 * 60 * 60 * 1000),
    HUNTER_DISCOVERY_LIMIT_PER_QUERY: "10",
    HUNTER_MAX_BUYERS_PER_COMPANY: "3",
    HUNTER_AUTOPILOT_MODE: "assisted",
    HUNTER_DEFAULT_RUN_ID: "run-1",
    HUNTER_MAX_COMPANIES_PER_CYCLE: "10",
  } as NodeJS.ProcessEnv;

  const first = await runHunterAcquisitionCycle(db, {
    env,
    forceDiscovery: true,
    discoveryProviders,
    buyerProviders,
    aiProvider,
    channelHealth: { emailHealthy: true, linkedinHealthy: true },
  });

  assert.equal(first.discovery?.companiesDiscovered, 1);
  assert.equal(first.discovery?.buyersDiscovered, 1);
  assert.equal(first.discovery?.outreachReady, 1);
  assert.equal(first.autopilotTargetsProcessed, 1);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM hunter_message_drafts").get() as { c: number }).c, 2);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM run_profiles").get() as { c: number }).c, 0);

  const second = await runHunterAcquisitionCycle(db, {
    env,
    discoveryProviders,
    buyerProviders,
    aiProvider,
    channelHealth: { emailHealthy: true, linkedinHealthy: true },
  });

  assert.equal(second.discovery, null);
  assert.equal(second.discoverySkippedReason, "not_due");
  assert.equal(second.autopilotTargetsProcessed, 0);
  assert.equal(discoveryCalls, 1);
  assert.equal(aiCalls, 2);
});
