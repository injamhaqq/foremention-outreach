import test from "node:test";
import assert from "node:assert/strict";
import { generateHunterDraft } from "../../lib/hunter/drafts.ts";

const packet = {
  target: { id: "target-1", fullName: "Jane Smith", role: "Head of SEO", email: "jane@acme.example", linkedinUrl: "https://linkedin.com/in/jane" },
  company: { id: "company-1", name: "Acme", domain: "acme.example" },
  evidence: [{ id: "signal-1", kind: "signal" as const, text: "Acme is hiring for AI search.", sourceUrl: "https://acme.example/jobs", observedAt: "2026-09-16T00:00:00.000Z" }],
  claims: [{ id: "claim-1", kind: "timing" as const, text: "Acme is hiring for AI search.", provenanceIds: ["signal-1"] }],
  createdAt: "2026-09-16T00:00:00.000Z",
};

test("draft generator rejects factual copy citing evidence outside the packet", async () => {
  await assert.rejects(
    generateHunterDraft(packet, "linkedin", {
      generateStructured: async () => ({
        body: "Jane — congrats on the $30M round. Want to see an AI-search audit?",
        evidenceIds: ["made-up-funding"],
      }),
    }),
    /unsupported evidence/i,
  );
});

test("draft generator returns short evidence-backed LinkedIn first touch", async () => {
  const draft = await generateHunterDraft(packet, "linkedin", {
    generateStructured: async () => ({
      body: "Jane — noticed Acme is hiring around AI search. I can send a short visibility breakdown if useful.",
      evidenceIds: ["signal-1"],
    }),
  });
  assert.equal(draft.channel, "linkedin");
  assert.equal(draft.evidenceIds[0], "signal-1");
  assert.ok(draft.body.length < 500);
});


test("draft generator has a deterministic evidence-only fallback when no AI provider is configured", async () => {
  const email = await generateHunterDraft(packet, "email");
  assert.equal(email.channel, "email");
  assert.match(email.subject || "", /Acme/);
  assert.match(email.body, /Acme is hiring for AI search/i);
  assert.match(email.body, /evidence breakdown/i);
  assert.deepEqual(email.evidenceIds, ["signal-1"]);

  const linkedin = await generateHunterDraft(packet, "linkedin", null);
  assert.equal(linkedin.channel, "linkedin");
  assert.ok(linkedin.body.length < 500);
  assert.match(linkedin.body, /^Jane — noticed /);
  assert.deepEqual(linkedin.evidenceIds, ["signal-1"]);
});
