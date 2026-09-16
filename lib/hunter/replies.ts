import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";

export type HunterReplyChannel = "email" | "linkedin";
export type HunterReplyKind =
  | "positive"
  | "question"
  | "objection"
  | "not_now"
  | "referral"
  | "ooo"
  | "unsubscribe"
  | "bounce"
  | "complaint"
  | "negative";

export type HunterReplyEvent = {
  targetId: string;
  channel: HunterReplyChannel;
  kind: HunterReplyKind;
  receivedAt: string;
  sourceReplyId?: string | null;
  resumeAt?: string | null;
  confidence?: number;
  classifier?: string;
};

export type HunterReplyRoute = {
  normalizedKind: HunterReplyKind;
  stopAutomation: boolean;
  suppression: null | {
    kind: "unsubscribe" | "bounce" | "complaint" | "negative";
    reason: string;
  };
  nextAction: "human_reply" | "follow_up_later" | "reschedule" | "suppress";
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function stableSuppressionId(targetId: string, kind: string) {
  return `hsp_${createHash("sha256").update(`${targetId}|${kind}`).digest("hex").slice(0, 24)}`;
}

export function routeHunterReply(kind: HunterReplyKind): HunterReplyRoute {
  if (kind === "ooo") {
    return {
      normalizedKind: kind,
      stopAutomation: false,
      suppression: null,
      nextAction: "reschedule",
    };
  }

  if (kind === "unsubscribe" || kind === "bounce" || kind === "complaint" || kind === "negative") {
    const reason = kind === "unsubscribe"
      ? "Contact asked to unsubscribe."
      : kind === "bounce"
        ? "Contact email hard-bounced."
        : kind === "complaint"
          ? "Contact generated a complaint signal."
          : "Contact expressed negative intent.";
    return {
      normalizedKind: kind,
      stopAutomation: true,
      suppression: { kind, reason },
      nextAction: "suppress",
    };
  }

  return {
    normalizedKind: kind,
    stopAutomation: true,
    suppression: null,
    nextAction: kind === "not_now" ? "follow_up_later" : "human_reply",
  };
}

export function applyHunterReplyEvent(db: Database.Database, event: HunterReplyEvent) {
  const target = db.prepare("SELECT id, company_id FROM targets WHERE id = ?").get(event.targetId) as
    | { id: string; company_id: string | null }
    | undefined;
  if (!target) throw new Error("HUNTER_TARGET_NOT_FOUND");

  const route = routeHunterReply(event.kind);
  const receivedAt = new Date(event.receivedAt);
  if (!Number.isFinite(receivedAt.getTime())) throw new Error("HUNTER_REPLY_TIMESTAMP_INVALID");
  const receivedAtIso = receivedAt.toISOString();
  const confidence = clamp01(event.confidence ?? 1);
  const classifier = (event.classifier ?? "deterministic").trim().slice(0, 80) || "deterministic";

  db.transaction(() => {
    db.prepare(`
      INSERT INTO hunter_reply_classifications (
        id, target_id, source_reply_id, channel, classification, confidence, classifier
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      event.targetId,
      event.sourceReplyId ?? null,
      event.channel,
      route.normalizedKind,
      confidence,
      classifier,
    );

    if (route.stopAutomation) {
      if (event.channel === "email") {
        db.prepare("UPDATE targets SET email_replied_at = ?, reply_kind = ? WHERE id = ?")
          .run(receivedAtIso, route.normalizedKind, event.targetId);
      } else {
        db.prepare("UPDATE targets SET last_replied_at = ?, reply_kind = ? WHERE id = ?")
          .run(receivedAtIso, route.normalizedKind, event.targetId);
      }

      db.prepare(`
        UPDATE run_profile_tracks
        SET state = 'skipped', error_message = 'Lead replied', next_step_at = NULL
        WHERE run_profile_id IN (
          SELECT id FROM run_profiles WHERE target_id = ?
        )
        AND state NOT IN ('completed', 'failed', 'skipped')
      `).run(event.targetId);
    } else if (route.nextAction === "reschedule" && event.resumeAt) {
      const resumeAt = new Date(event.resumeAt);
      if (!Number.isFinite(resumeAt.getTime())) throw new Error("HUNTER_REPLY_RESUME_TIMESTAMP_INVALID");
      db.prepare(`
        UPDATE run_profile_tracks
        SET next_step_at = ?
        WHERE run_profile_id IN (
          SELECT id FROM run_profiles WHERE target_id = ?
        )
        AND state NOT IN ('completed', 'failed', 'skipped')
      `).run(resumeAt.toISOString(), event.targetId);
    }

    if (route.suppression) {
      const dedupeKey = `${event.targetId}||${route.suppression.kind}|`;
      db.prepare(`
        INSERT INTO hunter_suppressions (
          id, target_id, company_id, dedupe_key, kind, value, reason, source, updated_at
        ) VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, datetime('now'))
        ON CONFLICT(dedupe_key) DO UPDATE SET
          reason = excluded.reason,
          source = excluded.source,
          updated_at = datetime('now')
      `).run(
        stableSuppressionId(event.targetId, route.suppression.kind),
        event.targetId,
        dedupeKey,
        route.suppression.kind,
        route.suppression.reason,
        `reply:${event.channel}`,
      );
    }
  })();

  return {
    stopped: route.stopAutomation,
    suppression: route.suppression?.kind ?? null,
    nextAction: route.nextAction,
    kind: route.normalizedKind,
  };
}
