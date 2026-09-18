import type { HunterRoute } from "./types";

export type HunterAutopilotMode = "manual" | "assisted" | "guarded_auto" | "full_auto";

export type HunterAutopilotInput = {
  mode: HunterAutopilotMode;
  route: HunterRoute;
  outreachReady: boolean;
  strongSignalCount: number;
  evidenceFresh: boolean;
  suppressed: boolean;
  buyer: {
    hasEmail: boolean;
    hasLinkedIn: boolean;
  };
  emailHealthy: boolean;
  linkedinHealthy: boolean;
};

export type HunterAutopilotDecision = {
  action: "blocked" | "approval_required" | "auto_start";
  allowedChannels: {
    email: boolean;
    linkedin: boolean;
  };
  reasons: string[];
};

export function evaluateAutopilotDecision(input: HunterAutopilotInput): HunterAutopilotDecision {
  const allowedChannels = {
    email: Boolean(input.buyer.hasEmail && input.emailHealthy),
    linkedin: Boolean(input.buyer.hasLinkedIn && input.linkedinHealthy),
  };
  const reasons: string[] = [];

  if (input.suppressed) reasons.push("suppressed");
  if (!input.outreachReady) reasons.push("not_outreach_ready");
  if (input.strongSignalCount < 1) reasons.push("no_current_pain_or_intent_signal");
  if (!input.evidenceFresh) reasons.push("stale_evidence");
  if (!allowedChannels.email && !allowedChannels.linkedin) reasons.push("no_healthy_reachable_channel");

  if (reasons.length) return { action: "blocked", allowedChannels, reasons };

  if (input.mode === "manual" || input.mode === "assisted") {
    return { action: "approval_required", allowedChannels, reasons: ["first_touch_review_policy"] };
  }

  if (input.mode === "guarded_auto" && !["priority", "good_cold"].includes(input.route)) {
    return { action: "approval_required", allowedChannels, reasons: ["route_requires_review"] };
  }

  return { action: "auto_start", allowedChannels, reasons: [] };
}
