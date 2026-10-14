import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { buildResearchBrief, generateResearchSummary } from "@/lib/hunter/research";
import { hunterAiProviderFromEnv } from "@/lib/hunter/ai";
import { createHunterRepository } from "@/lib/hunter/repository";
import { loadStoredResearchInputs } from "@/lib/hunter/stored-evidence";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function idOf(value: unknown) {
  const record = object(value);
  return typeof record?.id === "string" ? record.id.trim() : "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = object(req.body);
  if (!body) return res.status(400).json({ error: "Invalid request body" });
  const targetId = idOf(body.target);
  const companyId = idOf(body.company);
  if (!targetId || !companyId) {
    return res.status(400).json({ error: "target and company are required" });
  }
  // Only signal ids are taken from the client. Evidence text, URLs, dates and
  // any mini-audit payload are reloaded from / limited to stored records so a
  // caller cannot inject unsupported "evidence" into personalization.
  const signalIds = Array.isArray(body.signals)
    ? body.signals.map(idOf).filter(Boolean)
    : null;

  try {
    const db = getDb();
    const stored = loadStoredResearchInputs(db, { targetId, companyId, signalIds });
    const packet = buildResearchBrief({ ...stored, miniAudit: null });
    const shouldSummarize = body.summarize !== false;
    const summary = shouldSummarize ? await generateResearchSummary(packet, hunterAiProviderFromEnv()) : null;
    const saved = createHunterRepository(db).saveHunterResearchReport({
      companyId: stored.company.id,
      targetId: stored.target.id,
      report: { packet, summary },
      evidenceIds: packet.evidence.map((item) => item.id),
      confidence: packet.evidence.length ? Math.min(1, packet.evidence.length / 4) : 0,
    });
    return res.status(201).json({ id: saved.id, packet, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed";
    return res.status(/requires|required|invalid|unsupported provenance|not found|does not belong/i.test(message) ? 400 : 502).json({ error: message });
  }
}
