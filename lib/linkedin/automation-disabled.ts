/**
 * LinkedIn automation is HARD-DISABLED.
 *
 * Why: LinkedIn's User Agreement (section 8.2) prohibits bots, scrapers,
 * browser plug-ins and other automated means to access the service, send
 * connection requests or messages, or copy profile data. This codebase drove a
 * Playwright browser with a stealth plugin to do exactly that, which puts the
 * founder's account (and prospects' data) at risk.
 *
 * What still works: Customer Hunter keeps generating LinkedIn *drafts*. The
 * founder copies the approved text and sends it by hand from their own
 * LinkedIn account. Nothing in lib/linkedin/* may touch linkedin.com.
 *
 * The automation code is intentionally left in place (not deleted) so the
 * history is reviewable, but every entry point calls
 * `linkedInAutomationDisabled()` first, which always throws.
 */

export const LINKEDIN_AUTOMATION_DISABLED_MESSAGE =
  "LinkedIn automation disabled: draft only, founder sends manually";

/** Constant kill switch. There is intentionally no env flag that turns automation back on. */
export const LINKEDIN_AUTOMATION_HARD_DISABLED = true as boolean;

export class LinkedInAutomationDisabledError extends Error {
  readonly code = "linkedin_automation_disabled";
  readonly action: string;
  constructor(action: string) {
    super(`${LINKEDIN_AUTOMATION_DISABLED_MESSAGE} (blocked action: ${action})`);
    this.name = "LinkedInAutomationDisabledError";
    this.action = action;
  }
}

/** Always throws. Typed as void (not never) so the preserved code below each call still type-checks. */
export function linkedInAutomationDisabled(action: string): void {
  throw new LinkedInAutomationDisabledError(action);
}

export function isLinkedInAutomationDisabledError(error: unknown): error is LinkedInAutomationDisabledError {
  return error instanceof LinkedInAutomationDisabledError
    || (error instanceof Error && error.message.startsWith(LINKEDIN_AUTOMATION_DISABLED_MESSAGE));
}
