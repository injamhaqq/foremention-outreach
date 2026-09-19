export type HunterChannelHealth = {
  healthy: boolean;
  remainingCapacity: number;
  reasons: string[];
};

export type HunterEmailHealthInput = {
  sent24h: number;
  hardBounces24h: number;
  complaints24h: number;
  providerErrors24h: number;
  dailyLimit: number;
};

export function evaluateEmailChannelHealth(input: HunterEmailHealthInput): HunterChannelHealth {
  const sent = Math.max(0, input.sent24h);
  const limit = Math.max(0, input.dailyLimit);
  const remainingCapacity = Math.max(0, limit - sent);
  const reasons: string[] = [];
  const bounceRate = sent > 0 ? Math.max(0, input.hardBounces24h) / sent : 0;

  if (input.complaints24h > 0) reasons.push("complaint_detected");
  if (bounceRate >= 0.05) reasons.push("hard_bounce_rate_high");
  if (input.providerErrors24h >= 3) reasons.push("provider_error_streak");
  if (remainingCapacity <= 0) reasons.push("daily_capacity_exhausted");

  return { healthy: reasons.length === 0, remainingCapacity, reasons };
}

export type HunterLinkedInHealthInput = {
  actionsToday: number;
  dailyLimit: number;
  checkpointDetected: boolean;
  rateLimited: boolean;
  consecutiveErrors: number;
};

export function evaluateLinkedInChannelHealth(input: HunterLinkedInHealthInput): HunterChannelHealth {
  const actions = Math.max(0, input.actionsToday);
  const limit = Math.max(0, input.dailyLimit);
  const remainingCapacity = Math.max(0, limit - actions);
  const reasons: string[] = [];

  if (input.checkpointDetected) reasons.push("checkpoint_detected");
  if (input.rateLimited) reasons.push("rate_limited");
  if (input.consecutiveErrors >= 3) reasons.push("automation_error_streak");
  if (remainingCapacity <= 0) reasons.push("daily_capacity_exhausted");

  return { healthy: reasons.length === 0, remainingCapacity, reasons };
}
