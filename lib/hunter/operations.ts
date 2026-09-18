import type Database from "better-sqlite3";
import { hasVerifiedWorkEmail } from "./contact-verification";
import { summarizeHunterCosts } from "./costs";

type CountRow = { c: number | string | null };
type SumRow = { total: number | string | null };

function count(db: Database.Database, sql: string, ...args: unknown[]) {
  const row = db.prepare(sql).get(...args) as CountRow | undefined;
  return Number(row?.c ?? 0);
}

function sum(db: Database.Database, sql: string, ...args: unknown[]) {
  const row = db.prepare(sql).get(...args) as SumRow | undefined;
  return Number(row?.total ?? 0);
}

function isoDate(now: Date) {
  return now.toISOString().slice(0, 10);
}

function dayStart(now: Date) {
  return `${isoDate(now)}T00:00:00.000Z`;
}

function hoursAgo(now: Date, hours: number) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

type ChannelRow = {
  channel: "email" | "linkedin";
  account_id: string | null;
  healthy: number;
  remaining_capacity: number;
  reasons_json: string;
  measured_at: string;
};

function parseReasons(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function latestChannelHealth(db: Database.Database, channel: "email" | "linkedin") {
  const row = db.prepare(`
    SELECT channel, account_id, healthy, remaining_capacity, reasons_json, measured_at
    FROM hunter_channel_health_snapshots
    WHERE channel = ?
    ORDER BY datetime(measured_at) DESC, datetime(created_at) DESC
    LIMIT 1
  `).get(channel) as ChannelRow | undefined;
  if (!row) {
    return {
      accountId: null,
      healthy: false,
      remainingCapacity: 0,
      reasons: ["not_measured"],
      measuredAt: null,
    };
  }
  return {
    accountId: row.account_id,
    healthy: Boolean(row.healthy),
    remainingCapacity: Number(row.remaining_capacity),
    reasons: parseReasons(row.reasons_json),
    measuredAt: row.measured_at,
  };
}

function verifiedContactCount(db: Database.Database) {
  const rows = db.prepare("SELECT email, email_status FROM targets WHERE email IS NOT NULL").all() as Array<{
    email: string | null;
    email_status: string | null;
  }>;
  return rows.filter((row) => hasVerifiedWorkEmail(row.email, row.email_status)).length;
}

export function loadHunterOperationsSnapshot(db: Database.Database, now = new Date()) {
  const start = dayStart(now);
  const nextDay = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const since24h = hoursAgo(now, 24);

  const accountsMonitored = count(db, `
    SELECT COUNT(DISTINCT company_id) AS c
    FROM hunter_discovery_evidence
    WHERE datetime(last_seen_at) >= datetime(?)
      AND datetime(last_seen_at) < datetime(?)
  `, start, nextDay);

  const newSignals = count(db, `
    SELECT COUNT(*) AS c FROM hunter_signals
    WHERE datetime(created_at) >= datetime(?)
      AND datetime(created_at) < datetime(?)
  `, start, nextDay);

  const buyersDiscovered = count(db, `
    SELECT COUNT(DISTINCT target_id) AS c FROM hunter_buyer_provenance
    WHERE datetime(created_at) >= datetime(?)
      AND datetime(created_at) < datetime(?)
  `, start, nextDay);

  const messagesWaitingApproval = count(db, `
    SELECT COUNT(*) AS c
    FROM hunter_message_drafts d
    LEFT JOIN hunter_approvals a ON a.draft_id = d.id
    WHERE d.status = 'draft'
      AND (a.state IS NULL OR a.state = 'pending')
  `);

  const replies = count(db, `
    SELECT COUNT(*) AS c FROM hunter_reply_classifications
    WHERE datetime(created_at) >= datetime(?)
      AND datetime(created_at) < datetime(?)
  `, start, nextDay);

  const positiveReplies = count(db, `
    SELECT COUNT(*) AS c FROM hunter_reply_classifications
    WHERE lower(classification) = 'positive'
      AND datetime(created_at) >= datetime(?)
      AND datetime(created_at) < datetime(?)
  `, start, nextDay);

  const meetingsOrBeyond = count(db, `
    SELECT COUNT(*) AS c FROM hunter_opportunities
    WHERE stage IN ('meeting_booked','discovery','design_partner','pilot_proposed','pilot_active','paid_pilot','customer','expansion','paid_customer')
  `);

  const activePilotsOrBeyond = count(db, `
    SELECT COUNT(*) AS c FROM hunter_opportunities
    WHERE stage IN ('pilot_active','paid_pilot','customer','expansion','paid_customer')
  `);

  const paidCustomers = count(db, `
    SELECT COUNT(*) AS c FROM hunter_opportunities
    WHERE stage IN ('customer','expansion','paid_customer')
  `);

  const sourceFailures24h = count(db, `
    SELECT COUNT(*) AS c FROM hunter_source_runs
    WHERE status = 'failed'
      AND datetime(started_at) >= datetime(?)
      AND datetime(started_at) <= datetime(?)
  `, since24h, now.toISOString());

  const costSummary = summarizeHunterCosts(db, { start, end: nextDay });

  const approvalRequiredToday = count(db, `
    SELECT COUNT(*) AS c FROM hunter_autopilot_decisions
    WHERE action = 'approval_required'
      AND datetime(decided_at) >= datetime(?)
      AND datetime(decided_at) < datetime(?)
  `, start, nextDay);

  const autoStartedToday = count(db, `
    SELECT COUNT(*) AS c FROM hunter_autopilot_decisions
    WHERE action = 'auto_start'
      AND datetime(decided_at) >= datetime(?)
      AND datetime(decided_at) < datetime(?)
  `, start, nextDay);

  const blockedToday = count(db, `
    SELECT COUNT(*) AS c FROM hunter_autopilot_decisions
    WHERE action = 'blocked'
      AND datetime(decided_at) >= datetime(?)
      AND datetime(decided_at) < datetime(?)
  `, start, nextDay);

  const pendingSalesTasks = count(db, `
    SELECT COUNT(*) AS c FROM hunter_sales_tasks WHERE status = 'pending'
  `);
  const highPrioritySalesTasks = count(db, `
    SELECT COUNT(*) AS c FROM hunter_sales_tasks
    WHERE status = 'pending' AND priority = 'high'
  `);

  return {
    generatedAt: now.toISOString(),
    today: {
      accountsMonitored,
      newSignals,
      buyersDiscovered,
      verifiedContacts: verifiedContactCount(db),
      messagesWaitingApproval,
      replies,
      positiveReplies,
    },
    pipeline: {
      meetingsOrBeyond,
      activePilotsOrBeyond,
      paidCustomers,
    },
    health: {
      sourceFailures24h,
      channels: {
        email: latestChannelHealth(db, "email"),
        linkedin: latestChannelHealth(db, "linkedin"),
      },
    },
    costs: {
      // Backward-compatible name: this is known/reported spend only.
      todayUsd: costSummary.knownUsd,
      knownUsd: costSummary.knownUsd,
      unknownCostEvents: costSummary.unknownCostEvents,
      eventCount: costSummary.eventCount,
      unitsByType: costSummary.unitsByType,
      eventsByProvider: costSummary.eventsByProvider,
    },
    autopilot: {
      approvalRequiredToday,
      autoStartedToday,
      blockedToday,
    },
    salesTasks: {
      pending: pendingSalesTasks,
      highPriority: highPrioritySalesTasks,
    },
  };
}

export type HunterOperationsSnapshot = ReturnType<typeof loadHunterOperationsSnapshot>;
