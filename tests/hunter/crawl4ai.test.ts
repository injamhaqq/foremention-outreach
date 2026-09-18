import assert from "node:assert/strict";
import test from "node:test";
import { createCrawl4AiClient } from "../../lib/hunter/crawl4ai";

test("Crawl4AI client fetches a company page without allowing remote hooks", async () => {
  const client = createCrawl4AiClient({
    baseUrl: "http://crawl4ai.internal:11235",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "http://crawl4ai.internal:11235/crawl");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.urls, ["https://acme.com"]);
      assert.equal("hooks" in body, false);
      return new Response(JSON.stringify({
        results: [{
          url: "https://acme.com",
          success: true,
          markdown: { raw_markdown: "Acme helps B2B marketing teams improve organic growth." },
        }],
      }), { status: 200 });
    },
  });
  const result = await client.crawl("acme.com");
  assert.equal(result.domain, "acme.com");
  assert.match(result.text, /organic growth/i);
});
