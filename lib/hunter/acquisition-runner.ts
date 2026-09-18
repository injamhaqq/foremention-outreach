import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { hunterAiProviderFromEnv, type HunterAiProvider } from "./ai";
import { processHunterAutopilotTarget } from "./autopilot-execution";
import { configuredBuyerProviders, type HunterBuyerProvider } from "./buyer-providers";
import { evaluateEmailChannelHealth, evaluateLinkedInChannelHealth, type HunterChannelHealth } from "./channel-health";
import { hunterGtmConfigFromEnv } from "./config";
import { recordHunterCostEvent, reportHunterUsage, type HunterUsageReporter } from "./costs";
import { createCrawl4AiClient } from "./crawl4ai";
import type { HunterDiscoveryProvider } from "./discovery";
import { runHunterDiscoveryCycle, type HunterCrawlClient } from "./gtm-cycle";
import { requestForementionMiniAudit } from "./foremention-client";
import type { HunterMiniAuditRequester } from "./mini-audit";
import { ensureHunterSchema } from "./schema";
import { configuredDiscoveryProviders } from "./source-providers";

type RunAccountRow = {
  account_id: string | null;
  email_account_id: string | null;
  is_authenticated: number | null;
  daily_connection_limit: number | null;
  daily_message_limit: number | null;
  daily_inmail_limit: number | null;
  email_is_verified: number | null;
  daily_email_limit: number | null;
  ramp_up_enabled: number | null;
  ramp_start_date: string | null;
};

export type HunterRunChannelHealth = {
  email: HunterChannelHealth;
  linkedin: HunterChannelHealth;
};

export type HunterAcquisitionCycleOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  forceDiscovery?: boolean;
  discoveryProviders?: HunterDiscoveryProvider[];
  buyerProviders?: HunterBuyerProvider[];
  crawlClient?: HunterCrawlClient | null;
  miniAuditRequester?: HunterMiniAuditRequester | null;
  aiProvider?: HunterAiProvider;
  usageReporter?: HunterUsageReporter;
  channelHealth?: { emailHealthy: boolean; linkedinHealthy: boolean };
};

function effectiveEmailLimit(row: RunAccountRow, now: Date) {
  const hardLimit = Math.max(0, Number(row.daily_email_limit ?? 0));
  if (!row.ramp_up_enabled || !row.ramp_start_date) return hardLimit;
  const startedAt = Date.parse(row.ramp_start_date);
  if (!Number.isFinite(startedAt)) return hardLimit;
  const daysActive = Math.max(1, Math.floor((now.getTime() - startedAt) / 86_400_000) + 1);
  return Math.min(hardLimit, daysActive * 2);
}

function withReason(health: HunterChannelHealth, reason: string): HunterChannelHealth {
  return {
    healthy: false,
    remainingCapacity: health.remainingCapacity,
    reasons: [...new Set([...health.reasons, reason])],
  };
}

function persistHealthSnapshot(
  db: Database.Database,
  channel: "email" | "linkedin",
  accountId: string | null,
  health: HunterChannelHealth,
  measuredAt: Date,
) {
  db.prepare(`
    INSERT INTO hunter_channel_health_snapshots (
      id, channel, account_id, healthy, remaining_capacity, reasons_json, measured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    channel,
    accountId,
    health.healthy ? 1 : 0,
    health.remainingCapacity,
    JSON.stringify(health.reasons),
    measuredAt.toISOString(),
  );
}

function resolveRunAccounts(db: Database.Database, runId: string | null): RunAccountRow {
  if (runId) {
    const row = db.prepare(`
      SELECT
        r.account_id,
        r.email_account_id,
        a.is_authenticated,
        a.daily_connection_limit,
        a.daily_message_limit,
        a.daily_inmail_limit,
        ea.is_verified AS email_is_verified,
        ea.daily_email_limit,
        ea.ramp_up_enabled,
        ea.ramp_start_date
      FROM runs r
      LEFT JOIN accounts a ON a.id = r.account_id
      LEFT JOIN email_accounts ea ON ea.id = r.email_account_id
      WHERE r.id = ? AND r.status IN ('pending','running','paused')
      LIMIT 1
    `).get(runId) as RunAccountRow | undefined;
    if (row) return row;
  }

  const account = db.prepare(`
    SELECT id AS account_id, is_authenticated, daily_connection_limit,
           daily_message_limit, daily_inmail_limit
    FROM accounts
    ORDER BY is_authenticated DESC, id ASC
    LIMIT 1
  `).get() as Partial<RunAccountRow> | undefined;
  const email = db.prepare(`
    SELECT id AS email_account_id, is_verified AS email_is_verified, daily_email_limit,
           ramp_up_enabled, ramp_start_date
    FROM email_accounts
    ORDER BY is_verified DESC, id ASC
    LIMIT 1
  `).get() as Partial<RunAccountRow> | undefined;

  return {
    account_id: account?.account_id ?? null,
    email_account_id: email?.email_account_id ?? null,
    is_authenticated: account?.is_authenticated ?? 0,
    daily_connection_limit: account?.daily_connection_limit ?? 0,
    daily_message_limit: account?.daily_message_limit ?? 0,
    daily_inmail_limit: account?.daily_inmail_limit ?? 0,
    email_is_verified: email?.email_is_verified ?? 0,
    daily_email_limit: email?.daily_email_limit ?? 0,
    ramp_up_enabled: email?.ramp_up_enabled ?? 0,
    ramp_start_date: email?.ramp_start_date ?? null,
  };
}

function count(db: Database.Database, sql: string, ...args: unknown[]) {
  return Number((db.prepare(sql).get(...args) as { c?: number } | undefined)?.c ?? 0);
}

export function measureHunterRunChannelHealth(
  db: Database.Database,
  runId: string | null,
  now = new Date(),
): HunterRunChannelHealth {
  ensureHunterSchema(db);
  const row = resolveRunAccounts(db, runId);

  const emailLimit = effectiveEmailLimit(row, now);
  const sent24h = row.email_account_id
    ? count(db, `
        SELECT COUNT(*) AS c
        FROM logs l
        WHERE l.message LIKE 'Email sent%'
          AND datetime(l.created_at) >= datetime('now', '-24 hours')
          AND EXISTS (
            SELECT 1 FROM run_profiles rp
            WHERE rp.run_id = l.run_id
              AND rp.target_id = l.target_id
              AND rp.email_account_id = ?
          )
      `, row.email_account_id)
    : 0;
  const hardBounces24h = row.email_account_id
    ? count(db, `
        SELECT COUNT(*) AS c
        FROM hunter_suppressions s
        WHERE lower(s.kind) = 'bounce'
          AND datetime(s.created_at) >= datetime('now', '-24 hours')
          AND EXISTS (
            SELECT 1 FROM run_profiles rp
            WHERE rp.target_id = s.target_id AND rp.email_account_id = ?
          )
      `, row.email_account_id)
    : 0;
  const complaints24h = row.email_account_id
    ? count(db, `
        SELECT COUNT(*) AS c
        FROM hunter_suppressions s
        WHERE lower(s.kind) = 'complaint'
          AND datetime(s.created_at) >= datetime('now', '-24 hours')
          AND EXISTS (
            SELECT 1 FROM run_profiles rp
            WHERE rp.target_id = s.target_id AND rp.email_account_id = ?
          )
      `, row.email_account_id)
    : 0;
  const emailProviderErrors24h = row.email_account_id
    ? count(db, `
        SELECT COUNT(*) AS c
        FROM logs l
        WHERE l.level = 'error'
          AND lower(l.message) LIKE '%email%'
          AND datetime(l.created_at) >= datetime('now', '-24 hours')
          AND EXISTS (
            SELECT 1 FROM run_profiles rp
            WHERE rp.run_id = l.run_id
              AND rp.target_id = l.target_id
              AND rp.email_account_id = ?
          )
      `, row.email_account_id)
    : 0;

  let email = evaluateEmailChannelHealth({
    sent24h,
    hardBounces24h,
    complaints24h,
    providerErrors24h: emailProviderErrors24h,
    dailyLimit: emailLimit,
  });
  if (!row.email_account_id) email = withReason(email, "email_account_missing");
  else if (!row.email_is_verified) email = withReason(email, "email_account_unverified");

  const linkedinActionsToday = row.account_id
    ? count(db, `
        SELECT COUNT(*) AS c
        FROM logs
        WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
          AND date(created_at) = date('now')
          AND (
            message LIKE 'Connection request sent%'
            OR message LIKE 'Message sent%'
            OR message LIKE 'InMail sent%'
          )
      `, row.account_id)
    : 0;
  const linkedinLimit = Math.max(
    0,
    Number(row.daily_connection_limit ?? 0)
      + Number(row.daily_message_limit ?? 0)
      + Number(row.daily_inmail_limit ?? 0),
  );
  const checkpointDetected = row.account_id
    ? count(db, `
        SELECT COUNT(*) AS c
        FROM logs
        WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
          AND datetime(created_at) >= datetime('now', '-24 hours')
          AND (
            lower(message) LIKE '%checkpoint%'
            OR lower(message) LIKE '%security challenge%'
            OR lower(message) LIKE '%account restricted%'
          )
      `, row.account_id) > 0
    : false;
  const rateLimited = row.account_id
    ? count(db, `
        SELECT COUNT(*) AS c
        FROM logs
        WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
          AND datetime(created_at) >= datetime('now', '-24 hours')
          AND (
            lower(message) LIKE '%rate limit%'
            OR lower(message) LIKE '%too many requests%'
            OR lower(message) LIKE '%http 429%'
          )
      `, row.account_id) > 0
    : false;
  const linkedinErrors24h = row.account_id
    ? count(db, `
        SELECT COUNT(*) AS c
        FROM logs
        WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
          AND level = 'error'
          AND datetime(created_at) >= datetime('now', '-24 hours')
          AND lower(message) NOT LIKE '%email%'
      `, row.account_id)
    : 0;

  let linkedin = evaluateLinkedInChannelHealth({
    actionsToday: linkedinActionsToday,
    dailyLimit: linkedinLimit,
    checkpointDetected,
    rateLimited,
    consecutiveErrors: linkedinErrors24h,
  });
  if (!row.account_id) linkedin = withReason(linkedin, "linkedin_account_missing");
  else if (!row.is_authenticated) linkedin = withReason(linkedin, "linkedin_account_not_authenticated");

  persistHealthSnapshot(db, "email", row.email_account_id, email, now);
  persistHealthSnapshot(db, "linkedin", row.account_id, linkedin, now);
  return { email, linkedin };
}

function parseSqliteTimestamp(value: string | null) {
  if (!value) return null;
  const normalized = /T/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function discoveryDue(db: Database.Database, intervalMs: number, now: Date) {
  const row = db.prepare(`
    SELECT MAX(finished_at) AS last_success
    FROM hunter_source_runs
    WHERE status = 'success' AND finished_at IS NOT NULL
  `).get() as { last_success: string | null } | undefined;
  const last = parseSqliteTimestamp(row?.last_success ?? null);
  return last == null || now.getTime() - last >= intervalMs;
}

function autopilotCandidates(db: Database.Database, limit: number) {
  return db.prepare(`
    WITH ranked AS (
      SELECT
        company_id,
        target_id,
        outreach_ready,
        computed_at,
        created_at,
        ROW_NUMBER() OVER (
          PARTITION BY target_id
          ORDER BY datetime(computed_at) DESC, datetime(created_at) DESC
        ) AS rn
      FROM hunter_scores
      WHERE target_id IS NOT NULL
    )
    SELECT r.company_id, r.target_id
    FROM ranked r
    JOIN targets t ON t.id = r.target_id
    WHERE r.rn = 1
      AND r.outreach_ready = 1
      AND t.last_replied_at IS NULL
      AND t.email_replied_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM hunter_suppressions s
        WHERE s.target_id = r.target_id OR s.company_id = r.company_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM hunter_message_drafts d
        WHERE d.target_id = r.target_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM run_profiles rp
        WHERE rp.target_id = r.target_id
      )
    ORDER BY datetime(r.computed_at) DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(500, limit))) as Array<{ company_id: string; target_id: string }>;
}

export async function runHunterAcquisitionCycle(
  db: Database.Database,
  options: HunterAcquisitionCycleOptions = {},
) {
  ensureHunterSchema(db);
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const usageReporter: HunterUsageReporter = options.usageReporter
    ?? ((event) => recordHunterCostEvent(db, event));
  const config = hunterGtmConfigFromEnv(env);
  const discoveryProviders = options.discoveryProviders ?? configuredDiscoveryProviders(env, usageReporter);
  const buyerProviders = options.buyerProviders ?? configuredBuyerProviders(env, usageReporter);
  const crawlClient = options.crawlClient !== undefined
    ? options.crawlClient
    : config.crawl4aiUrl
      ? createCrawl4AiClient({ baseUrl: config.crawl4aiUrl, apiToken: env.CRAWL4AI_API_TOKEN, onUsage: usageReporter })
      : null;
  const rawMiniAuditRequester = options.miniAuditRequester !== undefined
    ? options.miniAuditRequester
    : env.FOREMENTION_OUTREACH_SECRET?.trim()
      ? async (input: Parameters<HunterMiniAuditRequester>[0]) => requestForementionMiniAudit(input, {
          baseUrl: env.FOREMENTION_OUTREACH_URL,
          secret: env.FOREMENTION_OUTREACH_SECRET,
        })
      : null;
  const miniAuditRequester: HunterMiniAuditRequester | null = rawMiniAuditRequester
    ? async (input) => {
        let ok = false;
        try {
          const result = await rawMiniAuditRequester(input);
          ok = true;
          return result;
        } finally {
          reportHunterUsage(usageReporter, {
            provider: "foremention",
            eventType: "mini_audit_request",
            units: 1,
            unitType: "request",
            metadata: { questionCount: input.questions.length, ok },
          });
        }
      }
    : null;

  let discovery: Awaited<ReturnType<typeof runHunterDiscoveryCycle>> | null = null;
  let discoverySkippedReason: string | null = null;
  const shouldDiscover = options.forceDiscovery || discoveryDue(db, config.discoveryIntervalMs, now);

  if (!config.discoveryEnabled) {
    discoverySkippedReason = "disabled";
  } else if (!shouldDiscover) {
    discoverySkippedReason = "not_due";
  } else if (!discoveryProviders.length) {
    discoverySkippedReason = "no_discovery_providers";
  } else {
    discovery = await runHunterDiscoveryCycle(db, {
      config,
      discoveryProviders,
      buyerProviders,
      crawlClient,
      now,
    });
  }

  const candidates = autopilotCandidates(db, config.maxCompaniesPerCycle);
  if (!candidates.length) {
    return {
      discovery,
      discoverySkippedReason,
      autopilotTargetsProcessed: 0,
      autopilotErrors: 0,
      autopilotSkippedReason: null as string | null,
    };
  }

  let aiProvider: HunterAiProvider;
  try {
    aiProvider = options.aiProvider ?? hunterAiProviderFromEnv(usageReporter);
  } catch {
    return {
      discovery,
      discoverySkippedReason,
      autopilotTargetsProcessed: 0,
      autopilotErrors: 0,
      autopilotSkippedReason: "ai_provider_not_configured",
    };
  }

  const measured = options.channelHealth
    ? null
    : measureHunterRunChannelHealth(db, config.defaultRunId, now);
  const emailHealthy = options.channelHealth?.emailHealthy ?? Boolean(measured?.email.healthy);
  const linkedinHealthy = options.channelHealth?.linkedinHealthy ?? Boolean(measured?.linkedin.healthy);

  let autopilotTargetsProcessed = 0;
  let autopilotErrors = 0;
  for (const candidate of candidates) {
    try {
      await processHunterAutopilotTarget(db, {
        companyId: candidate.company_id,
        targetId: candidate.target_id,
        mode: config.autopilotMode,
        runId: config.defaultRunId,
        emailHealthy,
        linkedinHealthy,
        aiProvider,
        miniAuditRequester: miniAuditRequester ?? undefined,
        now,
      });
      autopilotTargetsProcessed += 1;
    } catch (error) {
      autopilotErrors += 1;
      console.warn(
        `[hunter] autopilot target failed company=${candidate.company_id} target=${candidate.target_id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return {
    discovery,
    discoverySkippedReason,
    autopilotTargetsProcessed,
    autopilotErrors,
    autopilotSkippedReason: null as string | null,
  };
}
