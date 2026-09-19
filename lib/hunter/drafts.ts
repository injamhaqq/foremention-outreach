import { createHash } from "crypto";
import { z } from "zod";
import type { HunterAiProvider } from "./ai";
import type { HunterResearchPacket } from "./research";

export type HunterDraftChannel = "email" | "linkedin";

const outputSchema = z.object({
  subject: z.string().max(160).optional(),
  body: z.string().min(1).max(2_000),
  evidenceIds: z.array(z.string().min(1)).min(1).max(8),
});

export function hunterFirstTouchFingerprint(targetId: string, channel: HunterDraftChannel) {
  return createHash("sha256").update(`${targetId}|${channel}|first-touch`).digest("hex");
}

function deterministicHunterDraft(packet: HunterResearchPacket, channel: HunterDraftChannel) {
  const evidence = packet.evidence[0];
  const claim = packet.claims.find((item) => item.provenanceIds.includes(evidence.id));
  const firstName = packet.target.fullName.split(/\s+/).filter(Boolean)[0] || packet.target.fullName;
  const observed = (claim?.text || evidence.text).replace(/\s+/g, " ").trim();
  const maxObservation = channel === "linkedin" ? 250 : 520;
  const observation = observed.length > maxObservation
    ? `${observed.slice(0, maxObservation - 1).trimEnd()}…`
    : observed;
  const body = channel === "linkedin"
    ? `${firstName} — noticed ${observation} I can send the short evidence breakdown if useful.`
    : `${firstName} — noticed ${observation}\n\nI pulled together the supporting evidence and can send the short evidence breakdown if useful.`;
  return {
    subject: channel === "email" ? `${packet.company.name}: AI-search signal` : undefined,
    body,
    evidenceIds: claim?.provenanceIds?.length ? claim.provenanceIds.slice(0, 8) : [evidence.id],
  };
}

export async function generateHunterDraft(
  packet: HunterResearchPacket,
  channel: HunterDraftChannel,
  provider?: HunterAiProvider | null,
) {
  if (!packet.evidence.length) throw new Error("Cold outreach requires evidence.");
  const output = provider
    ? await provider.generateStructured({
    system: [
      "Write a concise Foremention first-touch cold outreach message.",
      "Start a useful conversation; do not claim the prospect is ready to buy.",
      "Use only facts present in the supplied evidence and claims.",
      "Every factual statement must be supported by evidenceIds returned in the JSON.",
      channel === "linkedin" ? "Keep the LinkedIn message under 500 characters." : "Keep the email brief and include a low-friction CTA to send the evidence breakdown.",
      "Return JSON with body, evidenceIds, and subject only for email.",
    ].join(" "),
    user: JSON.stringify(packet),
    temperature: 0.2,
  })
    : deterministicHunterDraft(packet, channel);
  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) throw new Error("Hunter AI returned an invalid cold-outreach draft.");
  if (channel === "linkedin" && parsed.data.body.length > 500) throw new Error("LinkedIn first touch is too long.");
  const allowed = new Set(packet.evidence.map((item) => item.id));
  if (parsed.data.evidenceIds.some((id) => !allowed.has(id))) throw new Error("Hunter AI used unsupported evidence.");
  return {
    channel,
    subject: channel === "email" ? (parsed.data.subject?.trim() || "") : null,
    body: parsed.data.body.trim(),
    evidenceIds: parsed.data.evidenceIds,
    firstTouchFingerprint: hunterFirstTouchFingerprint(packet.target.id, channel),
  };
}
