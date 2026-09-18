import type Database from "better-sqlite3";

type BounceTarget = {
  id: string;
  email_status: string | null;
  company_id: string | null;
};

export type HardBounceResult =
  | { applied: false; reason: "target_not_found" | "already_invalid" }
  | { applied: true; targetId: string; companyId: string | null };

/**
 * Apply an address-level hard bounce.
 *
 * A hard bounce for one mailbox is not evidence that every mailbox at the same
 * company/domain is invalid. We therefore invalidate only the bounced target
 * and stop only that target's email track. LinkedIn and sibling contacts remain
 * available unless their own evidence/suppression says otherwise.
 */
export function applyHardBounce(
  db: Database.Database,
  email: string,
  occurredAt = new Date(),
): HardBounceResult {
  const normalized = email.trim().toLowerCase();
  const target = db
    .prepare("SELECT id, email_status, company_id FROM targets WHERE lower(email) = ? LIMIT 1")
    .get(normalized) as BounceTarget | undefined;

  if (!target) return { applied: false, reason: "target_not_found" };
  if (String(target.email_status || "").toLowerCase() === "invalid") {
    return { applied: false, reason: "already_invalid" };
  }

  const date = occurredAt.toISOString().slice(0, 10);
  const note = `Email hard-bounced on ${date} — address marked invalid`;

  db.transaction(() => {
    db.prepare(`
      UPDATE targets
      SET email_status = 'invalid',
          notes = CASE
            WHEN notes IS NULL OR notes = '' THEN ?
            ELSE notes || char(10) || ?
          END
      WHERE id = ?
    `).run(note, note, target.id);

    db.prepare(`
      UPDATE run_profile_tracks
      SET state = 'skipped',
          error_message = 'Email hard-bounced — invalid address'
      WHERE run_profile_id IN (
        SELECT id FROM run_profiles WHERE target_id = ?
      )
        AND track = 'email'
        AND state IN ('pending', 'in_progress')
    `).run(target.id);
  })();

  return { applied: true, targetId: target.id, companyId: target.company_id };
}
