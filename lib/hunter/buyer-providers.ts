export type HunterBuyerSearchInput = {
  domain: string;
  titles: string[];
  limit: number;
};

export type HunterBuyerCandidate = {
  fullName: string;
  role: string;
  email: string | null;
  emailStatus: string | null;
  linkedinUrl: string | null;
  sourceName: string;
  providerPersonId: string | null;
  confidence: number;
};

export type HunterBuyerProvider = {
  id: string;
  findBuyers(input: HunterBuyerSearchInput): Promise<HunterBuyerCandidate[]>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function clean(value: unknown, max = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function normalizedDomain(value: string) {
  const raw = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (!raw || !raw.includes(".")) throw new Error("A valid company domain is required.");
  return raw;
}

function normalizeLinkedIn(value: unknown) {
  const raw = clean(value, 1_000);
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/linkedin\.com$/i.test(url.hostname) && !/\.linkedin\.com$/i.test(url.hostname)) return null;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizeEmail(value: unknown) {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeEmailStatus(value: unknown) {
  const status = clean(value, 120).toLowerCase();
  return status || null;
}

function confidence(value: unknown, fallback = 0.7) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

function keyForBuyer(item: HunterBuyerCandidate) {
  if (item.linkedinUrl) return `li:${item.linkedinUrl.toLowerCase()}`;
  if (item.email) return `email:${item.email.toLowerCase()}`;
  return `name:${item.fullName.toLowerCase()}|${item.role.toLowerCase()}`;
}

function mergeBuyer(existing: HunterBuyerCandidate, incoming: HunterBuyerCandidate) {
  const preferred = incoming.confidence > existing.confidence ? incoming : existing;
  return {
    ...preferred,
    fullName: preferred.fullName || existing.fullName || incoming.fullName,
    role: preferred.role || existing.role || incoming.role,
    email: incoming.email || existing.email,
    emailStatus: incoming.emailStatus || existing.emailStatus,
    linkedinUrl: incoming.linkedinUrl || existing.linkedinUrl,
    providerPersonId: preferred.providerPersonId || existing.providerPersonId || incoming.providerPersonId,
    confidence: Math.max(existing.confidence, incoming.confidence),
  } satisfies HunterBuyerCandidate;
}

export async function runBuyerProviders(
  providers: HunterBuyerProvider[],
  input: HunterBuyerSearchInput,
) {
  const domain = normalizedDomain(input.domain);
  const limit = Math.max(1, Math.min(10, Math.trunc(input.limit || 3)));
  const titles = input.titles.map((title) => clean(title, 120)).filter(Boolean).slice(0, 25);
  const found = new Map<string, HunterBuyerCandidate>();
  const errors: Array<{ providerId: string; error: string }> = [];

  for (const provider of providers) {
    try {
      const results = await provider.findBuyers({ domain, titles, limit });
      for (const item of results) {
        if (!item.fullName || !item.role) continue;
        const key = keyForBuyer(item);
        const existing = found.get(key);
        found.set(key, existing ? mergeBuyer(existing, item) : item);
      }
    } catch (error) {
      errors.push({ providerId: provider.id, error: error instanceof Error ? error.message : String(error) });
    }
    if (found.size >= limit) break;
  }

  return {
    buyers: [...found.values()].sort((a, b) => b.confidence - a.confidence).slice(0, limit),
    errors,
  };
}

function apolloCandidate(person: Record<string, unknown>, fallback?: Record<string, unknown>): HunterBuyerCandidate | null {
  const fullName = clean(person.name)
    || [clean(person.first_name), clean(person.last_name)].filter(Boolean).join(" ")
    || clean(fallback?.name)
    || [clean(fallback?.first_name), clean(fallback?.last_name)].filter(Boolean).join(" ");
  const role = clean(person.title) || clean(fallback?.title);
  if (!fullName || !role) return null;
  const email = normalizeEmail(person.email);
  const emailStatus = normalizeEmailStatus(person.email_status);
  return {
    fullName,
    role,
    email,
    emailStatus,
    linkedinUrl: normalizeLinkedIn(person.linkedin_url) || normalizeLinkedIn(fallback?.linkedin_url),
    sourceName: "apollo",
    providerPersonId: clean(person.id) || clean(fallback?.id) || null,
    confidence: emailStatus === "verified" ? 0.95 : email ? 0.86 : 0.78,
  };
}

export function createApolloBuyerProvider(input: {
  apiKey: string;
  fetchImpl?: FetchLike;
}): HunterBuyerProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    id: "apollo",
    async findBuyers({ domain, titles, limit }) {
      const searchUrl = new URL("https://api.apollo.io/api/v1/mixed_people/api_search");
      searchUrl.searchParams.append("q_organization_domains_list[]", normalizedDomain(domain));
      for (const title of titles) searchUrl.searchParams.append("person_titles[]", title);
      for (const seniority of ["c_suite", "vp", "head", "director"]) searchUrl.searchParams.append("person_seniorities[]", seniority);
      searchUrl.searchParams.set("include_similar_titles", "true");
      searchUrl.searchParams.set("per_page", String(Math.min(100, limit)));
      const searchResponse = await fetchImpl(searchUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": input.apiKey },
      });
      if (!searchResponse.ok) throw new Error(`Apollo people search failed with HTTP ${searchResponse.status}.`);
      const searchPayload = await searchResponse.json() as { people?: Array<Record<string, unknown>> };
      const selected = (searchPayload.people ?? []).slice(0, limit);
      const buyers: HunterBuyerCandidate[] = [];

      for (const person of selected) {
        const id = clean(person.id);
        let candidate = apolloCandidate(person);
        if (id) {
          const matchUrl = new URL("https://api.apollo.io/api/v1/people/match");
          matchUrl.searchParams.set("id", id);
          matchUrl.searchParams.set("reveal_personal_emails", "false");
          matchUrl.searchParams.set("reveal_phone_number", "false");
          try {
            const matchResponse = await fetchImpl(matchUrl, {
              method: "POST",
              headers: { "content-type": "application/json", "x-api-key": input.apiKey },
            });
            if (matchResponse.ok) {
              const matchPayload = await matchResponse.json() as { person?: Record<string, unknown> };
              if (matchPayload.person) candidate = apolloCandidate(matchPayload.person, person) ?? candidate;
            }
          } catch {
            // Keep search-only buyer for LinkedIn if enrichment is temporarily unavailable.
          }
        }
        if (candidate) buyers.push(candidate);
      }
      return buyers;
    },
  };
}

export function createHunterDomainBuyerProvider(input: {
  apiKey: string;
  fetchImpl?: FetchLike;
}): HunterBuyerProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    id: "hunter",
    async findBuyers({ domain, titles, limit }) {
      const url = new URL("https://api.hunter.io/v2/domain-search");
      url.searchParams.set("domain", normalizedDomain(domain));
      url.searchParams.set("limit", String(Math.min(100, Math.max(limit * 4, 10))));
      url.searchParams.set("api_key", input.apiKey);
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`Hunter domain search failed with HTTP ${response.status}.`);
      const payload = await response.json() as { data?: { emails?: Array<Record<string, unknown>> } };
      const wanted = titles.map((title) => title.toLowerCase());
      return (payload.data?.emails ?? [])
        .filter((person) => {
          if (!wanted.length) return true;
          const position = clean(person.position).toLowerCase();
          return wanted.some((title) => {
            const tokens = title.split(/\W+/).filter((token) => token.length > 2);
            return tokens.some((token) => position.includes(token));
          });
        })
        .slice(0, limit)
        .flatMap<HunterBuyerCandidate>((person) => {
          const fullName = [clean(person.first_name), clean(person.last_name)].filter(Boolean).join(" ");
          const role = clean(person.position);
          const email = normalizeEmail(person.value);
          if (!fullName || !role || !email) return [];
          const score = confidence(person.confidence, 0.75);
          return [{
            fullName,
            role,
            email,
            emailStatus: score >= 0.8 ? "verified" : "unverified",
            linkedinUrl: normalizeLinkedIn(person.linkedin ?? person.linkedin_url),
            sourceName: "hunter",
            providerPersonId: null,
            confidence: score,
          }];
        });
    },
  };
}

function prospeoCandidate(person: Record<string, unknown>, fallback?: Record<string, unknown>): HunterBuyerCandidate | null {
  const fullName = clean(person.full_name)
    || [clean(person.first_name), clean(person.last_name)].filter(Boolean).join(" ")
    || clean(fallback?.full_name)
    || [clean(fallback?.first_name), clean(fallback?.last_name)].filter(Boolean).join(" ");
  const role = clean(person.current_job_title) || clean(fallback?.current_job_title);
  if (!fullName || !role) return null;

  const emailObject = person.email && typeof person.email === "object"
    ? person.email as Record<string, unknown>
    : null;
  const email = normalizeEmail(emailObject?.email ?? person.email);
  const emailStatus = normalizeEmailStatus(emailObject?.status ?? person.email_status);
  return {
    fullName,
    role,
    email,
    emailStatus,
    linkedinUrl: normalizeLinkedIn(person.linkedin_url) || normalizeLinkedIn(fallback?.linkedin_url),
    sourceName: "prospeo",
    providerPersonId: clean(person.person_id) || clean(fallback?.person_id) || null,
    confidence: emailStatus === "verified" ? 0.95 : email ? 0.86 : 0.82,
  };
}

export function createProspeoBuyerProvider(input: {
  apiKey: string;
  fetchImpl?: FetchLike;
}): HunterBuyerProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    id: "prospeo",
    async findBuyers({ domain, titles, limit }) {
      const searchResponse = await fetchImpl("https://api.prospeo.io/search-person", {
        method: "POST",
        headers: { "content-type": "application/json", "X-KEY": input.apiKey },
        body: JSON.stringify({
          page: 1,
          filters: {
            person_job_title: { include: titles, match_mode: "CONTAINS" },
            company: { websites: { include: [normalizedDomain(domain)] } },
          },
        }),
      });
      const searchPayload = await searchResponse.json().catch(() => null) as {
        error?: boolean;
        error_code?: string;
        results?: Array<{ person?: Record<string, unknown> }>;
      } | null;
      if (!searchResponse.ok || searchPayload?.error) {
        throw new Error(`Prospeo people search failed: ${searchPayload?.error_code || `HTTP ${searchResponse.status}`}.`);
      }

      const buyers: HunterBuyerCandidate[] = [];
      for (const entry of (searchPayload?.results ?? []).slice(0, limit)) {
        const searchPerson = entry.person ?? {};
        const personId = clean(searchPerson.person_id);
        let candidate = prospeoCandidate(searchPerson);

        if (personId) {
          try {
            const enrichResponse = await fetchImpl("https://api.prospeo.io/enrich-person", {
              method: "POST",
              headers: { "content-type": "application/json", "X-KEY": input.apiKey },
              body: JSON.stringify({
                only_verified_email: true,
                data: { person_id: personId },
              }),
            });
            const enrichPayload = await enrichResponse.json().catch(() => null) as {
              error?: boolean;
              person?: Record<string, unknown>;
            } | null;
            if (enrichResponse.ok && !enrichPayload?.error && enrichPayload?.person) {
              candidate = prospeoCandidate(enrichPayload.person, searchPerson) ?? candidate;
            }
          } catch {
            // Preserve the search result for LinkedIn outreach if email enrichment misses.
          }
        }
        if (candidate) buyers.push(candidate);
      }
      return buyers;
    },
  };
}

export function configuredBuyerProviders(env: NodeJS.ProcessEnv = process.env): HunterBuyerProvider[] {
  const providers: HunterBuyerProvider[] = [];
  const order = String(env.HUNTER_BUYER_PROVIDER_ORDER || "hunter,apollo,prospeo")
    .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const id of order) {
    if (id === "hunter" && env.HUNTER_API_KEY?.trim()) providers.push(createHunterDomainBuyerProvider({ apiKey: env.HUNTER_API_KEY }));
    if (id === "apollo" && env.APOLLO_API_KEY?.trim()) providers.push(createApolloBuyerProvider({ apiKey: env.APOLLO_API_KEY }));
    if (id === "prospeo" && env.PROSPEO_API_KEY?.trim()) providers.push(createProspeoBuyerProvider({ apiKey: env.PROSPEO_API_KEY }));
  }
  return providers;
}
