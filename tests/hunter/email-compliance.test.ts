import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureHunterSchema } from "../../lib/hunter/schema.ts";
import {
  buildCompliantEmail,
  createUnsubscribeToken,
  EmailComplianceError,
  emailComplianceProblems,
  requireEmailComplianceConfig,
  verifyUnsubscribeToken,
} from "../../lib/email/compliance.ts";
import { isRecipientSuppressed, recordEmailUnsubscribe } from "../../lib/email/suppression.ts";
import { handleUnsubscribeRequest } from "../../lib/email/unsubscribe-handler.ts";
import { sendEmail, type EmailAccount } from "../../lib/email/sender.ts";

const SECRET = "unit-test-unsubscribe-secret-0123456789";
const ENV = {
  OUTREACH_POSTAL_ADDRESS: "Foremention Ltd, 1 Example Street, London EC1A 1AA, UK",
  OUTREACH_UNSUBSCRIBE_BASE_URL: "https://outreach.example.test/",
  OUTREACH_UNSUBSCRIBE_SECRET: SECRET,
} as NodeJS.ProcessEnv;

const ACCOUNT: EmailAccount = {
  id: "mail-1",
  from_email: "founder@foremention.example",
  from_name: "Founder",
  smtp_host: "smtp.invalid",
  smtp_port: 587,
  smtp_secure: 0,
  username: "u",
  password: "p",
};

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE targets (id TEXT PRIMARY KEY, company_id TEXT, email TEXT);
    CREATE TABLE run_profiles (id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT);
    CREATE TABLE run_profile_tracks (id TEXT PRIMARY KEY, run_profile_id TEXT, track TEXT, state TEXT, error_message TEXT);
    INSERT INTO companies VALUES ('c1','Acme'), ('c2','Beta');
    INSERT INTO targets VALUES ('t1','c1','Jane@Acme.example'), ('t2','c2','bob@beta.example');
    INSERT INTO run_profiles VALUES ('rp1','r1','t1');
    INSERT INTO run_profile_tracks VALUES ('tr-email','rp1','email','pending',NULL), ('tr-li','rp1','linkedin','pending',NULL);
  `);
  ensureHunterSchema(db);
  return db;
}

function fakeTransport() {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    createTransport: () => ({
      sendMail: async (message: Record<string, unknown>) => {
        sent.push(message);
        return { messageId: "fake" };
      },
    }),
  };
}

test("compliance config is required and every missing piece is reported", () => {
  assert.deepEqual(emailComplianceProblems(ENV), []);
  const problems = emailComplianceProblems({} as NodeJS.ProcessEnv);
  assert.equal(problems.length, 3);
  assert.throws(() => requireEmailComplianceConfig({} as NodeJS.ProcessEnv), EmailComplianceError);
  assert.throws(() => requireEmailComplianceConfig({ ...ENV, OUTREACH_POSTAL_ADDRESS: "  " }), /OUTREACH_POSTAL_ADDRESS/);
  assert.throws(() => requireEmailComplianceConfig({ ...ENV, OUTREACH_UNSUBSCRIBE_BASE_URL: "" }), /OUTREACH_UNSUBSCRIBE_BASE_URL/);
  assert.throws(() => requireEmailComplianceConfig({ ...ENV, OUTREACH_UNSUBSCRIBE_BASE_URL: "not a url" }), /valid URL/);
  assert.throws(() => requireEmailComplianceConfig({ ...ENV, OUTREACH_UNSUBSCRIBE_SECRET: "short" }), /OUTREACH_UNSUBSCRIBE_SECRET/);
});

test("unsubscribe tokens are signed, bound to the recipient and tamper-evident", () => {
  const token = createUnsubscribeToken(" Jane@Acme.example ", SECRET);
  assert.equal(verifyUnsubscribeToken(token, SECRET), "jane@acme.example");
  assert.equal(verifyUnsubscribeToken(token, "another-secret-of-enough-length"), null);
  const [v, payload, sig] = token.split(".");
  const forgedPayload = Buffer.from("victim@acme.example").toString("base64url");
  assert.equal(verifyUnsubscribeToken(`${v}.${forgedPayload}.${sig}`, SECRET), null);
  assert.equal(verifyUnsubscribeToken(`${v}.${payload}.${sig.slice(0, -2)}xx`, SECRET), null);
  assert.equal(verifyUnsubscribeToken("garbage", SECRET), null);
});

test("compliant email has postal address footer, one-click link and RFC 8058 headers", () => {
  const config = requireEmailComplianceConfig(ENV);
  const email = buildCompliantEmail("jane@acme.example", "Hello Jane", config);
  assert.match(email.text, /^Hello Jane\n\n--\n/);
  assert.match(email.text, /1 Example Street/);
  assert.ok(email.text.includes(email.unsubscribeUrl));
  assert.match(email.unsubscribeUrl, /^https:\/\/outreach\.example\.test\/api\/unsubscribe\?token=v1\./);
  assert.equal(email.headers["List-Unsubscribe"], `<${email.unsubscribeUrl}>`);
  assert.equal(email.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("sendEmail fails closed when compliance config is missing (no SMTP connection made)", async () => {
  const db = makeDb();
  const transport = fakeTransport();
  for (const env of [{}, { ...ENV, OUTREACH_POSTAL_ADDRESS: "" }, { ...ENV, OUTREACH_UNSUBSCRIBE_BASE_URL: "" }]) {
    await assert.rejects(
      sendEmail(ACCOUNT, "bob@beta.example", "Hi", "Body", { db, env: env as NodeJS.ProcessEnv, createTransport: transport.createTransport }),
      (error: unknown) => error instanceof EmailComplianceError && error.code === "compliance_not_configured",
    );
  }
  assert.equal(transport.sent.length, 0);
});

test("sendEmail attaches footer and List-Unsubscribe headers when configured", async () => {
  const db = makeDb();
  const transport = fakeTransport();
  await sendEmail(ACCOUNT, "bob@beta.example", "Hi", "Body", { db, env: ENV, createTransport: transport.createTransport });
  assert.equal(transport.sent.length, 1);
  const message = transport.sent[0] as { text: string; headers: Record<string, string>; to: string };
  assert.equal(message.to, "bob@beta.example");
  assert.match(message.text, /^Body\n\n--\nForemention Ltd/);
  assert.match(message.text, /Unsubscribe with one click: https:\/\/outreach\.example\.test\/api\/unsubscribe\?token=/);
  assert.match(message.headers["List-Unsubscribe"], /^<https:\/\/outreach\.example\.test\/api\/unsubscribe\?token=v1\.[^>]+>$/);
  assert.equal(message.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("one-click unsubscribe records the opt-out, stops email tracks, and blocks future sends", async () => {
  const db = makeDb();
  const token = createUnsubscribeToken("jane@acme.example", SECRET);

  assert.equal(handleUnsubscribeRequest(db, { method: "POST", token: "v1.bad.token" }, ENV).status, 400);
  assert.equal(handleUnsubscribeRequest(db, { method: "DELETE", token }, ENV).status, 405);
  assert.equal(handleUnsubscribeRequest(db, { method: "POST", token }, {} as NodeJS.ProcessEnv).status, 503);
  assert.equal(isRecipientSuppressed(db, "jane@acme.example"), false);

  const outcome = handleUnsubscribeRequest(db, { method: "POST", token }, ENV);
  assert.deepEqual(outcome, { status: 200, ok: true, email: "jane@acme.example" });
  // Idempotent via GET (the footer link) too.
  assert.equal(handleUnsubscribeRequest(db, { method: "GET", token: [token] }, ENV).status, 200);

  const rows = db.prepare("SELECT target_id, kind, value, source FROM hunter_suppressions").all();
  assert.deepEqual(rows, [{ target_id: "t1", kind: "unsubscribe", value: "jane@acme.example", source: "one_click_unsubscribe" }]);
  const tracks = db.prepare("SELECT id, state FROM run_profile_tracks ORDER BY id").all();
  assert.deepEqual(tracks, [{ id: "tr-email", state: "skipped" }, { id: "tr-li", state: "pending" }]);

  assert.equal(isRecipientSuppressed(db, "JANE@acme.example"), true);
  const transport = fakeTransport();
  await assert.rejects(
    sendEmail(ACCOUNT, "Jane@Acme.example", "Hi", "Body", { db, env: ENV, createTransport: transport.createTransport }),
    (error: unknown) => error instanceof EmailComplianceError && error.code === "recipient_suppressed",
  );
  assert.equal(transport.sent.length, 0);
});

test("suppression by target, company or bare address all block sending", async () => {
  const db = makeDb();
  db.prepare(`INSERT INTO hunter_suppressions (id, target_id, company_id, dedupe_key, kind, value, reason, source)
    VALUES ('s1', NULL, 'c2', 'k1', 'complaint', NULL, 'Complaint', 'reply')`).run();
  assert.equal(isRecipientSuppressed(db, "bob@beta.example"), true);
  recordEmailUnsubscribe(db, "stranger@nowhere.example");
  assert.equal(isRecipientSuppressed(db, "stranger@nowhere.example"), true);
  assert.equal(isRecipientSuppressed(db, ""), true);
  assert.equal(isRecipientSuppressed(db, "other@nowhere.example"), false);
});

test("unsubscribe route is public (no login) and every send path goes through the guarded sender", () => {
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /PUBLIC_API_PREFIXES = \[[^\]]*"\/api\/unsubscribe"/);
  const route = readFileSync("pages/api/unsubscribe.ts", "utf8");
  assert.match(route, /handleUnsubscribeRequest/);
  for (const file of ["lib/linkedin/runner.ts", "pages/api/inbox/reply.ts", "pages/api/targets/[id]/emails.ts", "pages/api/email-accounts/[id]/send-test.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /from "@\/lib\/email\/sender"/, file);
    assert.doesNotMatch(source, /nodemailer|createTransport|sendMail\(/, file);
  }
});
