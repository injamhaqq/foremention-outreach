import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema";
import {
  createHunterDiscoveryStore,
  type PersistedDiscoveryCandidate,
} from "../../lib/hunter/discovery-store";

function db() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE companies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, industry TEXT, location TEXT,
      linkedin_url TEXT, website TEXT, notes TEXT
    );
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, company_id TEXT, full_name TEXT, title TEXT, email TEXT, email_status TEXT,
      linkedin_url TEXT, notes TEXT
    );
  `);
  ensureHunterSchema(database);
  return database;
}

const candidate: PersistedDiscoveryCandidate = {
  name: "Acme",
  domain: "acme.com",
  query: "AI search SaaS",
  provenance: [{
    sourceUrl: "https://acme.com/jobs/seo",
    sourceName: "searxng",
    evidenceText: "Hiring a Head of SEO to own generative search.",
  }],
};

test("discovery store upserts company by normalized domain and preserves evidence idempotently", () => {
  const database = db();
  const store = createHunterDiscoveryStore(database);
  const first = store.upsertCandidate(candidate);
  const second = store.upsertCandidate(candidate);
  assert.equal(first.companyId, second.companyId);
  assert.equal((database.prepare("SELECT COUNT(*) c FROM companies").get() as { c: number }).c, 1);
  assert.equal((database.prepare("SELECT COUNT(*) c FROM hunter_discovery_evidence").get() as { c: number }).c, 1);
});

test("buyer persistence deduplicates by LinkedIn/email and merges reachable channels", () => {
  const database = db();
  const store = createHunterDiscoveryStore(database);
  const { companyId } = store.upsertCandidate(candidate);
  const first = store.upsertBuyer(companyId, {
    fullName: "Jane Doe", role: "Head of SEO", email: null, emailStatus: null,
    linkedinUrl: "https://linkedin.com/in/jane", sourceName: "apollo", providerPersonId: "p1", confidence: 0.8,
  });
  const second = store.upsertBuyer(companyId, {
    fullName: "Jane Doe", role: "Head of SEO", email: "jane@acme.com", emailStatus: "verified",
    linkedinUrl: "https://linkedin.com/in/jane", sourceName: "hunter", providerPersonId: null, confidence: 0.95,
  });
  assert.equal(first.targetId, second.targetId);
  const row = database.prepare("SELECT email, linkedin_url FROM targets WHERE id = ?").get(first.targetId) as { email: string; linkedin_url: string };
  assert.equal(row.email, "jane@acme.com");
  assert.match(row.linkedin_url, /linkedin/);
});

test("source runs record success and failure without erasing prior discovery", () => {
  const database = db();
  const store = createHunterDiscoveryStore(database);
  const run = store.startSourceRun({ providerId: "searxng", query: "AI search SaaS" });
  store.finishSourceRun(run.id, { status: "success", candidateCount: 2 });
  const failed = store.startSourceRun({ providerId: "firecrawl", query: "AI search SaaS" });
  store.finishSourceRun(failed.id, { status: "failed", candidateCount: 0, error: "timeout" });
  const rows = database.prepare("SELECT status FROM hunter_source_runs ORDER BY created_at, id").all() as Array<{ status: string }>;
  assert.deepEqual(new Set(rows.map((row) => row.status)), new Set(["success", "failed"]));
});
