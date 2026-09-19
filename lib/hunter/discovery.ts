export type HunterDiscoverySearchInput = {
  query: string;
  limit: number;
};

export type HunterDiscoveryCandidate = {
  name: string;
  domain: string;
  sourceUrl: string;
  sourceName: string;
  evidenceText: string;
};

export type HunterDiscoveryProvenance = {
  sourceUrl: string;
  sourceName: string;
  evidenceText: string;
};

export type NormalizedHunterDiscoveryCandidate = {
  name: string;
  domain: string;
  provenance: HunterDiscoveryProvenance[];
};

export type HunterDiscoveryProvider = {
  id: string;
  search(input: HunterDiscoverySearchInput): Promise<HunterDiscoveryCandidate[]>;
};

function clean(value: string, max = 2_000) {
  return value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeHttpUrl(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${label} must use http or https.`);
  return url;
}

export function normalizeDiscoveryCandidate(input: HunterDiscoveryCandidate): NormalizedHunterDiscoveryCandidate {
  const source = normalizeHttpUrl(input.sourceUrl, "Source URL");
  const domainUrl = normalizeHttpUrl(input.domain, "Domain");
  const domain = domainUrl.hostname.toLowerCase().replace(/^www\./, "");
  if (!domain || !domain.includes(".")) throw new Error("A valid company domain is required.");
  const name = clean(input.name || domain, 300) || domain;
  const evidenceText = clean(input.evidenceText || input.name || domain, 4_000);
  return {
    name,
    domain,
    provenance: [{
      sourceUrl: source.toString(),
      sourceName: clean(input.sourceName || source.hostname, 120) || source.hostname,
      evidenceText,
    }],
  };
}

export function dedupeDiscoveryCandidates(inputs: HunterDiscoveryCandidate[]): NormalizedHunterDiscoveryCandidate[] {
  const byDomain = new Map<string, NormalizedHunterDiscoveryCandidate>();
  for (const input of inputs) {
    const normalized = normalizeDiscoveryCandidate(input);
    const existing = byDomain.get(normalized.domain);
    if (!existing) {
      byDomain.set(normalized.domain, normalized);
      continue;
    }
    const seen = new Set(existing.provenance.map((item) => `${item.sourceUrl}|${item.evidenceText}`));
    for (const provenance of normalized.provenance) {
      const key = `${provenance.sourceUrl}|${provenance.evidenceText}`;
      if (!seen.has(key)) {
        existing.provenance.push(provenance);
        seen.add(key);
      }
    }
    if (existing.name === existing.domain && normalized.name !== normalized.domain) existing.name = normalized.name;
  }
  return [...byDomain.values()];
}

export async function runDiscoveryProviders(
  providers: HunterDiscoveryProvider[],
  input: HunterDiscoverySearchInput,
) {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 10)));
  const query = clean(input.query, 800);
  if (!query) throw new Error("Discovery query is required.");

  const candidates: HunterDiscoveryCandidate[] = [];
  const errors: Array<{ providerId: string; error: string }> = [];
  for (const provider of providers) {
    try {
      const results = await provider.search({ query, limit });
      candidates.push(...results.slice(0, limit));
    } catch (error) {
      errors.push({
        providerId: provider.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    candidates: dedupeDiscoveryCandidates(candidates).slice(0, limit),
    errors,
  };
}
