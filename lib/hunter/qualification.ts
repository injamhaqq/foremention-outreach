import type {
  HunterBuyerInput,
  HunterQualificationInput,
  HunterQualificationResult,
  HunterRoute,
  HunterSignalInput,
} from "./types";

const STRONG_SIGNAL_TYPES = new Set<HunterSignalInput["type"]>([
  "ai_search_hiring",
  "seo_hiring",
  "public_ai_search",
  "leadership_change",
  "foremention_gap",
  "citation_gap",
]);

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function scoreFit(input: HunterQualificationInput["fit"]) {
  return (
    (input.b2bSoftware ? 15 : 0) +
    (input.employeeBandFit ? 10 : 0) +
    (input.organicMotion ? 10 : 0) +
    (input.marketFit ? 5 : 0)
  );
}

function validEvidence(signal: HunterSignalInput) {
  if (!signal.sourceUrl.trim()) return false;
  if (!signal.observedAt.trim()) return false;
  return !Number.isNaN(Date.parse(signal.observedAt));
}

function scoreIntent(signals: HunterSignalInput[]) {
  return Math.trunc(
    clamp(
      signals
        .filter(validEvidence)
        .reduce((sum, signal) => sum + clamp(signal.strength, 0, 40), 0),
      0,
      40,
    ),
  );
}

function strongSignalCount(signals: HunterSignalInput[]) {
  return signals.filter(
    (signal) => validEvidence(signal) && signal.strength > 0 && STRONG_SIGNAL_TYPES.has(signal.type),
  ).length;
}

function normalizeRole(role: string) {
  return role.trim().toLocaleLowerCase();
}

function scoreBuyer(buyer: HunterBuyerInput | null) {
  if (!buyer || (!buyer.hasEmail && !buyer.hasLinkedIn)) return 0;

  const role = normalizeRole(buyer.role);
  if (!role) return 0;

  if (
    role === "cmo" ||
    role.includes("chief marketing officer") ||
    role.includes("vp marketing") ||
    role.includes("vice president marketing") ||
    role.includes("vp growth") ||
    role.includes("vice president growth") ||
    role.includes("head of seo") ||
    role.includes("head seo") ||
    role.includes("head of organic") ||
    role.includes("head organic")
  ) {
    return 20;
  }

  if (
    role.includes("head of content") ||
    role.includes("head content") ||
    role.includes("seo manager") ||
    role.includes("geo lead") ||
    role.includes("aeo lead") ||
    role.includes("ai search") ||
    role.includes("organic growth")
  ) {
    return 15;
  }

  if (
    role.includes("marketing") ||
    role.includes("growth") ||
    role.includes("seo") ||
    role.includes("content") ||
    role.includes("organic")
  ) {
    return 10;
  }

  return 0;
}

function routeForScore(totalScore: number, forcedReady = false): HunterRoute {
  if (totalScore >= 70) return "priority";
  if (totalScore >= 55) return "good_cold";
  if (totalScore >= 40 || forcedReady) return "cold_fit";
  return "monitor";
}

export function qualifyHunterCandidate(input: HunterQualificationInput): HunterQualificationResult {
  const fitScore = scoreFit(input.fit);
  const intentScore = scoreIntent(input.signals);
  const buyerScore = scoreBuyer(input.buyer);
  const strongSignals = strongSignalCount(input.signals);
  const totalScore = fitScore + intentScore + buyerScore;

  if (fitScore <= 0) {
    return {
      fitScore,
      intentScore,
      buyerScore,
      totalScore,
      outreachReady: false,
      route: "monitor",
      reason: "MISSING_FIT",
      strongSignalCount: strongSignals,
    };
  }

  if (strongSignals <= 0) {
    return {
      fitScore,
      intentScore,
      buyerScore,
      totalScore,
      outreachReady: false,
      route: "monitor",
      reason: "MISSING_SIGNAL",
      strongSignalCount: strongSignals,
    };
  }

  if (buyerScore <= 0) {
    return {
      fitScore,
      intentScore,
      buyerScore,
      totalScore,
      outreachReady: false,
      route: "monitor",
      reason: "MISSING_BUYER",
      strongSignalCount: strongSignals,
    };
  }

  return {
    fitScore,
    intentScore,
    buyerScore,
    totalScore,
    outreachReady: true,
    route: routeForScore(totalScore, true),
    reason: "TWO_SIGNAL_RULE",
    strongSignalCount: strongSignals,
  };
}
