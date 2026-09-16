import test from "node:test";
import assert from "node:assert/strict";
import { qualifyHunterCandidate } from "../../lib/hunter/qualification.ts";

test("two-signal rule makes a reachable buyer outreach-ready without a high numeric score", () => {
  const result = qualifyHunterCandidate({
    fit: {
      b2bSoftware: true,
      employeeBandFit: false,
      organicMotion: false,
      marketFit: false,
    },
    signals: [
      {
        type: "ai_search_hiring",
        strength: 20,
        sourceUrl: "https://example.com/job",
        observedAt: "2026-09-16T00:00:00.000Z",
      },
    ],
    buyer: { role: "Head of SEO", hasEmail: true, hasLinkedIn: true },
  });

  assert.equal(result.totalScore < 70, true);
  assert.equal(result.outreachReady, true);
  assert.equal(result.reason, "TWO_SIGNAL_RULE");
});

test("candidate without credible timing or pain signal is not outreach-ready", () => {
  const result = qualifyHunterCandidate({
    fit: {
      b2bSoftware: true,
      employeeBandFit: true,
      organicMotion: true,
      marketFit: true,
    },
    signals: [],
    buyer: { role: "CMO", hasEmail: true, hasLinkedIn: true },
  });

  assert.equal(result.outreachReady, false);
  assert.equal(result.route, "monitor");
  assert.equal(result.reason, "MISSING_SIGNAL");
});

test("candidate with a signal but no reachable buyer is not outreach-ready", () => {
  const result = qualifyHunterCandidate({
    fit: {
      b2bSoftware: true,
      employeeBandFit: true,
      organicMotion: true,
      marketFit: true,
    },
    signals: [
      {
        type: "public_ai_search",
        strength: 15,
        sourceUrl: "https://example.com/post",
        observedAt: "2026-09-16T00:00:00.000Z",
      },
    ],
    buyer: null,
  });

  assert.equal(result.outreachReady, false);
  assert.equal(result.reason, "MISSING_BUYER");
});
