import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

export type HunterUsageUnit = "request" | "token" | "credit" | "email" | "linkedin_action" | "other";

export type HunterProviderUsageEvent = {
  provider: string;
  eventType: string;
  units: number;
  unitType: HunterUsageUnit;
  amountUsd?: number | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
};

export type HunterUsageReporter = (event: HunterProviderUsageEvent) => void;

export function reportHunterUsage(
  reporter: HunterUsageReporter | undefined,
  event: HunterProviderUsageEvent,
) {
  if (!reporter) return;
  try {
    reporter(event);
  } catch {
    // Usage telemetry must never break acquisition execution.
  }
}

function finiteNonNegative(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

export function recordHunterCostEvent(
  db: Database.Database,
  event: HunterProviderUsageEvent & {
    companyId?: string | null;
    targetId?: string | null;
  },
) {
  const provider = event.provider.trim().slice(0, 120);
  const eventType = event.eventType.trim().slice(0, 120);
  if (!provider || !eventType) throw new Error("Hunter cost event requires provider and event type.");

  const units = finiteNonNegative(event.units);
  if (units == null) throw new Error("Hunter cost event units must be a non-negative number.");

  const reportedAmount = event.amountUsd == null ? null : finiteNonNegative(event.amountUsd);
  if (event.amountUsd != null && reportedAmount == null) {
    throw new Error("Hunter cost amount must be a non-negative number when supplied.");
  }

  const costKnown = reportedAmount != null;
  const metadata = {
    ...(event.metadata ?? {}),
    unitType: event.unitType,
    costKnown,
    amountSource: costKnown ? "provider_or_config_reported" : "unknown",
  };

  const occurredAt = event.occurredAt ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO hunter_cost_events (
      id, company_id, target_id, provider, event_type, amount_usd, units, metadata_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    event.companyId ?? null,
    event.targetId ?? null,
    provider,
    eventType,
    reportedAmount ?? 0,
    units,
    JSON.stringify(metadata),
    occurredAt,
  );
}

type CostRow = {
  provider: string;
  event_type: string;
  amount_usd: number;
  units: number;
  metadata_json: string;
};

function metadata(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function summarizeHunterCosts(
  db: Database.Database,
  input: { start: string; end: string },
) {
  const rows = db.prepare(`
    SELECT provider, event_type, amount_usd, units, metadata_json
    FROM hunter_cost_events
    WHERE datetime(occurred_at) >= datetime(?)
      AND datetime(occurred_at) < datetime(?)
    ORDER BY occurred_at ASC
  `).all(input.start, input.end) as CostRow[];

  let knownUsd = 0;
  let unknownCostEvents = 0;
  const unitsByType: Record<string, number> = {};
  const eventsByProvider: Record<string, number> = {};

  for (const row of rows) {
    const meta = metadata(row.metadata_json);
    const costKnown = meta.costKnown === true;
    if (costKnown) knownUsd += Number(row.amount_usd) || 0;
    else unknownCostEvents += 1;

    const unitType = typeof meta.unitType === "string" && meta.unitType.trim()
      ? meta.unitType.trim()
      : "other";
    unitsByType[unitType] = (unitsByType[unitType] ?? 0) + (Number(row.units) || 0);
    eventsByProvider[row.provider] = (eventsByProvider[row.provider] ?? 0) + 1;
  }

  return {
    knownUsd: Math.round(knownUsd * 1_000_000) / 1_000_000,
    unknownCostEvents,
    eventCount: rows.length,
    unitsByType,
    eventsByProvider,
  };
}
