import assert from "node:assert/strict";
import test from "node:test";
import { createFirecrawlProvider, createSearxngProvider } from "../../lib/hunter/source-providers";

test("SearXNG provider converts search results into attributable discovery candidates", async () => {
  const provider = createSearxngProvider({
    baseUrl: "https://search.internal",
    fetchImpl: async () => new Response(JSON.stringify({
      results: [{ url: "https://acme.com/blog/ai-search", title: "Acme AI Search", content: "Acme is investing in AI search." }],
    }), { status: 200 }),
  });
  const results = await provider.search({ query: "AI search SaaS", limit: 5 });
  assert.equal(results[0].domain, "acme.com");
  assert.equal(results[0].sourceName, "searxng");
  assert.match(results[0].evidenceText, /investing in AI search/i);
});

test("Firecrawl provider converts search API results into attributable candidates", async () => {
  const provider = createFirecrawlProvider({
    baseUrl: "https://api.firecrawl.dev",
    apiKey: "test",
    fetchImpl: async (_input, init) => {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        success: true,
        data: [{ url: "https://beta.example.com/jobs/seo", title: "SEO Lead", description: "Own AI Overviews and generative search." }],
      }), { status: 200 });
    },
  });
  const results = await provider.search({ query: "GEO hiring SaaS", limit: 5 });
  assert.equal(results[0].domain, "beta.example.com");
  assert.equal(results[0].sourceName, "firecrawl");
  assert.match(results[0].evidenceText, /generative search/i);
});
