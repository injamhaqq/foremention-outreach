import assert from "node:assert/strict";
import test from "node:test";
import { createCrawl4AiClient } from "../../lib/hunter/crawl4ai";

test("Crawl4AI client fetches a company page without allowing remote hooks", async () => {
  const client = createCrawl4AiClient({
    baseUrl: "http://crawl4ai.internal:11235",
    apiToken: "crawl-token",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "http://crawl4ai.internal:11235/crawl");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer crawl-token");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.urls, ["https://acme.com"]);
      assert.equal("hooks" in body, false);
      assert.equal("js_code" in body, false);
      assert.equal("proxy_config" in body, false);
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

test("Crawl4AI auth header is omitted only when no API token is configured", async () => {
  const client = createCrawl4AiClient({
    baseUrl: "http://127.0.0.1:11235",
    fetchImpl: async (_input, init) => {
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return new Response(JSON.stringify({
        results: [{ success: true, markdown: "ok" }],
      }), { status: 200 });
    },
  });
  await client.crawl("https://example.com");
});
