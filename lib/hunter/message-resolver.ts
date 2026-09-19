import { createHash } from "crypto";
import type Database from "better-sqlite3";

export type HunterFirstTouchChannel = "email" | "linkedin";

export type HunterFirstTouchDraft = {
  id: string;
  channel: HunterFirstTouchChannel;
  subject: string | null;
  body: string;
  evidenceIds: string[];
};

function stableId(value: string) {
  return `hdd_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export function getPendingHunterFirstTouch(
  db: Database.Database,
  input: { targetId: string; runId: string; channel: HunterFirstTouchChannel },
): HunterFirstTouchDraft | null {
  const row = db.prepare(`
    SELECT d.id, d.channel, d.subject, d.body, d.evidence_ids_json
    FROM hunter_message_drafts d
    LEFT JOIN hunter_draft_deliveries delivery
      ON delivery.draft_id = d.id AND delivery.run_id = ?
    WHERE d.target_id = ?
      AND d.channel = ?
      AND d.status = 'enrolled'
      AND delivery.id IS NULL
    ORDER BY d.updated_at DESC, d.created_at DESC
    LIMIT 1
  `).get(input.runId, input.targetId, input.channel) as {
    id: string;
    channel: HunterFirstTouchChannel;
    subject: string | null;
    body: string;
    evidence_ids_json: string;
  } | undefined;

  if (!row) return null;
  let evidenceIds: string[] = [];
  try {
    const parsed = JSON.parse(row.evidence_ids_json || "[]");
    if (Array.isArray(parsed)) evidenceIds = parsed.filter((value): value is string => typeof value === "string");
  } catch {
    evidenceIds = [];
  }
  return {
    id: row.id,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    evidenceIds,
  };
}

export function markHunterFirstTouchDelivered(
  db: Database.Database,
  input: {
    draftId: string;
    runId: string;
    targetId: string;
    channel: HunterFirstTouchChannel;
    consumedAt?: string;
  },
) {
  const consumedAt = input.consumedAt ?? new Date().toISOString();
  const id = stableId(`${input.draftId}|${input.runId}`);
  db.prepare(`
    INSERT INTO hunter_draft_deliveries (
      id, draft_id, run_id, target_id, channel, consumed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(draft_id, run_id) DO UPDATE SET
      consumed_at = excluded.consumed_at
  `).run(id, input.draftId, input.runId, input.targetId, input.channel, consumedAt);
  return { id, consumedAt };
}
