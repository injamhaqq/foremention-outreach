import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

export type HunterEnrollmentResult = {
  enrolled: boolean;
  alreadyEnrolled: boolean;
  runProfileId: string | null;
};

function draftFor(db: Database.Database, draftId: string) {
  return db.prepare(`
    SELECT d.id, d.target_id, d.company_id, d.channel, d.status,
           a.state AS approval_state
    FROM hunter_message_drafts d
    LEFT JOIN hunter_approvals a ON a.draft_id = d.id
    WHERE d.id = ?
  `).get(draftId) as {
    id: string;
    target_id: string;
    company_id: string;
    channel: "email" | "linkedin";
    status: string;
    approval_state: string | null;
  } | undefined;
}

function runFor(db: Database.Database, runId: string) {
  return db.prepare(`
    SELECT id, workflow_id, list_id, account_id, email_account_id, status
    FROM runs WHERE id = ?
  `).get(runId) as {
    id: string;
    workflow_id: string;
    list_id: string;
    account_id: string;
    email_account_id: string | null;
    status: string;
  } | undefined;
}

function isSuppressed(db: Database.Database, targetId: string, companyId: string) {
  const row = db.prepare(`
    SELECT 1 AS found FROM hunter_suppressions
    WHERE target_id = ? OR company_id = ?
    LIMIT 1
  `).get(targetId, companyId) as { found: number } | undefined;
  return Boolean(row?.found);
}

export function enrollApprovedHunterDraft(
  db: Database.Database,
  input: { draftId: string; runId: string },
): HunterEnrollmentResult {
  const draft = draftFor(db, input.draftId);
  if (!draft) throw new Error("Hunter draft not found.");
  if (draft.approval_state !== "approved") throw new Error("First-touch approval required before enrollment.");
  if (isSuppressed(db, draft.target_id, draft.company_id)) throw new Error("Target is suppressed and cannot be enrolled.");

  const run = runFor(db, input.runId);
  if (!run) throw new Error("Outreach run not found.");
  if (!["pending", "running", "paused"].includes(run.status)) throw new Error("Outreach run is not active.");

  const existing = db.prepare(`
    SELECT rp.id FROM run_profiles rp
    JOIN runs r ON r.id = rp.run_id
    WHERE rp.target_id = ? AND r.workflow_id = ?
    LIMIT 1
  `).get(draft.target_id, run.workflow_id) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE hunter_message_drafts SET status = 'enrolled', updated_at = datetime('now') WHERE id = ?")
      .run(draft.id);
    return { enrolled: false, alreadyEnrolled: true, runProfileId: existing.id };
  }

  const tracks = (db.prepare(
    "SELECT DISTINCT track FROM workflow_steps WHERE workflow_id = ? ORDER BY track"
  ).all(run.workflow_id) as Array<{ track: string }>).map((row) => row.track);
  if (!tracks.length) tracks.push(draft.channel);
  if (tracks.includes("email") && !run.email_account_id) {
    throw new Error("Email account required for the selected outreach run.");
  }

  const profileId = randomUUID();
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)")
      .run(run.list_id, draft.target_id);
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id, email_account_id) VALUES (?, ?, ?, ?)")
      .run(profileId, run.id, draft.target_id, run.email_account_id);
    const insertTrack = db.prepare(
      "INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, ?, 'pending', 0)"
    );
    for (const track of tracks) {
      if (track === "email" && !run.email_account_id) continue;
      insertTrack.run(randomUUID(), profileId, track);
    }
    db.prepare("UPDATE hunter_message_drafts SET status = 'enrolled', updated_at = datetime('now') WHERE id = ?")
      .run(draft.id);
  })();

  return { enrolled: true, alreadyEnrolled: false, runProfileId: profileId };
}
