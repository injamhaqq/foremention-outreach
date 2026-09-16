import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { ensureHunterSchema } from "@/lib/hunter/schema";
import {
  aggregateHunterOutcomeMetrics,
  HUNTER_OPPORTUNITY_STAGES,
  listHunterOpportunities,
  transitionHunterOpportunity,
} from "@/lib/hunter/opportunities";

const transitionInput = z.object({
  companyId: z.string().min(1).max(200),
  targetId: z.string().min(1).max(200).nullable().optional(),
  toStage: z.enum(HUNTER_OPPORTUNITY_STAGES),
  allowForwardSkip: z.boolean().optional(),
  nextAction: z.string().max(1000).nullable().optional(),
  nextActionDueAt: z.string().datetime().nullable().optional(),
  commercialEvidence: z.array(z.record(z.string(), z.unknown()).and(z.object({ type: z.string().min(1).max(100), reference: z.string().max(300).optional() }))).max(20).optional(),
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  ensureHunterSchema(db);

  if (req.method === "GET") {
    return res.status(200).json({
      data: listHunterOpportunities(db),
      metrics: aggregateHunterOutcomeMetrics(db),
    });
  }

  if (req.method === "POST") {
    const parsed = transitionInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid opportunity transition.", details: parsed.error.flatten() });
    try {
      const result = transitionHunterOpportunity(db, parsed.data);
      return res.status(200).json({ data: result });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Opportunity transition failed." });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed." });
}
