import assert from "node:assert/strict";
import test from "node:test";
import { emailTlsRejectUnauthorized } from "../../lib/email/tls";
import { hunterAiProviderFromEnv } from "../../lib/hunter/ai";

test("email TLS certificate validation is secure by default and requires an explicit escape hatch", () => {
  assert.equal(emailTlsRejectUnauthorized({} as NodeJS.ProcessEnv), true);
  assert.equal(emailTlsRejectUnauthorized({ EMAIL_ALLOW_INSECURE_TLS: "false" } as NodeJS.ProcessEnv), true);
  assert.equal(emailTlsRejectUnauthorized({ EMAIL_ALLOW_INSECURE_TLS: "true" } as NodeJS.ProcessEnv), false);
});

test("Ollama provider can be created without a paid API key", () => {
  const provider = hunterAiProviderFromEnv(undefined, {
    HUNTER_AI_PROVIDER: "ollama",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
    OLLAMA_MODEL: "qwen3:8b",
  } as NodeJS.ProcessEnv);
  assert.equal(typeof provider.generateStructured, "function");
});
