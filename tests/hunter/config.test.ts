import assert from "node:assert/strict";
import test from "node:test";
import { hunterGtmConfigFromEnv } from "../../lib/hunter/config";

test("GTM config uses safe defaults and parses semicolon-separated queries", () => {
  const config = hunterGtmConfigFromEnv({
    HUNTER_DISCOVERY_QUERIES: "query one; query two ;",
    HUNTER_AUTOPILOT_MODE: "guarded_auto",
    HUNTER_DISCOVERY_LIMIT_PER_QUERY: "17",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(config.discoveryQueries, ["query one", "query two"]);
  assert.equal(config.autopilotMode, "guarded_auto");
  assert.equal(config.limitPerQuery, 17);
});

test("unknown autopilot mode falls back to assisted instead of silently going fully autonomous", () => {
  const config = hunterGtmConfigFromEnv({ HUNTER_AUTOPILOT_MODE: "yolo" } as NodeJS.ProcessEnv);
  assert.equal(config.autopilotMode, "assisted");
});


test("default discovery queries suppress obvious third-party result surfaces", () => {
  const config = hunterGtmConfigFromEnv({} as NodeJS.ProcessEnv);
  assert.equal(config.discoveryQueries.length >= 5, true);
  for (const query of config.discoveryQueries) {
    assert.match(query, /-site:linkedin\.com/);
    assert.match(query, /-site:greenhouse\.io/);
    assert.match(query, /-site:lever\.co/);
    assert.match(query, /-site:indeed\.com/);
  }
});
