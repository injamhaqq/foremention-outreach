import type Database from "better-sqlite3";
import {
  runHunterAcquisitionCycle,
  type HunterAcquisitionCycleOptions,
} from "./acquisition-runner";

const DEFAULT_CANARY_QUERY = 'B2B SaaS hiring "AI Overviews" SEO';

function firstQuery(env: NodeJS.ProcessEnv) {
  const configured = String(env.HUNTER_CANARY_QUERY || env.HUNTER_DISCOVERY_QUERIES || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured[0] || DEFAULT_CANARY_QUERY;
}

export function hunterAssistedCanaryEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    HUNTER_AUTOPILOT_MODE: "assisted",
    HUNTER_DISCOVERY_ENABLED: "true",
    HUNTER_DISCOVERY_QUERIES: firstQuery(env),
    HUNTER_DISCOVERY_LIMIT_PER_QUERY: "5",
    HUNTER_MAX_COMPANIES_PER_CYCLE: "2",
    HUNTER_MAX_BUYERS_PER_COMPANY: "2",
  };
}

export async function runHunterAssistedCanary(
  db: Database.Database,
  options: Omit<HunterAcquisitionCycleOptions, "env" | "forceDiscovery"> & {
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const env = hunterAssistedCanaryEnv(options.env ?? process.env);
  return runHunterAcquisitionCycle(db, {
    ...options,
    env,
    forceDiscovery: true,
  });
}
