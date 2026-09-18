import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema.ts";
import { transitionHunterOpportunity, aggregateHunterOutcomeMetrics } from "../../lib/hunter/opportunities.ts";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, domain TEXT);
    CREATE TABLE targets (id TEXT PRIMARY KEY, company_id TEXT, full_name TEXT, title TEXT, email TEXT, linkedin_url TEXT);
    INSERT INTO companies VALUES ('company-1', 'Acme', 'acme.example');
    INSERT INTO targets VALUES ('target-1', 'company-1', 'Jane Doe', 'Head of SEO', 'jane@acme.example', 'https://linkedin.com/in/jane');
  `);
  ensureHunterSchema(db);
  return db;
}

test("opportunity progresses through valid commercial stages", () => {
  const db = makeDb();
  const first = transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "identified" });
  assert.equal(first.stage, "identified");
  const contacted = transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "contacted" });
  assert.equal(contacted.stage, "contacted");
  const meeting = transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "meeting_booked", allowForwardSkip: true });
  assert.equal(meeting.stage, "meeting_booked");
});

test("paid customer is rejected without real commercial evidence", () => {
  const db = makeDb();
  transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "pilot_active", allowForwardSkip: true });
  assert.throws(
    () => transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "paid_customer", allowForwardSkip: true }),
    /commercial evidence/i,
  );
});

test("paid customer accepts explicit commercial evidence and records an outcome", () => {
  const db = makeDb();
  transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "pilot_active", allowForwardSkip: true });
  const result = transitionHunterOpportunity(db, {
    companyId: "company-1",
    targetId: "target-1",
    toStage: "paid_customer",
    allowForwardSkip: true,
    commercialEvidence: [{ type: "payment", reference: "invoice-123", amountUsd: 500 }],
  });
  assert.equal(result.stage, "paid_customer");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM hunter_outcomes WHERE outcome_type = 'paid_customer'").get() as { c: number }).c, 1);
});

test("learning metrics expose numerators and denominators rather than causal claims", () => {
  const db = makeDb();
  transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "paid_customer", allowForwardSkip: true, commercialEvidence: [{ type: "payment", reference: "invoice-123" }] });
  const metrics = aggregateHunterOutcomeMetrics(db);
  assert.equal(typeof metrics.totalOpportunities, "number");
  assert.equal(typeof metrics.paidCustomers, "number");
  assert.equal(typeof metrics.paidCustomerRate.numerator, "number");
  assert.equal(typeof metrics.paidCustomerRate.denominator, "number");
  assert.equal(metrics.paidCustomerRate.denominator, metrics.totalOpportunities);
});


test("paid pilot and customer are distinct commercial stages and both require evidence", () => {
  const db = makeDb();
  transitionHunterOpportunity(db, {
    companyId: "company-1", targetId: "target-1", toStage: "pilot_active", allowForwardSkip: true,
  });

  assert.throws(
    () => transitionHunterOpportunity(db, {
      companyId: "company-1", targetId: "target-1", toStage: "paid_pilot", allowForwardSkip: true,
    }),
    /commercial evidence/i,
  );

  const paidPilot = transitionHunterOpportunity(db, {
    companyId: "company-1",
    targetId: "target-1",
    toStage: "paid_pilot",
    allowForwardSkip: true,
    commercialEvidence: [{ type: "payment", reference: "pilot-invoice-1", amountUsd: 500 }],
  });
  assert.equal(paidPilot.stage, "paid_pilot");

  assert.throws(
    () => transitionHunterOpportunity(db, {
      companyId: "company-1", targetId: "target-1", toStage: "customer",
    }),
    /commercial evidence/i,
  );

  const customer = transitionHunterOpportunity(db, {
    companyId: "company-1",
    targetId: "target-1",
    toStage: "customer",
    commercialEvidence: [{ type: "contract", reference: "msa-1" }],
  });
  assert.equal(customer.stage, "customer");

  const outcomes = db.prepare(
    "SELECT outcome_type FROM hunter_outcomes ORDER BY occurred_at, outcome_type"
  ).all() as Array<{ outcome_type: string }>;
  assert.equal(outcomes.some((row) => row.outcome_type === "paid_pilot"), true);
  assert.equal(outcomes.some((row) => row.outcome_type === "customer"), true);
});

test("canonical pipeline includes qualified, paid pilot, customer, and expansion", () => {
  const db = makeDb();
  transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "identified" });
  transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "qualified" });
  transitionHunterOpportunity(db, { companyId: "company-1", targetId: "target-1", toStage: "contacted" });
  transitionHunterOpportunity(db, {
    companyId: "company-1", targetId: "target-1", toStage: "paid_pilot", allowForwardSkip: true,
    commercialEvidence: [{ type: "payment", reference: "pilot-invoice-2" }],
  });
  transitionHunterOpportunity(db, {
    companyId: "company-1", targetId: "target-1", toStage: "customer",
    commercialEvidence: [{ type: "contract", reference: "msa-2" }],
  });
  const expanded = transitionHunterOpportunity(db, {
    companyId: "company-1", targetId: "target-1", toStage: "expansion",
    commercialEvidence: [{ type: "contract", reference: "expansion-1" }],
  });
  assert.equal(expanded.stage, "expansion");

  const metrics = aggregateHunterOutcomeMetrics(db);
  assert.equal(metrics.paidPilots, 1);
  assert.equal(metrics.customers, 1);
});
