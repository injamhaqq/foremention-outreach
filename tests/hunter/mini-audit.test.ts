import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema";
import { runHunterForementionMiniAudit } from "../../lib/hunter/mini-audit";

test("Foremention mini-audit is reused across buyers at the same account within the freshness window", async () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT);
    CREATE TABLE targets (id TEXT PRIMARY KEY, company_id TEXT);
    INSERT INTO companies VALUES ('c1','Acme','acme.com');
    INSERT INTO targets VALUES ('t1','c1'),('t2','c1');
  `);
  ensureHunterSchema(db);

  let aiCalls = 0;
  let auditCalls = 0;
  const aiProvider = {
    generateStructured: async () => {
      aiCalls += 1;
      return {
        questions: [
          "What are the best AI-search visibility platforms for B2B SaaS?",
          "Which platforms track brand visibility in AI answers?",
          "What tools measure citations in generative search?",
        ],
      };
    },
  };
  const requester = async (input: { brand: string; domain: string; questions: string[] }) => {
    auditCalls += 1;
    return {
      brand: input.brand,
      domain: input.domain,
      collectedAt: "2026-09-18T10:00:00.000Z",
      questions: input.questions.map((question) => ({
        question,
        observations: [{
          provider: "groq",
          status: "ok" as const,
          answer: "Acme appears.",
          citations: [],
          brandMentioned: true,
          collectedAt: "2026-09-18T10:00:00.000Z",
        }],
      })),
    };
  };
  const common = {
    company: { id: "c1", name: "Acme", domain: "acme.com" },
    signals: [{
      id: "s1", type: "ai_search_hiring", title: "Hiring", summary: "AI search hiring",
      evidenceText: "Own AI Overviews.", sourceUrl: "https://acme.com/jobs", observedAt: "2026-09-18T09:00:00.000Z", confidence: 0.9,
    }],
    aiProvider,
    requester,
  };

  const first = await runHunterForementionMiniAudit(db, {
    ...common,
    targetId: "t1",
    now: new Date("2026-09-18T10:05:00.000Z"),
  });
  const second = await runHunterForementionMiniAudit(db, {
    ...common,
    targetId: "t2",
    now: new Date("2026-09-18T11:00:00.000Z"),
  });

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(auditCalls, 1);
  assert.equal(aiCalls, 1);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM hunter_mini_audits").get() as { c: number }).c, 1);
});
