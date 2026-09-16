import type Database from "better-sqlite3";
import { applyHunterReplyEvent, classifyHunterReplyText } from "./replies";

function defaultOooResumeAt(receivedAt: string) {
  const date = new Date(receivedAt);
  const base = Number.isFinite(date.getTime()) ? date : new Date();
  base.setUTCDate(base.getUTCDate() + 3);
  return base.toISOString();
}

export function processPendingHunterEmailReplies(db: Database.Database, limit = 100) {
  const rows = db.prepare(`
    SELECT er.id, er.target_id, er.body_text, er.received_at
    FROM email_replies er
    LEFT JOIN hunter_reply_classifications hrc
      ON hrc.source_reply_id = er.id AND hrc.channel = 'email'
    WHERE hrc.id IS NULL
      AND er.body_text IS NOT NULL
      AND trim(er.body_text) != ''
    ORDER BY er.received_at ASC
    LIMIT ?
  `).all(Math.max(1, Math.min(500, limit))) as Array<{
    id: string;
    target_id: string;
    body_text: string;
    received_at: string;
  }>;

  let processed = 0;
  for (const row of rows) {
    const kind = classifyHunterReplyText(row.body_text);
    const result = applyHunterReplyEvent(db, {
      targetId: row.target_id,
      channel: "email",
      kind,
      receivedAt: row.received_at,
      sourceReplyId: row.id,
      resumeAt: kind === "ooo" ? defaultOooResumeAt(row.received_at) : null,
      confidence: kind === "question" ? 0.55 : 0.9,
      classifier: "hunter-deterministic-v1",
    });

    // Linki's richer inbox UI reads these columns. Keep this best-effort so the
    // bridge remains compatible with reduced synthetic fixtures.
    try {
      db.prepare(`
        UPDATE email_replies
        SET classification_json = ?, classified_at = COALESCE(classified_at, datetime('now')),
            dispatched_at = COALESCE(dispatched_at, datetime('now')), dispatch_result_json = ?
        WHERE id = ?
      `).run(
        JSON.stringify({ kind, summary: row.body_text.slice(0, 240) }),
        JSON.stringify(result),
        row.id,
      );
    } catch {
      // No-op when optional Linki inbox columns are absent in a test fixture.
    }
    processed += 1;
  }
  return processed;
}

export function processStampedHunterLinkedInReplies(db: Database.Database, limit = 100) {
  const rows = db.prepare(`
    SELECT t.id, t.last_replied_at
    FROM targets t
    LEFT JOIN hunter_reply_classifications hrc
      ON hrc.target_id = t.id AND hrc.channel = 'linkedin'
    WHERE t.last_replied_at IS NOT NULL
      AND hrc.id IS NULL
    ORDER BY t.last_replied_at ASC
    LIMIT ?
  `).all(Math.max(1, Math.min(500, limit))) as Array<{ id: string; last_replied_at: string }>;

  let processed = 0;
  for (const row of rows) {
    applyHunterReplyEvent(db, {
      targetId: row.id,
      channel: "linkedin",
      kind: "question",
      receivedAt: row.last_replied_at,
      confidence: 0.25,
      classifier: "linki-reply-stamp",
    });
    processed += 1;
  }
  return processed;
}

export function syncHunterBounceSuppressions(db: Database.Database, limit = 100) {
  const rows = db.prepare(`
    SELECT t.id
    FROM targets t
    LEFT JOIN hunter_suppressions hs
      ON hs.target_id = t.id AND hs.kind = 'bounce'
    WHERE t.email_status = 'invalid'
      AND hs.id IS NULL
    LIMIT ?
  `).all(Math.max(1, Math.min(500, limit))) as Array<{ id: string }>;

  let processed = 0;
  for (const row of rows) {
    applyHunterReplyEvent(db, {
      targetId: row.id,
      channel: "email",
      kind: "bounce",
      receivedAt: new Date().toISOString(),
      confidence: 1,
      classifier: "linki-bounce-state",
    });
    processed += 1;
  }
  return processed;
}
