import type Database from "better-sqlite3";

/**
 * Human-approval guard for every automated outbound send.
 *
 * Nothing leaves the system automatically unless a *human* approved the exact
 * draft being sent. Approvals recorded by automation (autopilot, runners, the
 * system itself) never count, regardless of HUNTER_AUTOPILOT_MODE.
 */

export const HUMAN_APPROVAL_REQUIRED_MESSAGE =
  "Human approval required: only founder-approved drafts can be sent automatically.";

export class HumanApprovalRequiredError extends Error {
  readonly code = "human_approval_required";
  constructor(message = HUMAN_APPROVAL_REQUIRED_MESSAGE) {
    super(message);
    this.name = "HumanApprovalRequiredError";
  }
}

const AUTOMATED_APPROVER = /^\s*(autopilot|auto|system|runner|scheduler|bot|cron|agent)\b/i;

export function isHumanApprover(approvedBy: string | null | undefined): boolean {
  const value = String(approvedBy ?? "").trim();
  if (!value) return false;
  return !AUTOMATED_APPROVER.test(value);
}

export type DraftApprovalRow = {
  state: string | null;
  approved_by: string | null;
  approved_at: string | null;
};

export function isHumanApproved(row: DraftApprovalRow | null | undefined): boolean {
  return Boolean(row && row.state === "approved" && row.approved_at && isHumanApprover(row.approved_by));
}

export function assertHumanApprovedDraft(db: Database.Database, draftId: string): void {
  const row = db.prepare(
    "SELECT state, approved_by, approved_at FROM hunter_approvals WHERE draft_id = ?",
  ).get(draftId) as DraftApprovalRow | undefined;
  if (!isHumanApproved(row)) throw new HumanApprovalRequiredError();
}
