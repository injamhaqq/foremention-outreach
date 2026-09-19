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


const NON_COMPANY_DISCOVERY_DOMAINS = [
  // Social/community/profile surfaces: useful evidence sources, never canonical account domains.
  "linkedin.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "reddit.com",
  "medium.com",
  "substack.com",
  "wikipedia.org",
  "github.com",

  // Hosted recruiting/ATS surfaces. Keep the vendors' own corporate domains targetable
  // where possible by blocking their hosted-job subdomains rather than the whole vendor.
  "boards.greenhouse.io",
  "jobs.lever.co",
  "myworkdayjobs.com",
  "workdayjobs.com",
  "jobs.ashbyhq.com",
  "jobs.smartrecruiters.com",
  "apply.workable.com",
  "jobs.jobvite.com",
  "ats.rippling.com",
  "jobs.breezy.hr",
  "indeed.com",
  "glassdoor.com",
  "wellfound.com",
  "builtin.com",

  // News/PR/database/review publishers. Their pages can establish timing evidence, but
  // treating the publisher itself as the discovered prospect creates false accounts.
  "techcrunch.com",
  "reuters.com",
  "bloomberg.com",
  "businesswire.com",
  "prnewswire.com",
  "globenewswire.com",
  "venturebeat.com",
  "crunchbase.com",
  "finance.yahoo.com",
  "g2.com",
  "capterra.com",
  "trustradius.com",
  "softwareadvice.com",

  // Search/cache result surfaces.
  "google.com",
  "news.google.com",
  "bing.com",
] as const;

function normalizedHostname(value: string) {
  try {
    return normalizeHttpUrl(value, "Domain").hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isNonCompanyDiscoveryDomain(value: string) {
  const hostname = normalizedHostname(value);
  if (!hostname) return false;
  return NON_COMPANY_DISCOVERY_DOMAINS.some((blocked) =>
    hostname === blocked || hostname.endsWith(`.${blocked}`)
  );
}

export function normalizeDiscoveryCandidate(input: HunterDiscoveryCandidate): NormalizedHunterDiscoveryCandidate {
  const source = normalizeHttpUrl(input.sourceUrl, "Source URL");
  const domainUrl = normalizeHttpUrl(input.domain, "Domain");
  const domain = domainUrl.hostname.toLowerCase().replace(/^www\./, "");
  if (!domain || !domain.includes(".")) throw new Error("A valid company domain is required.");
  if (isNonCompanyDiscoveryDomain(domain)) {
    throw new Error(`${domain} is not a target-company domain; preserve it as third-party evidence only.`);
  }
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
    let normalized: NormalizedHunterDiscoveryCandidate;
    try {
      normalized = normalizeDiscoveryCandidate(input);
    } catch {
      // Search providers frequently return job boards, publishers and malformed URLs.
      // One unusable result must not discard valid companies from the same provider.
      continue;
    }
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
