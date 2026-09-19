import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeDiscoveryCandidates,
  normalizeDiscoveryCandidate,
  runDiscoveryProviders,
  type HunterDiscoveryProvider,
} from "../../lib/hunter/discovery";

test("normalizes domains and requires source provenance", () => {
  const normalized = normalizeDiscoveryCandidate({
    name: " Acme ",
    domain: "HTTPS://WWW.Acme.com/pricing?x=1",
    sourceUrl: "https://example.com/acme",
    sourceName: "Example",
    evidenceText: "Acme is hiring a Head of SEO.",
  });
  assert.equal(normalized.domain, "acme.com");
  assert.equal(normalized.name, "Acme");
  assert.throws(
    () => normalizeDiscoveryCandidate({
      name: "No Source",
      domain: "nosource.com",
      sourceUrl: "",
      sourceName: "bad",
      evidenceText: "missing source",
    }),
    /source URL/i,
  );
});

test("deduplicates the same company across sources while preserving evidence", () => {
  const items = dedupeDiscoveryCandidates([
    {
      name: "Acme",
      domain: "acme.com",
      sourceUrl: "https://jobs.acme.com/seo",
      sourceName: "jobs",
      evidenceText: "Hiring SEO",
    },
    {
      name: "Acme Inc",
      domain: "www.acme.com",
      sourceUrl: "https://news.example/acme",
      sourceName: "news",
      evidenceText: "Raised Series B",
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].domain, "acme.com");
  assert.equal(items[0].provenance.length, 2);
});

test("provider failure does not discard results from healthy providers", async () => {
  const healthy: HunterDiscoveryProvider = {
    id: "healthy",
    search: async () => [{
      name: "Acme",
      domain: "acme.com",
      sourceUrl: "https://example.com/acme",
      sourceName: "healthy",
      evidenceText: "Relevant signal",
    }],
  };
  const failing: HunterDiscoveryProvider = {
    id: "failing",
    search: async () => { throw new Error("provider down"); },
  };
  const result = await runDiscoveryProviders([failing, healthy], {
    query: "AI search SaaS",
    limit: 10,
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].providerId, "failing");
});
