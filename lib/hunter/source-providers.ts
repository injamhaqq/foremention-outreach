import type { HunterDiscoveryCandidate, HunterDiscoveryProvider } from "./discovery";
import { reportHunterUsage, type HunterUsageReporter } from "./costs";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function isFirecrawlDiscoveryConfigured(env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = String(env.FIRECRAWL_API_URL || "").trim();
  if (!baseUrl) return false;

  let hostname = "";
  try {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    hostname = url.hostname.toLowerCase();
  } catch {
    return false;
  }

  const isFirecrawlCloud = hostname === "api.firecrawl.dev" || hostname.endsWith(".firecrawl.dev");
  if (isFirecrawlCloud) return Boolean(String(env.FIRECRAWL_API_KEY || "").trim());

  // Self-hosted Firecrawl can be deployed without an API key.
  return true;
}

function domainFromUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function createSearxngProvider(input: {
  baseUrl: string;
  onUsage?: HunterUsageReporter;
  fetchImpl?: FetchLike;
}): HunterDiscoveryProvider {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    id: "searxng",
    async search({ query, limit }) {
      const url = new URL(`${baseUrl}/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      const response = await fetchImpl(url);
      reportHunterUsage(input.onUsage, {
        provider: "searxng",
        eventType: "search_request",
        units: 1,
        unitType: "request",
        metadata: { status: response.status, ok: response.ok },
      });
      if (!response.ok) throw new Error(`SearXNG search failed with HTTP ${response.status}.`);
      const payload = await response.json() as {
        results?: Array<{ url?: string; title?: string; content?: string }>;
      };
      return (payload.results ?? [])
        .slice(0, limit)
        .flatMap<HunterDiscoveryCandidate>((result) => {
          const sourceUrl = result.url?.trim() ?? "";
          const domain = domainFromUrl(sourceUrl);
          if (!sourceUrl || !domain) return [];
          return [{
            name: result.title?.trim() || domain,
            domain,
            sourceUrl,
            sourceName: "searxng",
            evidenceText: result.content?.trim() || result.title?.trim() || domain,
          }];
        });
    },
  };
}

export function createFirecrawlProvider(input: {
  baseUrl: string;
  apiKey?: string;
  onUsage?: HunterUsageReporter;
  fetchImpl?: FetchLike;
}): HunterDiscoveryProvider {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    id: "firecrawl",
    async search({ query, limit }) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
      const response = await fetchImpl(`${baseUrl}/v2/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, limit }),
      });
      reportHunterUsage(input.onUsage, {
        provider: "firecrawl",
        eventType: "search_request",
        units: 1,
        unitType: "request",
        metadata: { status: response.status, ok: response.ok },
      });
      if (!response.ok) throw new Error(`Firecrawl search failed with HTTP ${response.status}.`);
      const payload = await response.json() as {
        success?: boolean;
        data?: Array<{ url?: string; title?: string; description?: string; markdown?: string }>;
      };
      if (payload.success === false) throw new Error("Firecrawl search returned an unsuccessful response.");
      return (payload.data ?? [])
        .slice(0, limit)
        .flatMap<HunterDiscoveryCandidate>((result) => {
          const sourceUrl = result.url?.trim() ?? "";
          const domain = domainFromUrl(sourceUrl);
          if (!sourceUrl || !domain) return [];
          return [{
            name: result.title?.trim() || domain,
            domain,
            sourceUrl,
            sourceName: "firecrawl",
            evidenceText: result.description?.trim() || result.markdown?.trim().slice(0, 4_000) || result.title?.trim() || domain,
          }];
        });
    },
  };
}

export function configuredDiscoveryProviders(
  env: NodeJS.ProcessEnv = process.env,
  onUsage?: HunterUsageReporter,
): HunterDiscoveryProvider[] {
  const providers: HunterDiscoveryProvider[] = [];
  if (env.SEARXNG_URL?.trim()) {
    providers.push(createSearxngProvider({ baseUrl: env.SEARXNG_URL, onUsage }));
  }
  if (isFirecrawlDiscoveryConfigured(env)) {
    providers.push(createFirecrawlProvider({
      baseUrl: String(env.FIRECRAWL_API_URL || "").trim(),
      apiKey: env.FIRECRAWL_API_KEY?.trim() || undefined,
      onUsage,
    }));
  }
  return providers;
}
