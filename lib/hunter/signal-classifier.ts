import type { HunterSignalCandidate } from "./signals";

export type DiscoveryEvidenceInput = {
  sourceUrl: string;
  sourceName?: string | null;
  evidenceText: string;
  observedAt: string;
};

const AI_SEARCH = /\b(ai\s*overviews?|generative\s+(?:engine|search)|\bgeo\b|\baeo\b|llm\s+(?:visibility|search|optimization)|chatgpt|perplexity|gemini|ai[-\s]?search|answer\s+engine)/i;
const SEO = /\b(seo|organic\s+(?:search|growth|traffic)|search\s+(?:strategy|visibility)|content\s+(?:strategy|seo|growth))/i;
const HIRING = /\b(hiring|hire|job|opening|vacancy|role|join\s+our\s+team|director|head\s+of|manager|lead\s+of)/i;
const LEADERSHIP = /\b(appointed|welcomes?|joins?|named|new)\b.{0,80}\b(cmo|chief marketing officer|vp\s+(?:of\s+)?marketing|vp\s+(?:of\s+)?growth|head\s+of\s+(?:seo|organic|content|growth))/i;
const FUNDING = /\b(raised|funding|series\s+[a-e]|seed\s+round|venture\s+round|investment\s+round)\b/i;
const EXPANSION = /\b(expand(?:s|ed|ing)?|expansion|new\s+market|international\s+growth|grow(?:ing|th)?\s+(?:team|market|globally))/i;
const LAUNCH = /\b(launch(?:es|ed|ing)?|unveil(?:s|ed)?|new\s+product|new\s+platform|general\s+availability)\b/i;

function make(
  type: HunterSignalCandidate["type"],
  input: DiscoveryEvidenceInput,
  title: string,
  summary: string,
  strength: number,
  confidence: number,
): HunterSignalCandidate {
  return {
    type,
    title,
    summary,
    sourceUrl: input.sourceUrl,
    sourceName: input.sourceName,
    evidenceText: input.evidenceText.trim().slice(0, 4_000),
    observedAt: input.observedAt,
    confidence,
    strength,
  };
}

export function classifyDiscoveryEvidence(input: DiscoveryEvidenceInput): HunterSignalCandidate[] {
  const text = input.evidenceText.trim();
  if (!text) return [];
  const signals: HunterSignalCandidate[] = [];
  const ai = AI_SEARCH.test(text);
  const seo = SEO.test(text);
  const hiring = HIRING.test(text);

  if (ai && hiring) {
    signals.push(make("ai_search_hiring", input, "AI-search hiring signal", "The company is recruiting around AI/generative search.", 20, 0.9));
  } else if (seo && hiring) {
    signals.push(make("seo_hiring", input, "SEO or organic-growth hiring signal", "The company is recruiting for search or organic growth.", 15, 0.82));
  } else if (ai) {
    signals.push(make("public_ai_search", input, "AI-search activity signal", "The company is publicly discussing or investing in AI/generative search.", 15, 0.8));
  }

  if (LEADERSHIP.test(text)) signals.push(make("leadership_change", input, "Relevant marketing leadership change", "A relevant marketing/search leader appears to have changed.", 8, 0.75));
  if (FUNDING.test(text)) signals.push(make("funding", input, "Funding signal", "Recent funding can increase budget and growth pressure.", 8, 0.72));
  if (EXPANSION.test(text)) signals.push(make("expansion", input, "Expansion signal", "The company appears to be expanding its market or growth motion.", 8, 0.7));
  if (LAUNCH.test(text)) signals.push(make("launch", input, "Launch signal", "A recent launch can create new discoverability pressure.", 8, 0.7));
  return signals;
}
