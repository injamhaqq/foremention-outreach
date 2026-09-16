export type HunterStructuredRequest = {
  system: string;
  user: string;
  temperature?: number;
};

export interface HunterAiProvider {
  generateStructured(request: HunterStructuredRequest): Promise<unknown>;
}

type OpenAICompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function stripTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function parseAssistantJson(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Hunter AI returned an empty response.");
  const raw = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Hunter AI returned invalid JSON.");
  }
}

export function createOpenAICompatibleHunterProvider(config: OpenAICompatibleConfig): HunterAiProvider {
  const baseUrl = stripTrailingSlash(config.baseUrl);
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();
  if (!baseUrl || !apiKey || !model) throw new Error("Hunter AI provider is not fully configured.");
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async generateStructured(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(config.timeoutMs ?? 20_000, 60_000)));
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: request.temperature ?? 0.1,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
            ],
          }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as {
          choices?: Array<{ message?: { content?: unknown } }>;
          error?: { message?: string };
        } | null;
        if (!response.ok) {
          const detail = typeof body?.error?.message === "string" ? body.error.message.slice(0, 240) : `HTTP ${response.status}`;
          throw new Error(`Hunter AI request failed: ${detail}`);
        }
        return parseAssistantJson(body?.choices?.[0]?.message?.content);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw new Error("Hunter AI request timed out.");
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function hunterAiProviderFromEnv(): HunterAiProvider {
  const provider = String(process.env.HUNTER_AI_PROVIDER || "groq").trim().toLocaleLowerCase();
  if (provider === "groq") {
    return createOpenAICompatibleHunterProvider({
      baseUrl: process.env.HUNTER_AI_BASE_URL || "https://api.groq.com/openai/v1",
      apiKey: process.env.HUNTER_AI_API_KEY || process.env.GROQ_API_KEY || "",
      model: process.env.HUNTER_AI_MODEL || process.env.GROQ_MODEL || "",
    });
  }
  if (provider === "openrouter") {
    return createOpenAICompatibleHunterProvider({
      baseUrl: process.env.HUNTER_AI_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: process.env.HUNTER_AI_API_KEY || process.env.OPENROUTER_API_KEY || "",
      model: process.env.HUNTER_AI_MODEL || process.env.OPENROUTER_MODEL || "",
    });
  }
  if (provider === "openai") {
    return createOpenAICompatibleHunterProvider({
      baseUrl: process.env.HUNTER_AI_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.HUNTER_AI_API_KEY || process.env.OPENAI_API_KEY || "",
      model: process.env.HUNTER_AI_MODEL || process.env.OPENAI_MODEL || "",
    });
  }
  if (process.env.HUNTER_AI_BASE_URL && process.env.HUNTER_AI_API_KEY && process.env.HUNTER_AI_MODEL) {
    return createOpenAICompatibleHunterProvider({
      baseUrl: process.env.HUNTER_AI_BASE_URL,
      apiKey: process.env.HUNTER_AI_API_KEY,
      model: process.env.HUNTER_AI_MODEL,
    });
  }
  throw new Error(`Unsupported Hunter AI provider: ${provider}`);
}
