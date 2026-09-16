import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { enrollApprovedHunterDraft } from "@/lib/hunter/approval";
import { getHunterRepository } from "@/lib/hunter/runtime-repository";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const draftId = typeof req.body?.draftId === "string" ? req.body.draftId.trim() : "";
  const runId = typeof req.body?.runId === "string" ? req.body.runId.trim() : "";
  const approvedBy = typeof req.body?.approvedBy === "string" ? req.body.approvedBy.trim().slice(0, 200) : "founder";
  if (!draftId || !runId) return res.status(400).json({ error: "draftId and runId are required" });

  try {
    const repository = getHunterRepository();
    repository.setHunterApproval({ draftId, state: "approved", approvedBy });
    const enrollment = enrollApprovedHunterDraft(getDb(), { draftId, runId });
    return res.status(200).json({ data: enrollment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval failed";
    const status = /not found/i.test(message) ? 404 : /suppressed|approval|required|active/i.test(message) ? 409 : 400;
    return res.status(status).json({ error: message });
  }
}
