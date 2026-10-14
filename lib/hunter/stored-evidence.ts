import type Database from "better-sqlite3";
import { ensureHunterSchema } from "./schema";
import type { HunterResearchCompany, HunterResearchSignal, HunterResearchTarget } from "./research";

/**
 * Research packets and drafts must be built from evidence the server stored,
 * never from evidence text a client posts. These helpers reload the target,
 * company and signals from SQLite so a caller cannot inject fabricated
 * "evidence" that the provenance check would then treat as supported.
 */
export class StoredEvidenceError extends Error {
  readonly code = "stored_evidence_required";
  constructor(message: string) {
    super(message);
    this.name = "StoredEvidenceError";
  }
}

export type StoredResearchInputs = {
  target: HunterResearchTarget;
  company: HunterResearchCompany;
  signals: HunterResearchSignal[];
};

export function loadStoredResearchInputs(
  db: Database.Database,
  input: { targetId: string; companyId: string; signalIds?: string[] | null },
): StoredResearchInputs {
  ensureHunterSchema(db);
  const target = db.prepare(`
    SELECT id, full_name, title, email, linkedin_url, company_id
    FROM targets WHERE id = ?
  `).get(input.targetId) as {
    id: string;
    full_name: string | null;
    title: string | null;
    email: string | null;
    linkedin_url: string | null;
    company_id: string | null;
  } | undefined;
  if (!target) throw new StoredEvidenceError("Stored evidence required: target not found.");
  if (!target.company_id || target.company_id !== input.companyId) {
    throw new StoredEvidenceError("Stored evidence required: target does not belong to this company.");
  }
  const company = db.prepare("SELECT id, name, domain FROM companies WHERE id = ?").get(input.companyId) as
    | { id: string; name: string | null; domain: string | null }
    | undefined;
  if (!company) throw new StoredEvidenceError("Stored evidence required: company not found.");

  const rows = db.prepare(`
    SELECT id, type, title, summary, evidence_text, source_url, observed_at, confidence
    FROM hunter_signals
    WHERE company_id = ?
    ORDER BY observed_at DESC, id ASC
  `).all(input.companyId) as Array<{
    id: string;
    type: string;
    title: string;
    summary: string;
    evidence_text: string;
    source_url: string;
    observed_at: string;
    confidence: number;
  }>;

  let selected = rows;
  if (input.signalIds) {
    const wanted = new Set(input.signalIds);
    selected = rows.filter((row) => wanted.has(row.id));
    const found = new Set(selected.map((row) => row.id));
    const missing = [...wanted].filter((id) => !found.has(id));
    if (missing.length) {
      throw new StoredEvidenceError(
        `Stored evidence required: ${missing.length} evidence item(s) are not stored signals for this company.`,
      );
    }
  }

  return {
    target: {
      id: target.id,
      fullName: target.full_name || target.email || "Unknown buyer",
      role: target.title || "Buyer",
      email: target.email,
      linkedinUrl: target.linkedin_url,
    },
    company: {
      id: company.id,
      name: company.name || company.domain || "Unknown company",
      domain: company.domain || "",
    },
    signals: selected.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      summary: row.summary,
      evidenceText: row.evidence_text,
      sourceUrl: row.source_url,
      observedAt: row.observed_at,
      confidence: Number(row.confidence),
    })),
  };
}
