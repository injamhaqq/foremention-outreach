type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function base(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function website(value: string) {
  const raw = value.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Crawl URL must use HTTP(S).");
  return url;
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  for (const key of ["raw_markdown", "fit_markdown", "markdown", "text", "content"]) {
    const found = extractText(object[key]);
    if (found) return found;
  }
  return "";
}

export function createCrawl4AiClient(input: {
  baseUrl: string;
  apiToken?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}) {
  const baseUrl = base(input.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    async crawl(domainOrUrl: string) {
      const url = website(domainOrUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(input.timeoutMs ?? 30_000, 60_000)));
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (input.apiToken?.trim()) headers.authorization = `Bearer ${input.apiToken.trim()}`;
        const response = await fetchImpl(`${baseUrl}/crawl`, {
          method: "POST",
          headers,
          // Do not forward executable hooks/config from external discovery data.
          body: JSON.stringify({ urls: [url.toString().replace(/\/$/, "")] }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Crawl4AI failed with HTTP ${response.status}.`);
        const payload = await response.json() as Record<string, unknown>;
        const rows = Array.isArray(payload.results) ? payload.results
          : Array.isArray(payload.result) ? payload.result
          : Array.isArray(payload.data) ? payload.data
          : [];
        const first = (rows[0] ?? payload) as Record<string, unknown>;
        if (first.success === false) throw new Error("Crawl4AI returned an unsuccessful crawl.");
        const text = extractText(first.markdown ?? first.cleaned_html ?? first.html ?? first).replace(/\s+/g, " ").trim().slice(0, 20_000);
        if (!text) throw new Error("Crawl4AI returned no usable text.");
        return {
          domain: url.hostname.toLowerCase().replace(/^www\./, ""),
          url: url.toString().replace(/\/$/, ""),
          text,
        };
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw new Error("Crawl4AI timed out.");
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
