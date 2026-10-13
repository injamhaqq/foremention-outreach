/**
 * Background automation is OFF by default.
 *
 * Every runner / autopilot / scheduler (Hunter continuous cycle, autopilot
 * drafting, acquisition, reply monitor, the workflow sequencer in
 * lib/linkedin/runner.ts and its import scheduler) starts only when the operator
 * sets HUNTER_RUNNERS_ENABLED=true explicitly. Any other value (unset, "1",
 * "yes", "false", ...) keeps them stopped.
 */
export const HUNTER_RUNNERS_FLAG = "HUNTER_RUNNERS_ENABLED";

export function hunterRunnersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[HUNTER_RUNNERS_FLAG] ?? "").trim().toLowerCase() === "true";
}

export const HUNTER_RUNNERS_DISABLED_MESSAGE =
  `Background runners are disabled. Set ${HUNTER_RUNNERS_FLAG}=true to start them.`;
