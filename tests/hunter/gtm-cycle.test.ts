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


test("promising companies get Crawl4AI enrichment before qualification", async () => {
  const db = makeDb();
  let crawlCalls = 0;
  const result = await runHunterDiscoveryCycle(db, {
    config: {
      discoveryEnabled: true,
      discoveryQueries: ["B2B SaaS"],
      discoveryIntervalMs: 1,
      limitPerQuery: 10,
      maxBuyersPerCompany: 3,
      autopilotMode: "assisted",
      defaultRunId: null,
      crawl4aiUrl: "http://crawl4ai:11235",
      autoCrawlCompany: true,
      maxCompaniesPerCycle: 10,
    },
    discoveryProviders: [{
      id: "fake-search",
      search: async () => [{
        name: "Acme",
        domain: "acme.com",
        sourceUrl: "https://example.com/acme",
        sourceName: "search",
        evidenceText: "Acme is a B2B SaaS platform.",
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
    crawlClient: {
      crawl: async (url: string) => {
        crawlCalls += 1;
        assert.equal(url, "https://acme.com");
        return {
          domain: "acme.com",
          url: "https://acme.com",
          text: "We are hiring a Head of SEO to own AI Overviews and generative search.",
        };
      },
    },
    now: new Date("2026-09-18T12:00:00.000Z"),
  });

  assert.equal(crawlCalls, 1);
  assert.equal(result.crawlsCompleted, 1);
  assert.equal(result.crawlErrors, 0);
  assert.equal(result.outreachReady, 1);
  const evidence = db.prepare(
    "SELECT source_name, evidence_text FROM hunter_discovery_evidence WHERE company_id = (SELECT id FROM companies WHERE domain = 'acme.com') ORDER BY source_name"
  ).all() as Array<{ source_name: string; evidence_text: string }>;
  assert.equal(evidence.some((row) => row.source_name === "crawl4ai" && row.evidence_text.includes("AI Overviews")), true);
  const signal = db.prepare("SELECT type FROM hunter_signals ORDER BY created_at DESC LIMIT 1").get() as { type: string };
  assert.equal(signal.type, "ai_search_hiring");
});


test("rediscovery never regresses an opportunity that already advanced beyond qualified", async () => {
  const db = makeDb();
  const discoveryProviders = [{
    id: "fake-search",
    search: async () => [{
      name: "Acme",
      domain: "acme.com",
      sourceUrl: "https://acme.com/jobs/seo",
      sourceName: "Acme careers",
      evidenceText: "Acme is a B2B SaaS platform hiring a Head of SEO to own AI Overviews and generative search.",
    }],
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
  const config = {
    discoveryEnabled: true,
    discoveryQueries: ["AI search SaaS"],
    discoveryIntervalMs: 1,
    limitPerQuery: 10,
    maxBuyersPerCompany: 3,
    autopilotMode: "assisted" as const,
    defaultRunId: null,
    crawl4aiUrl: null,
    autoCrawlCompany: false,
    maxCompaniesPerCycle: 10,
  };

  await runHunterDiscoveryCycle(db, { config, discoveryProviders, buyerProviders, now: new Date("2026-09-18T12:00:00.000Z") });
  db.prepare("UPDATE hunter_opportunities SET stage = 'contacted'").run();

  await runHunterDiscoveryCycle(db, { config, discoveryProviders, buyerProviders, now: new Date("2026-09-18T13:00:00.000Z") });
  const opportunity = db.prepare("SELECT stage FROM hunter_opportunities LIMIT 1").get() as { stage: string };
  assert.equal(opportunity.stage, "contacted");
});


test("third-party search surfaces are not persisted or enriched as prospect companies", async () => {
  const db = makeDb();
  const buyerDomains: string[] = [];

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
      id: "search",
      search: async () => [
        {
          name: "Acme Head of SEO job",
          domain: "boards.greenhouse.io",
          sourceUrl: "https://boards.greenhouse.io/acme/jobs/seo",
          sourceName: "search",
          evidenceText: "Acme is hiring a Head of SEO for AI Overviews.",
        },
        {
          name: "Acme raises Series B",
          domain: "techcrunch.com",
          sourceUrl: "https://techcrunch.com/acme-series-b",
          sourceName: "search",
          evidenceText: "Acme raised a Series B.",
        },
        {
          name: "Acme",
          domain: "acme.com",
          sourceUrl: "https://acme.com/blog/ai-search",
          sourceName: "Acme",
          evidenceText: "Acme is a B2B SaaS platform investing in ChatGPT and AI search visibility.",
        },
      ],
    }],
    buyerProviders: [{
      id: "buyer-source",
      findBuyers: async ({ domain }) => {
        buyerDomains.push(domain);
        return [];
      },
    }],
    now: new Date("2026-09-18T12:00:00.000Z"),
  });

  assert.equal(result.companiesDiscovered, 1);
  assert.deepEqual(buyerDomains, ["acme.com"]);
  const companies = db.prepare("SELECT domain FROM companies ORDER BY domain").all() as Array<{ domain: string }>;
  assert.deepEqual(companies, [{ domain: "acme.com" }]);
});
