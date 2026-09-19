import assert from "node:assert/strict";
import test from "node:test";
import { classifyDiscoveryEvidence } from "../../lib/hunter/signal-classifier";

test("AI-search hiring evidence becomes a strong AI-search hiring signal", () => {
  const signals = classifyDiscoveryEvidence({
    sourceUrl: "https://acme.com/jobs/seo",
    sourceName: "Acme careers",
    evidenceText: "We are hiring a Head of SEO to own AI Overviews, ChatGPT and generative search strategy.",
    observedAt: "2026-09-18T12:00:00.000Z",
  });
  assert.equal(signals[0]?.type, "ai_search_hiring");
  assert.equal(signals[0]?.strength, 20);
});

test("funding alone is supporting timing evidence, not a strong pain signal", () => {
  const signals = classifyDiscoveryEvidence({
    sourceUrl: "https://news.example/acme",
    sourceName: "News",
    evidenceText: "Acme raised a $20M Series B to expand globally.",
    observedAt: "2026-09-18T12:00:00.000Z",
  });
  assert.equal(signals.some((signal) => signal.type === "funding"), true);
  assert.equal(signals.some((signal) => signal.type === "ai_search_hiring" || signal.type === "public_ai_search"), false);
});

test("irrelevant generic evidence does not invent intent", () => {
  const signals = classifyDiscoveryEvidence({
    sourceUrl: "https://acme.com/about",
    sourceName: "Acme",
    evidenceText: "Acme builds software for teams.",
    observedAt: "2026-09-18T12:00:00.000Z",
  });
  assert.deepEqual(signals, []);
});
