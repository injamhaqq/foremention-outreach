import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { applyHunterReplyEvent } from "@/lib/hunter/replies";
import { ensureHunterSchema } from "@/lib/hunter/schema";

const payload = z.object({
  targetId: z.string().min(1).max(200),
  channel: z.enum(["email", "linkedin"]),
  kind: z.enum(["positive", "question", "objection", "not_now", "referral", "ooo", "unsubscribe", "bounce", "complaint", "negative"]),
  receivedAt: z.string().datetime(),
  sourceReplyId: z.string().max(300).nullable().optional(),
  resumeAt: z.string().datetime().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  classifier: z.string().max(80).optional(),
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const parsed = payload.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid reply event.", details: parsed.error.flatten() });

  try {
    const db = getDb();
    ensureHunterSchema(db);
    const result = applyHunterReplyEvent(db, parsed.data);
    return res.status(200).json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reply could not be processed.";
    return res.status(message === "HUNTER_TARGET_NOT_FOUND" ? 404 : 400).json({ error: message });
  }
}
