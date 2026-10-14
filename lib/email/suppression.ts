import { createHash } from "crypto";
import type Database from "better-sqlite3";
import { ensureHunterSchema } from "../hunter/schema";
import { normalizeEmailAddress } from "./compliance";

/**
 * Recipient-level do-not-contact checks backed by the existing
 * `hunter_suppressions` store (the same table reply classification and bounce
 * sync write to). An address is suppressed when:
 *  - an opt-out row stores that address in `value`, or
 *  - any target with that address is suppressed, or
 *  - that target's company is suppressed.
 */

function tableExists(db: Database.Database, name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function targetsForEmail(db: Database.Database, email: string) {
  if (!tableExists(db, "targets")) return [] as Array<{ id: string; company_id: string | null }>;
  return db.prepare("SELECT id, company_id FROM targets WHERE lower(trim(email)) = ?")
    .all(email) as Array<{ id: string; company_id: string | null }>;
}

export function isRecipientSuppressed(db: Database.Database, email: string): boolean {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return true; // nothing to check against: fail closed
  ensureHunterSchema(db);
  const byValue = db.prepare(
    "SELECT 1 AS found FROM hunter_suppressions WHERE lower(trim(value)) = ? LIMIT 1",
  ).get(normalized) as { found: number } | undefined;
  if (byValue) return true;
  for (const target of targetsForEmail(db, normalized)) {
    const row = db.prepare(`
      SELECT 1 AS found FROM hunter_suppressions
      WHERE target_id = ? OR (? IS NOT NULL AND company_id = ?)
      LIMIT 1
    `).get(target.id, target.company_id, target.company_id) as { found: number } | undefined;
    if (row) return true;
  }
  return false;
}

/** Records a one-click opt-out. Idempotent per address. */
export function recordEmailUnsubscribe(
  db: Database.Database,
  email: string,
  source = "one_click_unsubscribe",
) {
  const normalized = normalizeEmailAddress(email);
  if (!normalized.includes("@")) throw new Error("A valid email address is required to unsubscribe.");
  ensureHunterSchema(db);
  const targets = targetsForEmail(db, normalized);
  const insert = db.prepare(`
    INSERT INTO hunter_suppressions (
      id, target_id, company_id, dedupe_key, kind, value, reason, source, updated_at
    ) VALUES (?, ?, NULL, ?, 'unsubscribe', ?, 'Recipient unsubscribed via one-click link.', ?, datetime('now'))
    ON CONFLICT(dedupe_key) DO UPDATE SET source = excluded.source, updated_at = datetime('now')
  `);
  const stopEmailTracks = tableExists(db, "run_profile_tracks") && tableExists(db, "run_profiles")
    ? db.prepare(`
        UPDATE run_profile_tracks
        SET state = 'skipped', error_message = 'Recipient unsubscribed'
        WHERE track = 'email'
          AND state NOT IN ('completed', 'failed', 'skipped')
          AND run_profile_id IN (SELECT id FROM run_profiles WHERE target_id = ?)
      `)
    : null;
  db.transaction(() => {
    const rows = targets.length ? targets.map((t) => t.id) : [null];
    for (const targetId of rows) {
      const dedupeKey = `${targetId ?? ""}||unsubscribe|${normalized}`;
      const id = `hsp_${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 24)}`;
      insert.run(id, targetId, dedupeKey, normalized, source);
      if (targetId && stopEmailTracks) stopEmailTracks.run(targetId);
    }
  })();
  return { email: normalized, targetsMatched: targets.length };
}
