import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchBrief, generateResearchSummary } from "../../lib/hunter/research.ts";

const miniAudit = {
  brand: "Acme",
  domain: "acme.example",
  collectedAt: "2026-09-16T00:00:00.000Z",
  questions: [{
    question: "What are the best tools in Acme's category?",
    observations: [{
      provider: "groq",
      model: "compound",
      status: "ok" as const,
      answer: "CompetitorCo is commonly recommended. Acme is not mentioned.",
      citations: [{ url: "https://industry.example/best-tools", title: "Best tools" }],
      brandMentioned: false,
      domainCited: false,
      competitorMentions: ["CompetitorCo"],
      collectedAt: "2026-09-16T00:00:00.000Z",
    }],
  }],
};

test("research brief emits only claims with explicit provenance", () => {
  const packet = buildResearchBrief({
    target: { id: "target-1", fullName: "Jane Smith", role: "Head of SEO", email: "jane@acme.example", linkedinUrl: "https://linkedin.com/in/jane" },
    company: { id: "company-1", name: "Acme", domain: "acme.example" },
    signals: [{
      id: "signal-1",
      type: "ai_search_hiring",
      title: "Hiring for AI search",
      summary: "Acme is hiring an SEO leader to work on AI search.",
      evidenceText: "The job description mentions AI Overviews and generative search.",
      sourceUrl: "https://acme.example/jobs/seo",
      observedAt: "2026-09-16T00:00:00.000Z",
      confidence: 0.95,
    }],
    miniAudit,
  });

  assert.ok(packet.claims.length >= 2);
  const evidenceIds = new Set(packet.evidence.map((item) => item.id));
  for (const claim of packet.claims) {
    assert.ok(claim.provenanceIds.length > 0, `claim missing provenance: ${claim.text}`);
    for (const id of claim.provenanceIds) assert.equal(evidenceIds.has(id), true, `unknown provenance id: ${id}`);
  }
});

test("AI research summary rejects claims with provenance outside the packet", async () => {
  const packet = buildResearchBrief({
    target: { id: "target-1", fullName: "Jane Smith", role: "Head of SEO", email: "jane@acme.example", linkedinUrl: null },
    company: { id: "company-1", name: "Acme", domain: "acme.example" },
    signals: [{
      id: "signal-1",
      type: "ai_search_hiring",
      title: "Hiring for AI search",
      summary: "Acme is hiring for AI search.",
      evidenceText: "AI search appears in the job description.",
      sourceUrl: "https://acme.example/jobs/seo",
      observedAt: "2026-09-16T00:00:00.000Z",
      confidence: 0.9,
    }],
    miniAudit,
  });

  await assert.rejects(
    generateResearchSummary(packet, {
      generateStructured: async () => ({
        summary: "Acme has an urgent budget approved for Foremention.",
        whyNow: "Budget approved.",
        outreachAngle: "Lead with the approved budget.",
        claims: [{ text: "Budget approved.", provenanceIds: ["invented-evidence"] }],
      }),
    }),
    /unsupported provenance/i,
  );
});
