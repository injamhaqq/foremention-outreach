import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";

export const HUNTER_OPPORTUNITY_STAGES = [
  "identified",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "meeting_booked",
  "discovery",
  "design_partner",
  "pilot_proposed",
  "pilot_active",
  "paid_pilot",
  "customer",
  "expansion",
  "lost",
  // Legacy stage retained for existing rows and historical imports.
  "paid_customer",
] as const;

export type HunterOpportunityStage = typeof HUNTER_OPPORTUNITY_STAGES[number];

export type HunterCommercialEvidence = Record<string, unknown> & { type: string; reference?: string };

const CANONICAL_ORDER: HunterOpportunityStage[] = [
  "identified",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "meeting_booked",
  "discovery",
  "design_partner",
  "pilot_proposed",
  "pilot_active",
  "paid_pilot",
  "customer",
  "expansion",
];

function stableOpportunityId(companyId: string, targetId?: string | null) {
  return `hop_${createHash("sha256").update(`${companyId}|${targetId ?? "company"}`).digest("hex").slice(0, 24)}`;
}

function asEvidence(value: HunterCommercialEvidence[] | undefined) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && typeof item.type === "string" && item.type.trim())
    : [];
}

function commercialStageIndex(stage: HunterOpportunityStage) {
  if (stage === "paid_customer") return CANONICAL_ORDER.indexOf("customer");
  if (stage === "lost") return Number.POSITIVE_INFINITY;
  return CANONICAL_ORDER.indexOf(stage);
}

function nextActionFor(stage: HunterOpportunityStage) {
  switch (stage) {
    case "identified": return "Validate fit, pain or intent evidence, and buyer";
    case "qualified": return "Research buyer and prepare first touch";
    case "contacted": return "Monitor replies and sequence progress";
    case "replied": return "Respond personally";
    case "interested": return "Book a meeting";
    case "meeting_booked": return "Prepare discovery and Foremention evidence";
    case "discovery": return "Agree design-partner or pilot next step";
    case "design_partner": return "Run comparable Foremention cycle";
    case "pilot_proposed": return "Confirm pilot scope and commercial terms";
    case "pilot_active": return "Deliver pilot and document value";
    case "paid_pilot": return "Deliver paid pilot and agree customer conversion criteria";
    case "customer":
    case "paid_customer": return "Onboard, retain, and prove recurring value";
    case "expansion": return "Deliver expansion and document retained value";
    case "lost": return "Record loss reason";
  }
}

function defaultDueAt(stage: HunterOpportunityStage) {
  if (stage === "customer" || stage === "paid_customer" || stage === "expansion" || stage === "lost") return null;
  const days = stage === "contacted" ? 3 : stage === "design_partner" || stage === "pilot_active" || stage === "paid_pilot" ? 7 : 2;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function requiresCommercialEvidence(stage: HunterOpportunityStage) {
  return stage === "paid_pilot"
    || stage === "customer"
    || stage === "paid_customer"
    || stage === "expansion";
}

function recordsOutcome(stage: HunterOpportunityStage) {
  return [
    "meeting_booked",
    "design_partner",
    "pilot_active",
    "paid_pilot",
    "customer",
    "paid_customer",
    "expansion",
    "lost",
  ].includes(stage);
}

function maySkipCompatibilityStage(from: HunterOpportunityStage, to: HunterOpportunityStage) {
  // Existing Outreach flows historically moved identified -> contacted before the
  // explicit qualified stage existed. Keep that path valid while new flows can
  // record qualified as a first-class stage.
  return from === "identified" && to === "contacted";
}

export function transitionHunterOpportunity(db: Database.Database, input: {
  companyId: string;
  targetId?: string | null;
  toStage: HunterOpportunityStage;
  allowForwardSkip?: boolean;
  nextAction?: string | null;
  nextActionDueAt?: string | null;
  commercialEvidence?: HunterCommercialEvidence[];
}) {
  if (!HUNTER_OPPORTUNITY_STAGES.includes(input.toStage)) throw new Error("Invalid opportunity stage.");
  const evidence = asEvidence(input.commercialEvidence);
  if (requiresCommercialEvidence(input.toStage) && evidence.length === 0) {
    throw new Error(`${input.toStage.replaceAll("_", " ")} requires real commercial evidence.`);
  }

  const dedupeKey = `${input.companyId}|${input.targetId ?? "company"}`;
  const id = stableOpportunityId(input.companyId, input.targetId);
  const existing = db.prepare("SELECT stage, commercial_evidence_json FROM hunter_opportunities WHERE dedupe_key = ?").get(dedupeKey) as
    | { stage: HunterOpportunityStage; commercial_evidence_json: string }
    | undefined;

  if (existing && input.toStage !== "lost") {
    const fromIndex = commercialStageIndex(existing.stage);
    const toIndex = commercialStageIndex(input.toStage);
    if (existing.stage === "lost") throw new Error("Lost opportunity must be reopened explicitly.");
    if (Number.isFinite(fromIndex) && Number.isFinite(toIndex) && toIndex < fromIndex) {
      throw new Error("Opportunity stage cannot move backward.");
    }
    if (
      !input.allowForwardSkip
      && Number.isFinite(fromIndex)
      && Number.isFinite(toIndex)
      && toIndex > fromIndex + 1
      && !maySkipCompatibilityStage(existing.stage, input.toStage)
    ) {
      throw new Error("Opportunity stage transition skips required stages.");
    }
  }

  const previousEvidence = existing?.commercial_evidence_json
    ? (() => { try { return JSON.parse(existing.commercial_evidence_json) as HunterCommercialEvidence[]; } catch { return []; } })()
    : [];
  const combinedEvidence = evidence.length ? [...previousEvidence, ...evidence] : previousEvidence;
  const nextAction = input.nextAction ?? nextActionFor(input.toStage);
  const nextActionDueAt = input.nextActionDueAt === undefined ? defaultDueAt(input.toStage) : input.nextActionDueAt;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO hunter_opportunities (
        id, company_id, target_id, dedupe_key, stage, next_action, next_action_due_at,
        commercial_evidence_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(dedupe_key) DO UPDATE SET
        stage = excluded.stage,
        next_action = excluded.next_action,
        next_action_due_at = excluded.next_action_due_at,
        commercial_evidence_json = excluded.commercial_evidence_json,
        updated_at = datetime('now')
    `).run(
      id,
      input.companyId,
      input.targetId ?? null,
      dedupeKey,
      input.toStage,
      nextAction,
      nextActionDueAt,
      JSON.stringify(combinedEvidence),
    );

    if (recordsOutcome(input.toStage)) {
      const outcomeKey = `${id}|${input.toStage}`;
      const outcomeId = `hout_${createHash("sha256").update(outcomeKey).digest("hex").slice(0, 24)}`;
      db.prepare(`
        INSERT OR IGNORE INTO hunter_outcomes (id, opportunity_id, outcome_type, evidence_json, occurred_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        outcomeId,
        id,
        input.toStage,
        JSON.stringify({ commercialEvidence: combinedEvidence }),
        new Date().toISOString(),
      );
    }
  })();

  return {
    id,
    companyId: input.companyId,
    targetId: input.targetId ?? null,
    stage: input.toStage,
    nextAction,
    nextActionDueAt,
    commercialEvidence: combinedEvidence,
  };
}

export function recordHunterOutcome(db: Database.Database, input: {
  opportunityId: string;
  outcomeType: string;
  evidence?: Record<string, unknown>;
  occurredAt?: string;
}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO hunter_outcomes (id, opportunity_id, outcome_type, evidence_json, occurred_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.opportunityId, input.outcomeType, JSON.stringify(input.evidence ?? {}), input.occurredAt ?? new Date().toISOString());
  return { id };
}

export function aggregateHunterOutcomeMetrics(db: Database.Database) {
  const totalOpportunities = Number((db.prepare("SELECT COUNT(*) c FROM hunter_opportunities").get() as { c: number }).c);
  const customers = Number((db.prepare(`
    SELECT COUNT(*) c FROM hunter_opportunities
    WHERE stage IN ('customer','expansion','paid_customer')
  `).get() as { c: number }).c);
  const paidPilots = Number((db.prepare(`
    SELECT COUNT(*) c FROM hunter_opportunities
    WHERE stage IN ('paid_pilot','customer','expansion','paid_customer')
  `).get() as { c: number }).c);
  const meetingBookedOrBeyond = Number((db.prepare(`
    SELECT COUNT(*) c FROM hunter_opportunities
    WHERE stage IN (
      'meeting_booked','discovery','design_partner','pilot_proposed','pilot_active',
      'paid_pilot','customer','expansion','paid_customer'
    )
  `).get() as { c: number }).c);
  const repliedOrBeyond = Number((db.prepare(`
    SELECT COUNT(*) c FROM hunter_opportunities
    WHERE stage IN (
      'replied','interested','meeting_booked','discovery','design_partner','pilot_proposed',
      'pilot_active','paid_pilot','customer','expansion','paid_customer'
    )
  `).get() as { c: number }).c);

  const rate = (numerator: number, denominator: number) => ({
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : 0,
  });

  return {
    totalOpportunities,
    paidPilots,
    customers,
    // Backward-compatible field name for older dashboard consumers.
    paidCustomers: customers,
    repliedOrBeyond,
    meetingBookedOrBeyond,
    replyRate: rate(repliedOrBeyond, totalOpportunities),
    meetingRate: rate(meetingBookedOrBeyond, totalOpportunities),
    paidPilotRate: rate(paidPilots, totalOpportunities),
    customerRate: rate(customers, totalOpportunities),
    paidCustomerRate: rate(customers, totalOpportunities),
    note: "Observed conversion metrics describe association in recorded outreach data; they do not establish causation.",
  };
}

export function listHunterOpportunities(db: Database.Database) {
  return db.prepare(`
    SELECT
      o.id, o.company_id, o.target_id, o.stage, o.next_action, o.next_action_due_at,
      o.commercial_evidence_json, o.created_at, o.updated_at,
      c.name AS company_name, c.domain,
      t.full_name AS buyer_name, t.title AS buyer_role, t.email, t.linkedin_url
    FROM hunter_opportunities o
    JOIN companies c ON c.id = o.company_id
    LEFT JOIN targets t ON t.id = o.target_id
    ORDER BY
      CASE o.stage
        WHEN 'expansion' THEN 1
        WHEN 'customer' THEN 2
        WHEN 'paid_customer' THEN 2
        WHEN 'paid_pilot' THEN 3
        WHEN 'pilot_active' THEN 4
        WHEN 'pilot_proposed' THEN 5
        WHEN 'design_partner' THEN 6
        WHEN 'discovery' THEN 7
        WHEN 'meeting_booked' THEN 8
        WHEN 'interested' THEN 9
        WHEN 'replied' THEN 10
        WHEN 'contacted' THEN 11
        WHEN 'qualified' THEN 12
        WHEN 'identified' THEN 13
        ELSE 14
      END,
      o.updated_at DESC
  `).all();
}
