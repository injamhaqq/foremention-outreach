import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAutopilotDecision } from "../../lib/hunter/autopilot";

const base = {
  mode: "guarded_auto" as const,
  route: "priority" as const,
  outreachReady: true,
  strongSignalCount: 1,
  evidenceFresh: true,
  suppressed: false,
  buyer: { hasEmail: true, hasLinkedIn: true },
  emailHealthy: true,
  linkedinHealthy: true,
};

test("guarded autopilot can auto-start a qualified, evidenced prospect", () => {
  const decision = evaluateAutopilotDecision(base);
  assert.equal(decision.action, "auto_start");
  assert.equal(decision.allowedChannels.email, true);
  assert.equal(decision.allowedChannels.linkedin, true);
});

test("assisted mode always requires human approval for first touch", () => {
  const decision = evaluateAutopilotDecision({ ...base, mode: "assisted" });
  assert.equal(decision.action, "approval_required");
});

test("autopilot blocks suppressed or stale prospects", () => {
  assert.equal(evaluateAutopilotDecision({ ...base, suppressed: true }).action, "blocked");
  assert.equal(evaluateAutopilotDecision({ ...base, evidenceFresh: false }).action, "blocked");
});

test("autopilot can continue on a healthy channel when the other channel is paused", () => {
  const decision = evaluateAutopilotDecision({ ...base, linkedinHealthy: false });
  assert.equal(decision.action, "auto_start");
  assert.equal(decision.allowedChannels.email, true);
  assert.equal(decision.allowedChannels.linkedin, false);
});
