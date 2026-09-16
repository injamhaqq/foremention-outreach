import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { getDb } from "../db";
import type { HunterQualificationResult, HunterSignalType } from "./types";
import { ensureHunterSchema } from "./schema";

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function normalizeSourceUrl(value: string) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLocaleLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return trimmed.replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

export type HunterSignalWrite = {
  companyId: string;
  targetId?: string | null;
  type: HunterSignalType;
  title: string;
  summary: string;
  sourceUrl: string;
  sourceName?: string | null;
  evidenceText: string;
  observedAt: string;
  publishedAt?: string | null;
  expiresAt?: string | null;
  confidence: number;
  scoreContribution: number;
};

export type HunterSignalRecord = HunterSignalWrite & {
  id: string;
  sourceUrl: string;
};

export type HunterDraftWrite = {
  targetId: string;
  companyId: string;
  channel: "email" | "linkedin";
  subject?: string | null;
  body: string;
  evidenceIds: string[];
  firstTouchFingerprint: string;
};

export type HunterDraftRecord = HunterDraftWrite & {
  id: string;
  status: "draft" | "approved" | "rejected" | "enrolled";
};

export function createHunterRepository(db: Database.Database) {
  ensureHunterSchema(db);

  function upsertHunterSignal(input: HunterSignalWrite): HunterSignalRecord {
    const sourceUrl = normalizeSourceUrl(input.sourceUrl);
    const dedupeKey = `${input.companyId}|${input.type}|${sourceUrl}`;
    const id = stableId("hs", dedupeKey);
    const evidenceHash = createHash("sha256").update(input.evidenceText.trim()).digest("hex");
    const evidenceId = stableId("hse", `${id}|${evidenceHash}`);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO hunter_signals (
          id, company_id, target_id, dedupe_key, type, title, summary, source_url,
          source_name, evidence_text, observed_at, published_at, expires_at,
          confidence, score_contribution, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(dedupe_key) DO UPDATE SET
          target_id = excluded.target_id,
          title = excluded.title,
          summary = excluded.summary,
          source_name = excluded.source_name,
          evidence_text = excluded.evidence_text,
          observed_at = excluded.observed_at,
          published_at = excluded.published_at,
          expires_at = excluded.expires_at,
          confidence = excluded.confidence,
          score_contribution = excluded.score_contribution,
          updated_at = datetime('now')
      `).run(
        id,
        input.companyId,
        input.targetId ?? null,
        dedupeKey,
        input.type,
        input.title.trim(),
        input.summary.trim(),
        sourceUrl,
        input.sourceName ?? null,
        input.evidenceText.trim(),
        input.observedAt,
        input.publishedAt ?? null,
        input.expiresAt ?? null,
        input.confidence,
        input.scoreContribution,
      );

      db.prepare(`
        INSERT INTO hunter_signal_evidence (
          id, signal_id, evidence_hash, source_url, excerpt, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(signal_id, evidence_hash) DO UPDATE SET
          source_url = excluded.source_url,
          excerpt = excluded.excerpt,
          captured_at = excluded.captured_at
      `).run(evidenceId, id, evidenceHash, sourceUrl, input.evidenceText.trim(), input.observedAt);
    })();

    return readSignal(id)!;
  }

  function readSignal(id: string): HunterSignalRecord | null {
    const row = db.prepare(`
      SELECT id, company_id, target_id, type, title, summary, source_url, source_name,
             evidence_text, observed_at, published_at, expires_at, confidence, score_contribution
      FROM hunter_signals WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return mapSignal(row);
  }

  function mapSignal(row: Record<string, unknown>): HunterSignalRecord {
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      targetId: row.target_id ? String(row.target_id) : null,
      type: String(row.type) as HunterSignalType,
      title: String(row.title),
      summary: String(row.summary),
      sourceUrl: String(row.source_url),
      sourceName: row.source_name ? String(row.source_name) : null,
      evidenceText: String(row.evidence_text),
      observedAt: String(row.observed_at),
      publishedAt: row.published_at ? String(row.published_at) : null,
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      confidence: Number(row.confidence),
      scoreContribution: Number(row.score_contribution),
    };
  }

  function listSignalsForCompany(companyId: string): HunterSignalRecord[] {
    const rows = db.prepare(`
      SELECT id, company_id, target_id, type, title, summary, source_url, source_name,
             evidence_text, observed_at, published_at, expires_at, confidence, score_contribution
      FROM hunter_signals
      WHERE company_id = ?
      ORDER BY observed_at DESC, id ASC
    `).all(companyId) as Record<string, unknown>[];
    return rows.map(mapSignal);
  }

  function saveHunterScore(input: {
    companyId: string;
    targetId?: string | null;
    result: HunterQualificationResult;
    computedAt?: string;
  }) {
    const id = randomUUID();
    const computedAt = input.computedAt ?? new Date().toISOString();
    db.prepare(`
      INSERT INTO hunter_scores (
        id, company_id, target_id, fit_score, intent_score, buyer_score, total_score,
        route, outreach_ready, reason, score_json, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.companyId,
      input.targetId ?? null,
      input.result.fitScore,
      input.result.intentScore,
      input.result.buyerScore,
      input.result.totalScore,
      input.result.route,
      input.result.outreachReady ? 1 : 0,
      input.result.reason,
      json(input.result),
      computedAt,
    );
    return { id, computedAt };
  }

  function saveHunterResearchReport(input: {
    companyId: string;
    targetId: string;
    report: unknown;
    evidenceIds: string[];
    confidence: number;
  }) {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO hunter_research_reports (
        id, company_id, target_id, report_json, evidence_ids_json, confidence
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.companyId, input.targetId, json(input.report), json(input.evidenceIds), input.confidence);
    return { id };
  }

  function saveHunterDraft(input: HunterDraftWrite): HunterDraftRecord {
    const fingerprint = input.firstTouchFingerprint.trim();
    const id = stableId("hd", fingerprint);
    db.prepare(`
      INSERT INTO hunter_message_drafts (
        id, target_id, company_id, channel, subject, body, evidence_ids_json,
        first_touch_fingerprint, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', datetime('now'))
      ON CONFLICT(first_touch_fingerprint) DO UPDATE SET
        subject = excluded.subject,
        body = excluded.body,
        evidence_ids_json = excluded.evidence_ids_json,
        updated_at = datetime('now')
    `).run(
      id,
      input.targetId,
      input.companyId,
      input.channel,
      input.subject ?? null,
      input.body,
      json(input.evidenceIds),
      fingerprint,
    );
    return readDraftByFingerprint(fingerprint)!;
  }

  function readDraftByFingerprint(fingerprint: string): HunterDraftRecord | null {
    const row = db.prepare(`
      SELECT id, target_id, company_id, channel, subject, body, evidence_ids_json,
             first_touch_fingerprint, status
      FROM hunter_message_drafts WHERE first_touch_fingerprint = ?
    `).get(fingerprint) as Record<string, unknown> | undefined;
    if (!row) return null;
    return mapDraft(row);
  }

  function mapDraft(row: Record<string, unknown>): HunterDraftRecord {
    return {
      id: String(row.id),
      targetId: String(row.target_id),
      companyId: String(row.company_id),
      channel: String(row.channel) as "email" | "linkedin",
      subject: row.subject ? String(row.subject) : null,
      body: String(row.body),
      evidenceIds: JSON.parse(String(row.evidence_ids_json || "[]")) as string[],
      firstTouchFingerprint: String(row.first_touch_fingerprint),
      status: String(row.status) as HunterDraftRecord["status"],
    };
  }

  function listDraftsForTarget(targetId: string): HunterDraftRecord[] {
    const rows = db.prepare(`
      SELECT id, target_id, company_id, channel, subject, body, evidence_ids_json,
             first_touch_fingerprint, status
      FROM hunter_message_drafts WHERE target_id = ? ORDER BY created_at DESC
    `).all(targetId) as Record<string, unknown>[];
    return rows.map(mapDraft);
  }

  function setHunterApproval(input: {
    draftId: string;
    state: "pending" | "approved" | "rejected";
    approvedBy?: string | null;
    note?: string | null;
  }) {
    const id = stableId("ha", input.draftId);
    const approvedAt = input.state === "approved" ? new Date().toISOString() : null;
    db.transaction(() => {
      db.prepare(`
        INSERT INTO hunter_approvals (
          id, draft_id, state, approved_by, approved_at, note, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(draft_id) DO UPDATE SET
          state = excluded.state,
          approved_by = excluded.approved_by,
          approved_at = excluded.approved_at,
          note = excluded.note,
          updated_at = datetime('now')
      `).run(id, input.draftId, input.state, input.approvedBy ?? null, approvedAt, input.note ?? null);
      const draftStatus = input.state === "approved" ? "approved" : input.state === "rejected" ? "rejected" : "draft";
      db.prepare("UPDATE hunter_message_drafts SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(draftStatus, input.draftId);
    })();
    return { id, approvedAt };
  }

  function upsertHunterSuppression(input: {
    targetId?: string | null;
    companyId?: string | null;
    kind: string;
    value?: string | null;
    reason: string;
    source: string;
  }) {
    const dedupeKey = `${input.targetId ?? ""}|${input.companyId ?? ""}|${input.kind}|${input.value ?? ""}`;
    const id = stableId("hsp", dedupeKey);
    db.prepare(`
      INSERT INTO hunter_suppressions (
        id, target_id, company_id, dedupe_key, kind, value, reason, source, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(dedupe_key) DO UPDATE SET
        reason = excluded.reason,
        source = excluded.source,
        updated_at = datetime('now')
    `).run(
      id,
      input.targetId ?? null,
      input.companyId ?? null,
      dedupeKey,
      input.kind,
      input.value ?? null,
      input.reason,
      input.source,
    );
    return { id };
  }

  function isTargetSuppressed(targetId: string) {
    const row = db.prepare("SELECT 1 AS found FROM hunter_suppressions WHERE target_id = ? LIMIT 1").get(targetId) as
      | { found: number }
      | undefined;
    return Boolean(row?.found);
  }

  function upsertHunterOpportunity(input: {
    companyId: string;
    targetId?: string | null;
    stage: string;
    nextAction?: string | null;
    nextActionDueAt?: string | null;
    commercialEvidence?: unknown[];
  }) {
    const dedupeKey = `${input.companyId}|${input.targetId ?? "company"}`;
    const id = stableId("hop", dedupeKey);
    db.prepare(`
      INSERT INTO hunter_opportunities (
        id, company_id, target_id, dedupe_key, stage, next_action, next_action_due_at,
        commercial_evidence_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(dedupe_key) DO UPDATE SET
        stage = excluded.stage,
        next_action = excluded.next_action,
        next_action_due_at = excluded.next_action_due_at,
        commercial_evidence_json = excluded.commercial_evidence_json,
        updated_at = datetime('now')
    `).run(
      id,
      input.companyId,
      input.targetId ?? null,
      dedupeKey,
      input.stage,
      input.nextAction ?? null,
      input.nextActionDueAt ?? null,
      json(input.commercialEvidence ?? []),
    );
    return { id };
  }

  return {
    upsertHunterSignal,
    listSignalsForCompany,
    saveHunterScore,
    saveHunterResearchReport,
    saveHunterDraft,
    listDraftsForTarget,
    setHunterApproval,
    upsertHunterSuppression,
    isTargetSuppressed,
    upsertHunterOpportunity,
  };
}

let repository: ReturnType<typeof createHunterRepository> | null = null;

export function getHunterRepository() {
  if (!repository) repository = createHunterRepository(getDb());
  return repository;
}
