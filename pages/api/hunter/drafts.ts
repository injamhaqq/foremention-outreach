import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { hunterAiProviderFromEnv } from "@/lib/hunter/ai";
import { generateHunterDraft, type HunterDraftChannel } from "@/lib/hunter/drafts";
import { buildResearchBrief, type HunterResearchPacket } from "@/lib/hunter/research";
import { getHunterRepository } from "@/lib/hunter/runtime-repository";
import { loadStoredResearchInputs } from "@/lib/hunter/stored-evidence";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const clientPacket = req.body?.packet as HunterResearchPacket | undefined;
  const channel = req.body?.channel as HunterDraftChannel | undefined;
  if (!clientPacket?.target?.id || !clientPacket.company?.id || (channel !== "email" && channel !== "linkedin")) {
    return res.status(400).json({ error: "packet and channel are required" });
  }
  try {
    // Rebuild the packet from stored signals: the client may only choose WHICH
    // stored evidence to use, never supply the evidence itself.
    const evidenceIds = Array.isArray(clientPacket.evidence)
      ? clientPacket.evidence.map((item) => String(item?.id ?? "").trim()).filter(Boolean)
      : [];
    if (!evidenceIds.length) return res.status(400).json({ error: "Cold outreach requires stored evidence." });
    const stored = loadStoredResearchInputs(getDb(), {
      targetId: clientPacket.target.id,
      companyId: clientPacket.company.id,
      signalIds: evidenceIds,
    });
    const packet = buildResearchBrief({ ...stored, miniAudit: null });
    const generated = await generateHunterDraft(packet, channel, hunterAiProviderFromEnv());
    const draft = getHunterRepository().saveHunterDraft({
      targetId: packet.target.id,
      companyId: packet.company.id,
      channel,
      subject: generated.subject,
      body: generated.body,
      evidenceIds: generated.evidenceIds,
      firstTouchFingerprint: generated.firstTouchFingerprint,
    });
    return res.status(201).json({ data: draft });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Draft generation failed" });
  }
}
