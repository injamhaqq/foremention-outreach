import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema.ts";
import { createHunterRepository } from "../../lib/hunter/repository.ts";

function createDatabase() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT
    );
    CREATE TABLE targets (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      full_name TEXT,
      title TEXT,
      email TEXT,
      linkedin_url TEXT
    );
    INSERT INTO companies (id, name, domain) VALUES ('company-1', 'Acme', 'acme.example');
    INSERT INTO targets (id, company_id, full_name, title, email, linkedin_url)
    VALUES ('target-1', 'company-1', 'Jane Doe', 'Head of SEO', 'jane@acme.example', 'https://linkedin.com/in/jane');
  `);
  ensureHunterSchema(db);
  return db;
}

test("upserting the same signal twice is idempotent and refreshes evidence", () => {
  const db = createDatabase();
  const repository = createHunterRepository(db);

  const input = {
    companyId: "company-1",
    targetId: "target-1",
    type: "ai_search_hiring" as const,
    title: "Hiring Director of Organic Search",
    summary: "Role mentions generative search and AI Overviews.",
    sourceUrl: "https://acme.example/jobs/organic-search#details",
    sourceName: "Acme careers",
    evidenceText: "Own strategy for AI Overviews and generative search.",
    observedAt: "2026-09-16T10:00:00.000Z",
    publishedAt: "2026-09-15T00:00:00.000Z",
    expiresAt: "2026-10-16T00:00:00.000Z",
    confidence: 0.95,
    scoreContribution: 20,
  };

  const first = repository.upsertHunterSignal(input);
  const second = repository.upsertHunterSignal({
    ...input,
    sourceUrl: "https://ACME.example/jobs/organic-search#updated",
    evidenceText: "Updated: own AI Overviews, ChatGPT, and generative search strategy.",
    observedAt: "2026-09-16T12:00:00.000Z",
  });

  assert.equal(first.id, second.id);
  const signals = repository.listSignalsForCompany("company-1");
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.evidenceText.includes("ChatGPT"), true);
  assert.equal(signals[0]?.observedAt, "2026-09-16T12:00:00.000Z");

  db.close();
});

test("first-touch draft fingerprint is unique per target and channel", () => {
  const db = createDatabase();
  const repository = createHunterRepository(db);

  const first = repository.saveHunterDraft({
    targetId: "target-1",
    companyId: "company-1",
    channel: "email",
    subject: "AI search at Acme",
    body: "One evidence-backed first touch.",
    evidenceIds: ["signal-1"],
    firstTouchFingerprint: "target-1:email:signal-1",
  });
  const second = repository.saveHunterDraft({
    targetId: "target-1",
    companyId: "company-1",
    channel: "email",
    subject: "Changed subject",
    body: "Changed body should update the same first-touch draft.",
    evidenceIds: ["signal-1"],
    firstTouchFingerprint: "target-1:email:signal-1",
  });

  assert.equal(first.id, second.id);
  assert.equal(repository.listDraftsForTarget("target-1").length, 1);

  db.close();
});
