import type Database from "better-sqlite3";
import { evaluateHunterPersistenceReadiness } from "./persistence-readiness";
import { isFirecrawlDiscoveryConfigured } from "./source-providers";

function value(env: NodeJS.ProcessEnv, key: string) {
  return String(env[key] || "").trim();
}

function any(...values: string[]) {
  return values.some((item) => Boolean(item.trim()));
}

function aiConfigured(env: NodeJS.ProcessEnv) {
  const explicit = value(env, "HUNTER_AI_BASE_URL")
    && value(env, "HUNTER_AI_API_KEY")
    && value(env, "HUNTER_AI_MODEL");
  if (explicit) return true;

  const provider = (value(env, "HUNTER_AI_PROVIDER") || "groq").toLowerCase();
  if (provider === "groq") {
    return any(value(env, "HUNTER_AI_API_KEY"), value(env, "GROQ_API_KEY"))
      && any(value(env, "HUNTER_AI_MODEL"), value(env, "GROQ_MODEL"));
  }
  if (provider === "openrouter") {
    return any(value(env, "HUNTER_AI_API_KEY"), value(env, "OPENROUTER_API_KEY"))
      && any(value(env, "HUNTER_AI_MODEL"), value(env, "OPENROUTER_MODEL"));
  }
  if (provider === "openai") {
    return any(value(env, "HUNTER_AI_API_KEY"), value(env, "OPENAI_API_KEY"))
      && any(value(env, "HUNTER_AI_MODEL"), value(env, "OPENAI_MODEL"));
  }
  if (provider === "ollama") {
    return any(value(env, "HUNTER_AI_MODEL"), value(env, "OLLAMA_MODEL"));
  }
  return false;
}

function tableCount(db: Database.Database, sql: string, ...args: unknown[]) {
  try {
    return Number((db.prepare(sql).get(...args) as { c?: number } | undefined)?.c ?? 0);
  } catch {
    return 0;
  }
}

function activeRun(db: Database.Database, runId: string) {
  if (!runId) return false;
  try {
    const row = db.prepare("SELECT status FROM runs WHERE id = ? LIMIT 1").get(runId) as { status?: string } | undefined;
    return Boolean(row && ["pending", "running", "paused"].includes(String(row.status)));
  } catch {
    return false;
  }
}

export function evaluateHunterReadiness(
  db: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
) {
  const persistence = evaluateHunterPersistenceReadiness(db, env);

  const discoveryReasons: string[] = [];
  const discoveryEnabled = value(env, "HUNTER_DISCOVERY_ENABLED").toLowerCase() !== "false";
  const firecrawlConfigured = isFirecrawlDiscoveryConfigured(env);
  const discoveryProviderConfigured = Boolean(value(env, "SEARXNG_URL")) || firecrawlConfigured;
  if (!discoveryEnabled) discoveryReasons.push("discovery_disabled");
  if (!discoveryProviderConfigured) discoveryReasons.push("no_discovery_provider");

  const buyerReasons: string[] = [];
  const buyerProviderConfigured = any(
    value(env, "HUNTER_API_KEY"),
    value(env, "APOLLO_API_KEY"),
    value(env, "PROSPEO_API_KEY"),
    value(env, "SEARXNG_URL"),
  );
  if (!buyerProviderConfigured) buyerReasons.push("no_buyer_provider");

  const aiReasons: string[] = [];
  const isAiConfigured = aiConfigured(env);
  if (!isAiConfigured) aiReasons.push("ai_provider_not_configured");

  const miniAuditReasons: string[] = [];
  const miniAuditReady = Boolean(value(env, "FOREMENTION_OUTREACH_SECRET"));
  if (!miniAuditReady) miniAuditReasons.push("foremention_mini_audit_secret_missing");

  const authenticatedLinkedInAccounts = tableCount(
    db,
    "SELECT COUNT(*) AS c FROM accounts WHERE is_authenticated = 1",
  );
  const verifiedEmailAccounts = tableCount(
    db,
    "SELECT COUNT(*) AS c FROM email_accounts WHERE is_verified = 1",
  );
  const runId = value(env, "HUNTER_DEFAULT_RUN_ID");
  const runReady = activeRun(db, runId);
  const executionReasons: string[] = [];
  if (authenticatedLinkedInAccounts + verifiedEmailAccounts === 0) executionReasons.push("no_outreach_channel");
  if (!runId) executionReasons.push("default_run_not_configured");
  else if (!runReady) executionReasons.push("default_run_not_active");

  const discovery = {
    ready: discoveryReasons.length === 0,
    reasons: discoveryReasons,
    providers: {
      searxng: Boolean(value(env, "SEARXNG_URL")),
      firecrawl: firecrawlConfigured,
      crawl4ai: Boolean(value(env, "CRAWL4AI_URL")),
    },
  };
  const buyers = {
    ready: buyerReasons.length === 0,
    reasons: buyerReasons,
    providers: {
      hunter: Boolean(value(env, "HUNTER_API_KEY")),
      apollo: Boolean(value(env, "APOLLO_API_KEY")),
      prospeo: Boolean(value(env, "PROSPEO_API_KEY")),
      searxng: Boolean(value(env, "SEARXNG_URL")),
    },
  };
  const ai = {
    ready: aiReasons.length === 0,
    reasons: aiReasons,
    provider: value(env, "HUNTER_AI_PROVIDER") || "groq",
  };
  const forementionMiniAudit = {
    ready: miniAuditReady,
    reasons: miniAuditReasons,
    url: value(env, "FOREMENTION_OUTREACH_URL") || "https://foremention.com",
  };
  const execution = {
    ready: executionReasons.length === 0,
    reasons: executionReasons,
    defaultRunId: runId || null,
    channels: {
      verifiedEmailAccounts,
      authenticatedLinkedInAccounts,
    },
    autopilotMode: value(env, "HUNTER_AUTOPILOT_MODE") || "assisted",
  };

  // External AI improves research and enables Foremention-native mini-audits,
  // but evidence-only drafting keeps the assisted launch path functional.
  const assistedLaunchReady = persistence.ready && discovery.ready && buyers.ready && execution.ready;
  const fullyReady = assistedLaunchReady && ai.ready && forementionMiniAudit.ready;

  return {
    generatedAt: new Date().toISOString(),
    persistence,
    discovery,
    buyers,
    ai,
    forementionMiniAudit,
    execution,
    canary: {
      enabled: /^(1|true|yes|on)$/i.test(value(env, "HUNTER_CANARY_ENABLED")),
      mode: "assisted" as const,
      hardCaps: {
        discoveryQueries: 1,
        resultsPerQuery: 5,
        companies: 2,
        buyersPerCompany: 2,
        autoSend: false,
      },
    },
    assistedLaunchReady,
    fullyReady,
  };
}

export type HunterReadiness = ReturnType<typeof evaluateHunterReadiness>;
