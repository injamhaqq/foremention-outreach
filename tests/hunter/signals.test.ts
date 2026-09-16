import test from "node:test";
import assert from "node:assert/strict";
import {
  isStrongHunterSignal,
  normalizeHunterSignal,
  signalContribution,
} from "../../lib/hunter/signals.ts";

const now = new Date("2026-09-16T12:00:00.000Z");

test("current AI-search hiring signal contributes its full bounded weight", () => {
  const signal = normalizeHunterSignal({
    type: "ai_search_hiring",
    title: "Hiring GEO lead",
    summary: "Role owns AI search and generative discovery.",
    sourceUrl: "https://example.com/jobs/geo",
    sourceName: "Example careers",
    evidenceText: "Own AI search, GEO, and generative discovery strategy.",
    observedAt: "2026-09-16T10:00:00.000Z",
    publishedAt: "2026-09-15T00:00:00.000Z",
    expiresAt: "2026-10-16T00:00:00.000Z",
    confidence: 0.9,
    strength: 20,
  });

  assert.equal(signalContribution(signal, now), 20);
  assert.equal(isStrongHunterSignal(signal, now), true);
});

test("expired signal contributes zero and cannot qualify a prospect", () => {
  const signal = normalizeHunterSignal({
    type: "public_ai_search",
    title: "Old AI search post",
    summary: "Old discussion.",
    sourceUrl: "https://example.com/post",
    evidenceText: "We are testing AI search.",
    observedAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    confidence: 1,
    strength: 15,
  });

  assert.equal(signalContribution(signal, now), 0);
  assert.equal(isStrongHunterSignal(signal, now), false);
});

test("funding is supporting timing evidence but not a strong Foremention pain signal alone", () => {
  const signal = normalizeHunterSignal({
    type: "funding",
    title: "Series B",
    summary: "Company raised a new round.",
    sourceUrl: "https://example.com/news/funding",
    evidenceText: "Series B announced today.",
    observedAt: "2026-09-16T08:00:00.000Z",
    confidence: 1,
    strength: 8,
  });

  assert.equal(signalContribution(signal, now), 8);
  assert.equal(isStrongHunterSignal(signal, now), false);
});

test("normalization rejects evidence without an attributable source URL", () => {
  assert.throws(
    () => normalizeHunterSignal({
      type: "seo_hiring",
      title: "SEO role",
      summary: "Hiring.",
      sourceUrl: "",
      evidenceText: "Hiring an SEO leader.",
      observedAt: "2026-09-16T08:00:00.000Z",
      confidence: 1,
      strength: 15,
    }),
    /source URL/i,
  );
});
