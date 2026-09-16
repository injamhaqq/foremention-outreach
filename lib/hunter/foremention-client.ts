import { z } from "zod";

const citationSchema = z.object({
  url: z.string().min(1),
  title: z.string().optional(),
});

const observationSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  status: z.enum(["ok", "error"]),
  answer: z.string().optional(),
  citations: z.array(citationSchema).max(12),
  brandMentioned: z.boolean().optional(),
  domainCited: z.boolean().optional(),
  competitorMentions: z.array(z.string()).optional(),
  collectedAt: z.string().optional(),
  errorCode: z.string().optional(),
});

const miniAuditSchema = z.object({
  brand: z.string().min(1),
  domain: z.string().min(1),
  collectedAt: z.string().min(1),
  questions: z.array(z.object({
    question: z.string().min(1),
    observations: z.array(observationSchema),
  })).max(5),
});

export type ForementionMiniAuditInput = {
  brand: string;
  domain: string;
  questions: string[];
  competitors?: string[];
  providers?: string[];
  locale?: string;
};

export type ForementionMiniAuditResult = z.infer<typeof miniAuditSchema>;

type MiniAuditClientOptions = {
  baseUrl?: string;
  secret?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export async function requestForementionMiniAudit(
  input: ForementionMiniAuditInput,
  options: MiniAuditClientOptions = {},
): Promise<ForementionMiniAuditResult> {
  if (!Array.isArray(input.questions) || input.questions.length < 3 || input.questions.length > 5) {
    throw new Error("Foremention mini-audit requires three to five questions.");
  }
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.FOREMENTION_OUTREACH_URL || "https://foremention.com");
  const secret = String(options.secret || process.env.FOREMENTION_OUTREACH_SECRET || "").trim();
  if (!secret) throw new Error("Foremention mini-audit secret is not configured.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 25_000, 60_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/internal/outreach/mini-audit`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new Error("Foremention mini-audit timed out.");
    }
    throw new Error(`Foremention mini-audit request failed: ${error instanceof Error ? error.message : "network error"}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Foremention mini-audit unauthorized.");
  }

  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const detail = body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
      ? String((body as { error: string }).error).slice(0, 300)
      : `HTTP ${response.status}`;
    throw new Error(`Foremention mini-audit failed: ${detail}`);
  }

  const parsed = z.object({ data: miniAuditSchema }).safeParse(body);
  if (!parsed.success) throw new Error("Foremention mini-audit returned invalid evidence.");
  return parsed.data.data;
}
