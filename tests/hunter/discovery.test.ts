import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeDiscoveryCandidates,
  isNonCompanyDiscoveryDomain,
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


test("rejects infrastructure, social, job-board and publisher domains as target companies", () => {
  for (const domain of [
    "boards.greenhouse.io",
    "jobs.lever.co",
    "acme.wd5.myworkdayjobs.com",
    "linkedin.com",
    "www.linkedin.com",
    "techcrunch.com",
    "prnewswire.com",
    "reuters.com",
    "indeed.com",
    "wellfound.com",
  ]) {
    assert.equal(isNonCompanyDiscoveryDomain(domain), true, domain);
  }

  for (const domain of ["acme.com", "careers.acme.com", "example.co.uk"]) {
    assert.equal(isNonCompanyDiscoveryDomain(domain), false, domain);
  }
});

test("normalization refuses blocked third-party discovery domains instead of creating false prospect accounts", () => {
  assert.throws(
    () => normalizeDiscoveryCandidate({
      name: "Acme Head of SEO",
      domain: "boards.greenhouse.io",
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/123",
      sourceName: "SearXNG",
      evidenceText: "Acme is hiring a Head of SEO to own AI Overviews.",
    }),
    /not a target-company domain/i,
  );
  assert.throws(
    () => normalizeDiscoveryCandidate({
      name: "Acme raises Series B",
      domain: "techcrunch.com",
      sourceUrl: "https://techcrunch.com/acme-series-b",
      sourceName: "SearXNG",
      evidenceText: "Acme raised a Series B.",
    }),
    /not a target-company domain/i,
  );
});
