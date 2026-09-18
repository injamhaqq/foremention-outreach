import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAICompatibleHunterProvider } from "../../lib/hunter/ai";
import type { HunterProviderUsageEvent } from "../../lib/hunter/costs";

test("AI provider emits provider-reported token usage and monetary cost without estimating", async () => {
  const usage: HunterProviderUsageEvent[] = [];
  const provider = createOpenAICompatibleHunterProvider({
    baseUrl: "https://ai.example.test/v1",
    apiKey: "test-key",
    model: "example-model",
    providerId: "example-ai",
    onUsage: (event) => usage.push(event),
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 25,
        total_tokens: 125,
        cost: 0.00125,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const result = await provider.generateStructured({ system: "Return JSON.", user: "Test." });
  assert.deepEqual(result, { ok: true });
  assert.equal(usage.length, 1);
  assert.equal(usage[0].provider, "example-ai");
  assert.equal(usage[0].eventType, "chat_completion");
  assert.equal(usage[0].unitType, "token");
  assert.equal(usage[0].units, 125);
  assert.equal(usage[0].amountUsd, 0.00125);
  assert.deepEqual(usage[0].metadata, {
    model: "example-model",
    inputTokens: 100,
    outputTokens: 25,
    usageReported: true,
  });
});

test("AI provider records tokens but leaves monetary amount unknown when provider reports no cost", async () => {
  const usage: HunterProviderUsageEvent[] = [];
  const provider = createOpenAICompatibleHunterProvider({
    baseUrl: "https://ai.example.test/v1",
    apiKey: "test-key",
    model: "example-model",
    providerId: "example-ai",
    onUsage: (event) => usage.push(event),
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
      usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await provider.generateStructured({ system: "Return JSON.", user: "Test." });
  assert.equal(usage[0].units, 100);
  assert.equal("amountUsd" in usage[0], false);
});
