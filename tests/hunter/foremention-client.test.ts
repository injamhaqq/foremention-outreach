import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { probeForementionMiniAuditAuth, requestForementionMiniAudit } from "../../lib/hunter/foremention-client.ts";
import { miniAuditPublicKeyFromSecret, miniAuditRequestPayload } from "../../lib/hunter/request-signing.ts";

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
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), null);
      const timestamp = headers.get("x-foremention-timestamp");
      const signature = headers.get("x-foremention-signature");
      assert.ok(timestamp);
      assert.ok(signature);
      assert.equal(headers.get("x-foremention-key-id")?.length, 16);
      const body = String(init?.body || "");
      const payload = miniAuditRequestPayload({
        timestamp,
        method: "POST",
        path: "/api/internal/outreach/mini-audit",
        body,
      });
      const publicKeyDer = Buffer.from(miniAuditPublicKeyFromSecret("secret"), "base64url");
      const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
      assert.equal(verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, "base64url")), true);
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


test("mini-audit signing key is deterministic and does not expose the shared secret", () => {
  const first = miniAuditPublicKeyFromSecret("top-secret-value");
  const second = miniAuditPublicKeyFromSecret("top-secret-value");
  const other = miniAuditPublicKeyFromSecret("different-secret-value");
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.equal(first.includes("top-secret-value"), false);
});


test("mini-audit auth probe treats signed invalid input as zero-spend auth success", async () => {
  let observedBody = "";
  const result = await probeForementionMiniAuditAuth({
    baseUrl: "https://foremention.test",
    secret: "secret",
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://foremention.test/api/internal/outreach/mini-audit");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), null);
      const timestamp = headers.get("x-foremention-timestamp");
      const signature = headers.get("x-foremention-signature");
      assert.ok(timestamp);
      assert.ok(signature);
      observedBody = String(init?.body || "");
      const payload = miniAuditRequestPayload({
        timestamp,
        method: "POST",
        path: "/api/internal/outreach/mini-audit",
        body: observedBody,
      });
      const publicKeyDer = Buffer.from(miniAuditPublicKeyFromSecret("secret"), "base64url");
      const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
      assert.equal(verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, "base64url")), true);
      return Response.json({ error: "Provide at least three buyer questions." }, { status: 400 });
    },
  });
  assert.match(observedBody, /"questions":\[\]/);
  assert.deepEqual(result, { ok: true, status: 400, reason: "accepted_invalid_input" });
});

test("mini-audit auth probe reports signature rejection", async () => {
  const result = await probeForementionMiniAuditAuth({
    baseUrl: "https://foremention.test",
    secret: "wrong",
    fetchImpl: async () => Response.json({ error: "Unauthorized." }, { status: 401 }),
  });
  assert.deepEqual(result, { ok: false, status: 401, reason: "unauthorized" });
});
