import assert from "node:assert/strict";
import test from "node:test";
import { hunterAssistedCanaryEnv } from "../../lib/hunter/canary";

test("assisted canary hard-caps acquisition volume and cannot inherit auto-send mode", () => {
  const env = hunterAssistedCanaryEnv({
    HUNTER_AUTOPILOT_MODE: "full_auto",
    HUNTER_DISCOVERY_QUERIES: "query one;query two;query three",
    HUNTER_DISCOVERY_LIMIT_PER_QUERY: "100",
    HUNTER_MAX_COMPANIES_PER_CYCLE: "500",
    HUNTER_MAX_BUYERS_PER_COMPANY: "10",
  } as NodeJS.ProcessEnv);

  assert.equal(env.HUNTER_AUTOPILOT_MODE, "assisted");
  assert.equal(env.HUNTER_DISCOVERY_ENABLED, "true");
  assert.equal(env.HUNTER_DISCOVERY_QUERIES, "query one");
  assert.equal(env.HUNTER_DISCOVERY_LIMIT_PER_QUERY, "5");
  assert.equal(env.HUNTER_MAX_COMPANIES_PER_CYCLE, "2");
  assert.equal(env.HUNTER_MAX_BUYERS_PER_COMPANY, "2");
});

test("assisted canary uses a narrow default query when no discovery query is configured", () => {
  const env = hunterAssistedCanaryEnv({} as NodeJS.ProcessEnv);
  assert.match(String(env.HUNTER_DISCOVERY_QUERIES), /B2B SaaS/i);
});
