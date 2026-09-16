import { z } from "zod";
import type { HunterAiProvider } from "./ai";
import type { ForementionMiniAuditResult } from "./foremention-client";

export type HunterResearchTarget = {
  id: string;
  fullName: string;
  role: string;
  email?: string | null;
  linkedinUrl?: string | null;
};

export type HunterResearchCompany = {
  id: string;
  name: string;
  domain: string;
};

export type HunterResearchSignal = {
  id: string;
  type: string;
  title: string;
  summary: string;
  evidenceText: string;
  sourceUrl: string;
  observedAt: string;
  confidence: number;
};

export type HunterEvidenceItem = {
  id: string;
  kind: "signal" | "mini_audit";
  text: string;
  sourceUrl?: string | null;
  observedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type HunterResearchClaim = {
  id: string;
  kind: "timing" | "pain" | "visibility" | "buyer";
  text: string;
  provenanceIds: string[];
};

export type HunterResearchPacket = {
  target: HunterResearchTarget;
  company: HunterResearchCompany;
  evidence: HunterEvidenceItem[];
  claims: HunterResearchClaim[];
  createdAt: string;
};

const generatedResearchSchema = z.object({
  summary: z.string().min(1).max(1_500),
  whyNow: z.string().min(1).max(1_000),
  outreachAngle: z.string().min(1).max(1_000),
  claims: z.array(z.object({
    text: z.string().min(1).max(800),
    provenanceIds: z.array(z.string().min(1)).min(1).max(8),
  })).max(12),
});

function clean(value: string, max = 2_000) {
  return value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildResearchBrief(input: {
  target: HunterResearchTarget;
  company: HunterResearchCompany;
  signals: HunterResearchSignal[];
  miniAudit?: ForementionMiniAuditResult | null;
}): HunterResearchPacket {
  const evidence: HunterEvidenceItem[] = [];
  const claims: HunterResearchClaim[] = [];

  for (const signal of input.signals) {
    const id = signal.id;
    const text = clean(signal.evidenceText || signal.summary);
    if (!id || !text || !signal.sourceUrl) continue;
    evidence.push({
      id,
      kind: "signal",
      text,
      sourceUrl: signal.sourceUrl,
      observedAt: signal.observedAt,
      metadata: { type: signal.type, confidence: signal.confidence, title: signal.title },
    });
    claims.push({
      id: `claim:${id}`,
      kind: signal.type.includes("hiring") || signal.type === "leadership_change" ? "timing" : "pain",
      text: clean(`${signal.title}: ${signal.summary}`, 900),
      provenanceIds: [id],
    });
  }

  for (let questionIndex = 0; questionIndex < (input.miniAudit?.questions.length ?? 0); questionIndex += 1) {
    const question = input.miniAudit!.questions[questionIndex];
    for (let observationIndex = 0; observationIndex < question.observations.length; observationIndex += 1) {
      const observation = question.observations[observationIndex];
      if (observation.status !== "ok" || !observation.answer) continue;
      const id = `mini:${questionIndex + 1}:${observationIndex + 1}`;
      evidence.push({
        id,
        kind: "mini_audit",
        text: clean(observation.answer, 12_000),
        sourceUrl: observation.citations[0]?.url ?? null,
        observedAt: observation.collectedAt ?? input.miniAudit!.collectedAt,
        metadata: {
          question: question.question,
          provider: observation.provider,
          model: observation.model,
          citations: observation.citations,
          brandMentioned: observation.brandMentioned,
          domainCited: observation.domainCited,
          competitorMentions: observation.competitorMentions ?? [],
        },
      });
      const brand = input.miniAudit!.brand;
      claims.push({
        id: `claim:${id}:brand`,
        kind: "visibility",
        text: observation.brandMentioned
          ? `${brand} was observed in the ${observation.provider} answer to “${clean(question.question, 300)}”.`
          : `${brand} was not observed in the ${observation.provider} answer to “${clean(question.question, 300)}”.`,
        provenanceIds: [id],
      });
      if ((observation.competitorMentions ?? []).length > 0) {
        claims.push({
          id: `claim:${id}:competitors`,
          kind: "visibility",
          text: `${(observation.competitorMentions ?? []).join(", ")} ${observation.competitorMentions!.length === 1 ? "was" : "were"} observed in the same answer.`,
          provenanceIds: [id],
        });
      }
    }
  }

  return {
    target: {
      ...input.target,
      fullName: clean(input.target.fullName, 200),
      role: clean(input.target.role, 200),
    },
    company: {
      ...input.company,
      name: clean(input.company.name, 200),
      domain: clean(input.company.domain, 300),
    },
    evidence,
    claims,
    createdAt: new Date().toISOString(),
  };
}

export async function generateResearchSummary(packet: HunterResearchPacket, provider: HunterAiProvider) {
  if (!packet.evidence.length) throw new Error("Research requires at least one evidence item.");
  const output = await provider.generateStructured({
    system: [
      "You are Foremention Customer Hunter research.",
      "Use only the supplied evidence. Do not infer budgets, projects, urgency, motives, or buying intent that the evidence does not support.",
      "Every factual claim in claims must cite one or more supplied evidence ids in provenanceIds.",
      "Return JSON with summary, whyNow, outreachAngle, and claims.",
    ].join(" "),
    user: JSON.stringify(packet),
    temperature: 0.1,
  });

  const parsed = generatedResearchSchema.safeParse(output);
  if (!parsed.success) throw new Error("Hunter AI returned an invalid research summary.");
  const allowed = new Set(packet.evidence.map((item) => item.id));
  for (const claim of parsed.data.claims) {
    if (claim.provenanceIds.some((id) => !allowed.has(id))) {
      throw new Error("Hunter AI emitted unsupported provenance.");
    }
  }
  return parsed.data;
}
