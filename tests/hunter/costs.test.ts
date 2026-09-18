import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { recordHunterCostEvent, summarizeHunterCosts } from "../../lib/hunter/costs";
import { ensureHunterSchema } from "../../lib/hunter/schema";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, domain TEXT);
    CREATE TABLE targets (id TEXT PRIMARY KEY, company_id TEXT);
  `);
  ensureHunterSchema(db);
  return db;
}

test("unknown provider pricing is tracked as usage without pretending zero-dollar cost", () => {
  const db = makeDb();
  recordHunterCostEvent(db, {
    provider: "apollo",
    eventType: "people_search",
    units: 1,
    unitType: "request",
    occurredAt: "2026-09-18T10:00:00.000Z",
  });

  const summary = summarizeHunterCosts(db, {
    start: "2026-09-18T00:00:00.000Z",
    end: "2026-09-19T00:00:00.000Z",
  });
  assert.equal(summary.knownUsd, 0);
  assert.equal(summary.unknownCostEvents, 1);
  assert.equal(summary.unitsByType.request, 1);
  assert.equal(summary.eventsByProvider.apollo, 1);
});

test("provider-reported monetary cost is summed separately from unknown-cost usage", () => {
  const db = makeDb();
  recordHunterCostEvent(db, {
    provider: "openrouter",
    eventType: "chat_completion",
    units: 1200,
    unitType: "token",
    amountUsd: 0.0042,
    occurredAt: "2026-09-18T11:00:00.000Z",
    metadata: { model: "example/model" },
  });
  recordHunterCostEvent(db, {
    provider: "firecrawl",
    eventType: "search_request",
    units: 1,
    unitType: "request",
    occurredAt: "2026-09-18T11:05:00.000Z",
  });

  const summary = summarizeHunterCosts(db, {
    start: "2026-09-18T00:00:00.000Z",
    end: "2026-09-19T00:00:00.000Z",
  });
  assert.equal(summary.knownUsd, 0.0042);
  assert.equal(summary.unknownCostEvents, 1);
  assert.equal(summary.unitsByType.token, 1200);
  assert.equal(summary.unitsByType.request, 1);
});
