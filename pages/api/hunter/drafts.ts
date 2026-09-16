import type { NextApiRequest, NextApiResponse } from "next";
import { hunterAiProviderFromEnv } from "@/lib/hunter/ai";
import { generateHunterDraft, type HunterDraftChannel } from "@/lib/hunter/drafts";
import { getHunterRepository } from "@/lib/hunter/runtime-repository";
import type { HunterResearchPacket } from "@/lib/hunter/research";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const packet = req.body?.packet as HunterResearchPacket | undefined;
  const channel = req.body?.channel as HunterDraftChannel | undefined;
  if (!packet?.target?.id || !packet.company?.id || (channel !== "email" && channel !== "linkedin")) {
    return res.status(400).json({ error: "packet and channel are required" });
  }
  try {
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
