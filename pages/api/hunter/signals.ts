import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getHunterRepository } from "@/lib/hunter/runtime-repository";
import { normalizeHunterSignal, signalContribution } from "@/lib/hunter/signals";

const signalTypes = [
  "ai_search_hiring",
  "seo_hiring",
  "public_ai_search",
  "leadership_change",
  "funding",
  "expansion",
  "launch",
  "foremention_gap",
  "citation_gap",
] as const;

const signalInput = z.object({
  companyId: z.string().min(1).max(200),
  targetId: z.string().min(1).max(200).nullable().optional(),
  type: z.enum(signalTypes),
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(2000),
  sourceUrl: z.string().url().max(4000),
  sourceName: z.string().max(240).nullable().optional(),
  evidenceText: z.string().min(1).max(4000),
  observedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  confidence: z.number().min(0).max(1),
  strength: z.number().min(0).max(40),
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const repository = getHunterRepository();

  if (req.method === "GET") {
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
    if (!companyId) return res.status(400).json({ error: "companyId is required." });
    return res.status(200).json({ data: repository.listSignalsForCompany(companyId) });
  }

  if (req.method === "POST") {
    const parsed = signalInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid signal payload.", details: parsed.error.flatten() });
    }

    try {
      const normalized = normalizeHunterSignal(parsed.data);
      const saved = repository.upsertHunterSignal({
        companyId: parsed.data.companyId,
        targetId: parsed.data.targetId ?? null,
        type: normalized.type,
        title: normalized.title,
        summary: normalized.summary,
        sourceUrl: normalized.sourceUrl,
        sourceName: normalized.sourceName,
        evidenceText: normalized.evidenceText,
        observedAt: normalized.observedAt,
        publishedAt: normalized.publishedAt,
        expiresAt: normalized.expiresAt,
        confidence: normalized.confidence,
        scoreContribution: signalContribution(normalized),
      });
      return res.status(200).json({ data: saved });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Signal could not be stored." });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed." });
}
