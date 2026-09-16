import test from "node:test";
import assert from "node:assert/strict";
import { rankHunterFeed } from "../../lib/hunter/feed.ts";

test("buyer feed orders priority before good cold, cold fit, then monitor", () => {
  const ranked = rankHunterFeed([
    { id: "monitor", route: "monitor", observedAt: "2026-09-16T10:00:00.000Z", totalScore: 95 },
    { id: "cold", route: "cold_fit", observedAt: "2026-09-16T12:00:00.000Z", totalScore: 50 },
    { id: "priority", route: "priority", observedAt: "2026-09-15T12:00:00.000Z", totalScore: 60 },
    { id: "good", route: "good_cold", observedAt: "2026-09-16T11:00:00.000Z", totalScore: 70 },
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["priority", "good", "cold", "monitor"]);
});

test("freshness wins within the same route before score", () => {
  const ranked = rankHunterFeed([
    { id: "older-high", route: "good_cold", observedAt: "2026-09-15T12:00:00.000Z", totalScore: 99 },
    { id: "newer-low", route: "good_cold", observedAt: "2026-09-16T12:00:00.000Z", totalScore: 55 },
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["newer-low", "older-high"]);
});
