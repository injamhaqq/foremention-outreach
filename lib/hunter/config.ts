import type { HunterAutopilotMode } from "./autopilot";

const DISCOVERY_NOISE_EXCLUSIONS = [
  "-site:linkedin.com",
  "-site:greenhouse.io",
  "-site:lever.co",
  "-site:myworkdayjobs.com",
  "-site:indeed.com",
  "-site:glassdoor.com",
  "-site:wellfound.com",
  "-site:techcrunch.com",
  "-site:prnewswire.com",
  "-site:businesswire.com",
].join(" ");

const DEFAULT_QUERIES = [
  'B2B SaaS hiring "AI Overviews" SEO',
  'B2B SaaS hiring "generative search" SEO',
  'B2B SaaS "GEO" "AEO" organic search',
  'B2B SaaS "ChatGPT" "Perplexity" search visibility',
  'B2B SaaS hiring "Head of SEO" OR "Director of SEO"',
].map((query) => `${query} ${DISCOVERY_NOISE_EXCLUSIONS}`);

function number(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function bool(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function mode(value: string | undefined): HunterAutopilotMode {
  const normalized = String(value || "assisted").trim().toLowerCase();
  return ["manual", "assisted", "guarded_auto", "full_auto"].includes(normalized)
    ? normalized as HunterAutopilotMode
    : "assisted";
}

export function hunterGtmConfigFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const configuredQueries = String(env.HUNTER_DISCOVERY_QUERIES || "")
    .split(";").map((query) => query.trim()).filter(Boolean);
  return {
    discoveryEnabled: bool(env.HUNTER_DISCOVERY_ENABLED, true),
    discoveryQueries: configuredQueries.length ? configuredQueries : DEFAULT_QUERIES,
    discoveryIntervalMs: number(env.HUNTER_DISCOVERY_INTERVAL_MS, 6 * 60 * 60 * 1_000, 5 * 60 * 1_000, 7 * 24 * 60 * 60 * 1_000),
    limitPerQuery: number(env.HUNTER_DISCOVERY_LIMIT_PER_QUERY, 25, 1, 100),
    maxBuyersPerCompany: number(env.HUNTER_MAX_BUYERS_PER_COMPANY, 3, 1, 10),
    autopilotMode: mode(env.HUNTER_AUTOPILOT_MODE),
    defaultRunId: String(env.HUNTER_DEFAULT_RUN_ID || "").trim() || null,
    crawl4aiUrl: String(env.CRAWL4AI_URL || "").trim() || null,
    autoCrawlCompany: bool(env.HUNTER_AUTO_CRAWL_COMPANY, true),
    maxCompaniesPerCycle: number(env.HUNTER_MAX_COMPANIES_PER_CYCLE, 50, 1, 500),
  };
}
