import test from "node:test";
import assert from "node:assert/strict";
import { requestForementionMiniAudit } from "../../lib/hunter/foremention-client.ts";

const input = {
  brand: "Acme",
  domain: "acme.example",
  questions: ["Best Acme alternatives?", "Best tools for category X?", "Which platforms are recommended?"],
};

test("mini-audit client returns bounded evidence on success", async () => {
  const result = await requestForementionMiniAudit(input, {
    baseUrl: "https://foremention.test",
    secret: "secret",
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://foremention.test/api/internal/outreach/mini-audit");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret");
      return Response.json({
        data: {
          brand: "Acme",
          domain: "acme.example",
          collectedAt: "2026-09-16T00:00:00.000Z",
          questions: [{
            question: input.questions[0],
            observations: [{ provider: "groq", model: "compound", status: "ok", answer: "Acme appears.", citations: [], brandMentioned: true, collectedAt: "2026-09-16T00:00:00.000Z" }],
          }],
        },
      });
    },
  });
  assert.equal(result.brand, "Acme");
  assert.equal(result.questions[0].observations[0].status, "ok");
});

test("mini-audit client surfaces unauthorized responses", async () => {
  await assert.rejects(
    requestForementionMiniAudit(input, {
      baseUrl: "https://foremention.test",
      secret: "wrong",
      fetchImpl: async () => Response.json({ error: "Unauthorized" }, { status: 401 }),
    }),
    /unauthorized/i,
  );
});

test("mini-audit client enforces its timeout", async () => {
  await assert.rejects(
    requestForementionMiniAudit(input, {
      baseUrl: "https://foremention.test",
      secret: "secret",
      timeoutMs: 10,
      fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    }),
    /timed out/i,
  );
});

test("mini-audit client preserves partial provider failure evidence", async () => {
  const result = await requestForementionMiniAudit(input, {
    baseUrl: "https://foremention.test",
    secret: "secret",
    fetchImpl: async () => Response.json({
      data: {
        brand: "Acme",
        domain: "acme.example",
        collectedAt: "2026-09-16T00:00:00.000Z",
        questions: [{
          question: input.questions[0],
          observations: [
            { provider: "groq", model: "compound", status: "ok", answer: "Acme appears.", citations: [], brandMentioned: true, collectedAt: "2026-09-16T00:00:00.000Z" },
            { provider: "perplexity", model: "sonar", status: "error", errorCode: "provider_unavailable", citations: [] },
          ],
        }],
      },
    }),
  });
  assert.equal(result.questions[0].observations[1].status, "error");
});
