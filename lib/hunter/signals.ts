import type { HunterSignalType } from "./types";

export type HunterSignalCandidate = {
  type: HunterSignalType;
  title: string;
  summary: string;
  sourceUrl: string;
  sourceName?: string | null;
  evidenceText: string;
  observedAt: string;
  publishedAt?: string | null;
  expiresAt?: string | null;
  confidence: number;
  strength: number;
};

export type NormalizedHunterSignal = Omit<HunterSignalCandidate, "sourceUrl" | "expiresAt" | "strength"> & {
  sourceUrl: string;
  expiresAt: string;
  strength: number;
};

const MAX_STRENGTH: Record<HunterSignalType, number> = {
  ai_search_hiring: 20,
  seo_hiring: 15,
  public_ai_search: 15,
  leadership_change: 8,
  funding: 8,
  expansion: 8,
  launch: 8,
  foremention_gap: 20,
  citation_gap: 15,
};

const DEFAULT_LIFETIME_DAYS: Record<HunterSignalType, number> = {
  ai_search_hiring: 45,
  seo_hiring: 45,
  public_ai_search: 60,
  leadership_change: 90,
  funding: 90,
  expansion: 90,
  launch: 60,
  foremention_gap: 14,
  citation_gap: 14,
};

const STRONG_TYPES = new Set<HunterSignalType>([
  "ai_search_hiring",
  "seo_hiring",
  "public_ai_search",
  "leadership_change",
  "foremention_gap",
  "citation_gap",
]);

function requireDate(value: string, field: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid date.`);
  return parsed;
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Signal source URL is required.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Signal source URL must be a valid http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Signal source URL must be a valid http(s) URL.");
  }
  url.hash = "";
  url.hostname = url.hostname.toLocaleLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function normalizeHunterSignal(input: HunterSignalCandidate): NormalizedHunterSignal {
  const title = input.title.trim();
  const summary = input.summary.trim();
  const evidenceText = input.evidenceText.trim();
  if (!title) throw new Error("Signal title is required.");
  if (!summary) throw new Error("Signal summary is required.");
  if (!evidenceText) throw new Error("Signal evidence text is required.");

  const observedAt = requireDate(input.observedAt, "Signal observedAt");
  const publishedAt = input.publishedAt ? requireDate(input.publishedAt, "Signal publishedAt") : null;
  const defaultExpiresAt = new Date(
    observedAt.getTime() + DEFAULT_LIFETIME_DAYS[input.type] * 24 * 60 * 60 * 1000,
  );
  const expiresAt = input.expiresAt ? requireDate(input.expiresAt, "Signal expiresAt") : defaultExpiresAt;

  return {
    type: input.type,
    title,
    summary,
    sourceUrl: normalizeUrl(input.sourceUrl),
    sourceName: input.sourceName?.trim() || null,
    evidenceText,
    observedAt: observedAt.toISOString(),
    publishedAt: publishedAt?.toISOString() ?? null,
    expiresAt: expiresAt.toISOString(),
    confidence: clamp(input.confidence, 0, 1),
    strength: Math.trunc(clamp(input.strength, 0, MAX_STRENGTH[input.type])),
  };
}

export function signalContribution(signal: NormalizedHunterSignal, now = new Date()) {
  const observedAt = new Date(signal.observedAt).getTime();
  const expiresAt = new Date(signal.expiresAt).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(nowMs)) return 0;
  if (observedAt > nowMs || expiresAt <= nowMs) return 0;
  return Math.trunc(clamp(signal.strength, 0, MAX_STRENGTH[signal.type]));
}

export function isStrongHunterSignal(signal: NormalizedHunterSignal, now = new Date()) {
  return STRONG_TYPES.has(signal.type) && signalContribution(signal, now) > 0;
}
