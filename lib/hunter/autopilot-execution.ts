import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type { HunterAiProvider } from "./ai";
import { enrollApprovedHunterDraft } from "./approval";
import { evaluateAutopilotDecision, type HunterAutopilotMode } from "./autopilot";
import { generateHunterDraft } from "./drafts";
import { hasVerifiedWorkEmail } from "./contact-verification";
import { createHunterRepository } from "./repository";
import { runHunterForementionMiniAudit, type HunterMiniAuditRequester } from "./mini-audit";
import { buildResearchBrief, type HunterResearchSignal } from "./research";
import type { HunterRoute } from "./types";

type TargetRow = {
  id: string;
  full_name: string | null;
  title: string | null;
  email: string | null;
  email_status: string | null;
  linkedin_url: string | null;
  company_id: string;
};

type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
};

type ScoreRow = {
  route: HunterRoute;
  outreach_ready: number;
  score_json: string;
};

function latestScore(db: Database.Database, companyId: string, targetId: string): ScoreRow | null {
  return (db.prepare(`
    SELECT route, outreach_ready, score_json
    FROM hunter_scores
    WHERE company_id = ? AND target_id = ?
    ORDER BY computed_at DESC, created_at DESC
    LIMIT 1
  `).get(companyId, targetId) as ScoreRow | undefined) ?? null;
}

function currentSignals(db: Database.Database, companyId: string, now: Date): HunterResearchSignal[] {
  const rows = db.prepare(`
    SELECT id, type, title, summary, evidence_text, source_url, observed_at, confidence, expires_at
    FROM hunter_signals
    WHERE company_id = ?
    ORDER BY observed_at DESC
  `).all(companyId) as Array<{
    id: string; type: string; title: string; summary: string; evidence_text: string;
    source_url: string; observed_at: string; confidence: number; expires_at: string | null;
  }>;
  const nowMs = now.getTime();
  return rows.filter((row) => {
    const observed = Date.parse(row.observed_at);
    const expires = row.expires_at ? Date.parse(row.expires_at) : Number.POSITIVE_INFINITY;
    return Number.isFinite(observed) && observed <= nowMs && expires > nowMs;
  }).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    evidenceText: row.evidence_text,
    sourceUrl: row.source_url,
    observedAt: row.observed_at,
    confidence: Number(row.confidence),
  }));
}

function parsedStrongSignalCount(scoreJson: string) {
  try {
    const parsed = JSON.parse(scoreJson) as { strongSignalCount?: unknown };
    const count = Number(parsed.strongSignalCount);
    return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  } catch {
    return 0;
  }
}

function recordDecision(db: Database.Database, input: {
  companyId: string;
  targetId: string;
  mode: HunterAutopilotMode;
  action: string;
  allowedEmail: boolean;
  allowedLinkedIn: boolean;
  reasons: string[];
  now: Date;
}) {
  db.prepare(`
    INSERT INTO hunter_autopilot_decisions (
      id, company_id, target_id, mode, action, allowed_email, allowed_linkedin, reasons_json, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), input.companyId, input.targetId, input.mode, input.action,
    input.allowedEmail ? 1 : 0, input.allowedLinkedIn ? 1 : 0,
    JSON.stringify(input.reasons), input.now.toISOString(),
  );
}

export async function processHunterAutopilotTarget(
  db: Database.Database,
  input: {
    companyId: string;
    targetId: string;
    mode: HunterAutopilotMode;
    runId: string | null;
    emailHealthy: boolean;
    linkedinHealthy: boolean;
    aiProvider?: HunterAiProvider | null;
    miniAuditRequester?: HunterMiniAuditRequester;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const repository = createHunterRepository(db);
  const target = db.prepare(`
    SELECT id, company_id, full_name, title, email, email_status, linkedin_url
    FROM targets WHERE id = ? AND company_id = ?
  `).get(input.targetId, input.companyId) as TargetRow | undefined;
  const company = db.prepare("SELECT id, name, domain FROM companies WHERE id = ?")
    .get(input.companyId) as CompanyRow | undefined;
  if (!target || !company?.domain) throw new Error("Hunter company or buyer not found.");

  const score = latestScore(db, input.companyId, input.targetId);
  if (!score) throw new Error("Hunter qualification score not found.");
  const signals = currentSignals(db, input.companyId, now);
  const suppressed = repository.isTargetSuppressed(input.targetId);
  const decision = evaluateAutopilotDecision({
    mode: input.mode,
    route: score.route,
    outreachReady: Boolean(score.outreach_ready),
    strongSignalCount: parsedStrongSignalCount(score.score_json),
    evidenceFresh: signals.length > 0,
    suppressed,
    buyer: { hasEmail: hasVerifiedWorkEmail(target.email, target.email_status), hasLinkedIn: Boolean(target.linkedin_url) },
    emailHealthy: input.emailHealthy,
    linkedinHealthy: input.linkedinHealthy,
  });

  recordDecision(db, {
    companyId: input.companyId,
    targetId: input.targetId,
    mode: input.mode,
    action: decision.action,
    allowedEmail: decision.allowedChannels.email,
    allowedLinkedIn: decision.allowedChannels.linkedin,
    reasons: decision.reasons,
    now,
  });

  if (decision.action === "blocked") {
    return { ...decision, drafts: [] as Array<{ id: string; channel: "email" | "linkedin" }> };
  }

  let miniAudit = null;
  let miniAuditError: string | null = null;
  if (input.miniAuditRequester && input.aiProvider) {
    try {
      const result = await runHunterForementionMiniAudit(db, {
        company: { id: company.id, name: company.name, domain: company.domain },
        targetId: input.targetId,
        signals,
        aiProvider: input.aiProvider,
        requester: input.miniAuditRequester,
        now,
      });
      miniAudit = result.audit;
    } catch (error) {
      miniAuditError = error instanceof Error ? error.message : String(error);
      console.warn(
        `[hunter] Foremention mini-audit failed company=${input.companyId} target=${input.targetId}:`,
        miniAuditError,
      );
    }
  }

  const packet = buildResearchBrief({
    target: {
      id: target.id,
      fullName: target.full_name || "Buyer",
      role: target.title || "Buyer",
      email: target.email,
      linkedinUrl: target.linkedin_url,
    },
    company: { id: company.id, name: company.name, domain: company.domain },
    signals,
    miniAudit,
  });
  if (!packet.evidence.length) {
    return { action: "blocked" as const, allowedChannels: decision.allowedChannels, reasons: ["no_research_evidence"], drafts: [] };
  }
  repository.saveHunterResearchReport({
    companyId: input.companyId,
    targetId: input.targetId,
    report: { packet, mode: input.mode, miniAuditError },
    evidenceIds: packet.evidence.map((item) => item.id),
    confidence: Math.min(1, packet.evidence.length / 4),
  });

  const drafts: Array<{ id: string; channel: "email" | "linkedin" }> = [];
  const channels: Array<"email" | "linkedin"> = [];
  if (decision.allowedChannels.email) channels.push("email");
  if (decision.allowedChannels.linkedin) channels.push("linkedin");
  for (const channel of channels) {
    const generated = await generateHunterDraft(packet, channel, input.aiProvider);
    const saved = repository.saveHunterDraft({
      targetId: input.targetId,
      companyId: input.companyId,
      channel,
      subject: generated.subject,
      body: generated.body,
      evidenceIds: generated.evidenceIds,
      firstTouchFingerprint: generated.firstTouchFingerprint,
    });
    drafts.push({ id: saved.id, channel });
  }

  if (decision.action === "approval_required") return { ...decision, drafts };
  if (!input.runId) {
    return {
      action: "approval_required" as const,
      allowedChannels: decision.allowedChannels,
      reasons: ["default_run_not_configured"],
      drafts,
    };
  }

  const allowedChannels = channels;
  for (const draft of drafts) {
    repository.setHunterApproval({
      draftId: draft.id,
      state: "approved",
      approvedBy: `autopilot:${input.mode}`,
      note: "Approved by configured Foremention Customer Hunter autopilot policy.",
    });
    enrollApprovedHunterDraft(db, {
      draftId: draft.id,
      runId: input.runId,
      allowedChannels,
    });
  }

  return { ...decision, drafts };
}
