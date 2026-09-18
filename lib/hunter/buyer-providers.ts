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
  return typeof value === "string" ? value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
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

export function createApolloBuyerProvider(input: {
  apiKey: string;
  fetchImpl?: FetchLike;
}): HunterBuyerProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    id: "apollo",
    async findBuyers({ domain, titles, limit }) {
      const url = new URL("https://api.apollo.io/api/v1/mixed_people/api_search");
      url.searchParams.append("q_organization_domains_list[]", normalizedDomain(domain));
      for (const title of titles) url.searchParams.append("person_titles[]", title);
      for (const seniority of ["c_suite", "vp", "head", "director"]) url.searchParams.append("person_seniorities[]", seniority);
      url.searchParams.set("include_similar_titles", "true");
      url.searchParams.set("per_page", String(Math.min(100, limit)));
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": input.apiKey },
      });
      if (!response.ok) throw new Error(`Apollo people search failed with HTTP ${response.status}.`);
      const payload = await response.json() as { people?: Array<Record<string, unknown>> };
      return (payload.people ?? []).slice(0, limit).flatMap<HunterBuyerCandidate>((person) => {
        const fullName = clean(person.name) || [clean(person.first_name), clean(person.last_name)].filter(Boolean).join(" ");
        const role = clean(person.title);
        if (!fullName || !role) return [];
        return [{
          fullName,
          role,
          email: normalizeEmail(person.email),
          emailStatus: clean(person.email_status) || null,
          linkedinUrl: normalizeLinkedIn(person.linkedin_url),
          sourceName: "apollo",
          providerPersonId: clean(person.id) || null,
          confidence: person.email_status === "verified" ? 0.95 : 0.78,
        }];
      });
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

export function createProspeoBuyerProvider(input: {
  apiKey: string;
  fetchImpl?: FetchLike;
}): HunterBuyerProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    id: "prospeo",
    async findBuyers({ domain, titles, limit }) {
      const response = await fetchImpl("https://api.prospeo.io/search-person", {
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
      const payload = await response.json().catch(() => null) as {
        error?: boolean;
        error_code?: string;
        results?: Array<{ person?: Record<string, unknown> }>;
      } | null;
      if (!response.ok || payload?.error) {
        throw new Error(`Prospeo people search failed: ${payload?.error_code || `HTTP ${response.status}`}.`);
      }
      return (payload?.results ?? []).slice(0, limit).flatMap<HunterBuyerCandidate>((entry) => {
        const person = entry.person ?? {};
        const fullName = clean(person.full_name) || [clean(person.first_name), clean(person.last_name)].filter(Boolean).join(" ");
        const role = clean(person.current_job_title);
        if (!fullName || !role) return [];
        return [{
          fullName,
          role,
          email: normalizeEmail((person.email as Record<string, unknown> | null)?.email),
          emailStatus: clean((person.email as Record<string, unknown> | null)?.status) || null,
          linkedinUrl: normalizeLinkedIn(person.linkedin_url),
          sourceName: "prospeo",
          providerPersonId: clean(person.person_id) || null,
          confidence: 0.82,
        }];
      });
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
