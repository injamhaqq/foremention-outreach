import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateEmailChannelHealth,
  evaluateLinkedInChannelHealth,
} from "../../lib/hunter/channel-health";

test("email health pauses when complaint or hard-bounce risk is too high", () => {
  assert.equal(evaluateEmailChannelHealth({
    sent24h: 100,
    hardBounces24h: 6,
    complaints24h: 0,
    providerErrors24h: 0,
    dailyLimit: 200,
  }).healthy, false);

  assert.equal(evaluateEmailChannelHealth({
    sent24h: 100,
    hardBounces24h: 0,
    complaints24h: 1,
    providerErrors24h: 0,
    dailyLimit: 200,
  }).healthy, false);
});

test("email health reports remaining capacity when healthy", () => {
  const health = evaluateEmailChannelHealth({
    sent24h: 40,
    hardBounces24h: 0,
    complaints24h: 0,
    providerErrors24h: 0,
    dailyLimit: 100,
  });
  assert.equal(health.healthy, true);
  assert.equal(health.remainingCapacity, 60);
});

test("linkedin health pauses on checkpoint, rate-limit, or exhausted budget", () => {
  assert.equal(evaluateLinkedInChannelHealth({
    actionsToday: 3,
    dailyLimit: 20,
    checkpointDetected: true,
    rateLimited: false,
    consecutiveErrors: 0,
  }).healthy, false);

  assert.equal(evaluateLinkedInChannelHealth({
    actionsToday: 20,
    dailyLimit: 20,
    checkpointDetected: false,
    rateLimited: false,
    consecutiveErrors: 0,
  }).healthy, false);
});
