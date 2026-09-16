import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { buildResearchBrief, generateResearchSummary, type HunterResearchCompany, type HunterResearchSignal, type HunterResearchTarget } from "@/lib/hunter/research";
import { hunterAiProviderFromEnv } from "@/lib/hunter/ai";
import { createHunterRepository } from "@/lib/hunter/repository";
import type { ForementionMiniAuditResult } from "@/lib/hunter/foremention-client";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = object(req.body);
  if (!body) return res.status(400).json({ error: "Invalid request body" });
  const target = object(body.target) as HunterResearchTarget | null;
  const company = object(body.company) as HunterResearchCompany | null;
  const signals = Array.isArray(body.signals) ? body.signals as HunterResearchSignal[] : null;
  const miniAudit = body.miniAudit == null ? null : object(body.miniAudit) as ForementionMiniAuditResult | null;
  if (!target?.id || !target.fullName || !target.role || !company?.id || !company.name || !company.domain || !signals) {
    return res.status(400).json({ error: "target, company, and signals are required" });
  }

  try {
    const packet = buildResearchBrief({ target, company, signals, miniAudit });
    const shouldSummarize = body.summarize !== false;
    const summary = shouldSummarize ? await generateResearchSummary(packet, hunterAiProviderFromEnv()) : null;
    const stored = createHunterRepository(getDb()).saveHunterResearchReport({
      companyId: company.id,
      targetId: target.id,
      report: { packet, summary },
      evidenceIds: packet.evidence.map((item) => item.id),
      confidence: packet.evidence.length ? Math.min(1, packet.evidence.length / 4) : 0,
    });
    return res.status(201).json({ id: stored.id, packet, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed";
    return res.status(/requires|invalid|unsupported provenance/i.test(message) ? 400 : 502).json({ error: message });
  }
}
