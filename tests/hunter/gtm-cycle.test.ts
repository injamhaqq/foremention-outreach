import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema";
import { runHunterDiscoveryCycle } from "../../lib/hunter/gtm-cycle";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, industry TEXT, location TEXT,
      linkedin_url TEXT, website TEXT, notes TEXT
    );
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, company_id TEXT, full_name TEXT, title TEXT, email TEXT, email_status TEXT,
      linkedin_url TEXT, notes TEXT
    );
  `);
  ensureHunterSchema(db);
  return db;
}

test("one discovery cycle turns evidence into company, signal, buyer, and easy qualification", async () => {
  const db = makeDb();
  const result = await runHunterDiscoveryCycle(db, {
    config: {
      discoveryEnabled: true,
      discoveryQueries: ["AI search SaaS"],
      discoveryIntervalMs: 1,
      limitPerQuery: 10,
      maxBuyersPerCompany: 3,
      autopilotMode: "assisted",
      defaultRunId: null,
      crawl4aiUrl: null,
      autoCrawlCompany: false,
      maxCompaniesPerCycle: 10,
    },
    discoveryProviders: [{
      id: "fake-search",
      search: async () => [{
        name: "Acme",
        domain: "acme.com",
        sourceUrl: "https://acme.com/jobs/seo",
        sourceName: "Acme careers",
        evidenceText: "Acme is a B2B SaaS platform hiring a Head of SEO to own AI Overviews and generative search.",
      }],
    }],
    buyerProviders: [{
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
    }],
    now: new Date("2026-09-18T12:00:00.000Z"),
  });

  assert.equal(result.companiesDiscovered, 1);
  assert.equal(result.buyersDiscovered, 1);
  assert.equal(result.outreachReady, 1);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM hunter_signals").get() as { c: number }).c >= 1, true);
  const score = db.prepare("SELECT outreach_ready, reason FROM hunter_scores ORDER BY created_at DESC LIMIT 1").get() as { outreach_ready: number; reason: string };
  assert.equal(score.outreach_ready, 1);
  assert.equal(score.reason, "TWO_SIGNAL_RULE");
});

test("source failure is recorded while other sources still feed the pipeline", async () => {
  const db = makeDb();
  const result = await runHunterDiscoveryCycle(db, {
    config: {
      discoveryEnabled: true,
      discoveryQueries: ["AI search SaaS"],
      discoveryIntervalMs: 1,
      limitPerQuery: 10,
      maxBuyersPerCompany: 3,
      autopilotMode: "assisted",
      defaultRunId: null,
      crawl4aiUrl: null,
      autoCrawlCompany: false,
      maxCompaniesPerCycle: 10,
    },
    discoveryProviders: [
      { id: "broken", search: async () => { throw new Error("down"); } },
      {
        id: "healthy",
        search: async () => [{
          name: "Beta",
          domain: "beta.com",
          sourceUrl: "https://beta.com/blog/ai-search",
          sourceName: "Beta",
          evidenceText: "Beta is a B2B software platform investing in ChatGPT and AI search visibility.",
        }],
      },
    ],
    buyerProviders: [],
    now: new Date("2026-09-18T12:00:00.000Z"),
  });
  assert.equal(result.sourceErrors, 1);
  assert.equal(result.companiesDiscovered, 1);
  const statuses = db.prepare("SELECT status FROM hunter_source_runs").all() as Array<{status:string}>;
  assert.equal(statuses.some((row) => row.status === "failed"), true);
  assert.equal(statuses.some((row) => row.status === "success"), true);
});
