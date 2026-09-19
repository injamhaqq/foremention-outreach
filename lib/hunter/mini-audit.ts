import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { HunterAiProvider } from "./ai";
import type { ForementionMiniAuditInput, ForementionMiniAuditResult } from "./foremention-client";
import type { HunterResearchCompany, HunterResearchSignal } from "./research";

export type HunterMiniAuditRequester = (
  input: ForementionMiniAuditInput,
) => Promise<ForementionMiniAuditResult>;

const questionSchema = z.object({
  questions: z.array(z.string().min(8).max(300)).min(3).max(5),
});

function uniqueQuestions(questions: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const question of questions) {
    const normalized = question.normalize("NFKC").replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  if (out.length < 3) throw new Error("Hunter mini-audit question generation returned fewer than three unique questions.");
  return out.slice(0, 5);
}

function requestFingerprint(domain: string, questions: string[]) {
  return createHash("sha256")
    .update(JSON.stringify({ domain: domain.toLowerCase(), questions }))
    .digest("hex");
}

function parseStoredResult(value: string | null): ForementionMiniAuditResult | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ForementionMiniAuditResult;
  } catch {
    return null;
  }
}

export async function generateHunterMiniAuditQuestions(input: {
  company: HunterResearchCompany;
  signals: HunterResearchSignal[];
  aiProvider: HunterAiProvider;
}) {
  const output = await input.aiProvider.generateStructured({
    system: [
      "Generate Foremention mini-audit questions: three to five category-level buyer questions.",
      "These must sound like real questions a B2B software buyer could ask ChatGPT, Gemini, Perplexity, or another AI answer engine.",
      "Use only the supplied company and evidence to infer the category. Do not invent product claims, budgets, projects, urgency, or competitors.",
      "Prefer non-branded recommendation/comparison questions that can reveal whether the company is surfaced against alternatives.",
      "Return JSON with a single questions array.",
    ].join(" "),
    user: JSON.stringify({
      company: input.company,
      evidence: input.signals.map((signal) => ({
        id: signal.id,
        type: signal.type,
        title: signal.title,
        summary: signal.summary,
        evidenceText: signal.evidenceText,
        sourceUrl: signal.sourceUrl,
      })),
    }),
    temperature: 0.1,
  });
  const parsed = questionSchema.safeParse(output);
  if (!parsed.success) throw new Error("Hunter AI returned invalid mini-audit questions.");
  return uniqueQuestions(parsed.data.questions);
}

export async function runHunterForementionMiniAudit(
  db: Database.Database,
  input: {
    company: HunterResearchCompany;
    targetId: string;
    signals: HunterResearchSignal[];
    aiProvider: HunterAiProvider;
    requester: HunterMiniAuditRequester;
    now?: Date;
    maxAgeMs?: number;
  },
) {
  const now = input.now ?? new Date();
  const maxAgeMs = Math.max(60_000, input.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000);

  // Mini-audits are account-level evidence. Reuse a fresh successful audit across
  // the 2–3 buyers we may pursue at the same company so we do not multiply LLM
  // measurement cost simply because the buying committee has multiple people.
  const recent = db.prepare(`
    SELECT id, result_json, observed_at
    FROM hunter_mini_audits
    WHERE company_id = ? AND status = 'success' AND observed_at IS NOT NULL
    ORDER BY datetime(observed_at) DESC, datetime(updated_at) DESC
    LIMIT 1
  `).get(input.company.id) as { id: string; result_json: string | null; observed_at: string | null } | undefined;
  if (recent?.observed_at) {
    const observedAt = Date.parse(recent.observed_at);
    const parsed = parseStoredResult(recent.result_json);
    if (parsed && Number.isFinite(observedAt) && now.getTime() - observedAt <= maxAgeMs) {
      return {
        audit: parsed,
        auditId: recent.id,
        reused: true,
        questions: parsed.questions.map((item) => item.question).slice(0, 5),
      };
    }
  }

  const questions = await generateHunterMiniAuditQuestions({
    company: input.company,
    signals: input.signals,
    aiProvider: input.aiProvider,
  });
  const fingerprint = requestFingerprint(input.company.domain, questions);

  const existing = db.prepare(`
    SELECT id, result_json, observed_at
    FROM hunter_mini_audits
    WHERE request_fingerprint = ? AND status = 'success'
    LIMIT 1
  `).get(fingerprint) as { id: string; result_json: string | null; observed_at: string | null } | undefined;
  if (existing?.observed_at) {
    const observedAt = Date.parse(existing.observed_at);
    const parsed = parseStoredResult(existing.result_json);
    if (parsed && Number.isFinite(observedAt) && now.getTime() - observedAt <= maxAgeMs) {
      return { audit: parsed, auditId: existing.id, reused: true, questions };
    }
  }

  const id = existing?.id || randomUUID();
  db.prepare(`
    INSERT INTO hunter_mini_audits (
      id, company_id, target_id, request_fingerprint, status, result_json, error, observed_at, updated_at
    ) VALUES (?, ?, ?, ?, 'running', NULL, NULL, NULL, datetime('now'))
    ON CONFLICT(request_fingerprint) DO UPDATE SET
      company_id = excluded.company_id,
      target_id = excluded.target_id,
      status = 'running',
      error = NULL,
      updated_at = datetime('now')
  `).run(id, input.company.id, input.targetId, fingerprint);

  try {
    const audit = await input.requester({
      brand: input.company.name,
      domain: input.company.domain,
      questions,
    });
    db.prepare(`
      UPDATE hunter_mini_audits
      SET status = 'success', result_json = ?, error = NULL, observed_at = ?, updated_at = datetime('now')
      WHERE request_fingerprint = ?
    `).run(JSON.stringify(audit), audit.collectedAt || now.toISOString(), fingerprint);
    return { audit, auditId: id, reused: false, questions };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE hunter_mini_audits
      SET status = 'failed', error = ?, updated_at = datetime('now')
      WHERE request_fingerprint = ?
    `).run(message.slice(0, 1000), fingerprint);
    throw error;
  }
}
