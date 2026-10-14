import type Database from "better-sqlite3";
import { verifyUnsubscribeToken } from "./compliance";
import { recordEmailUnsubscribe } from "./suppression";

export type UnsubscribeOutcome =
  | { status: 200; ok: true; email: string }
  | { status: 400 | 405 | 503; ok: false; error: string };

/**
 * Framework-independent core of the one-click unsubscribe route. Both GET (the
 * footer link opened in a browser) and POST (RFC 8058 one-click from the mail
 * client) record the opt-out: when in doubt we suppress, never the reverse.
 */
export function handleUnsubscribeRequest(
  db: Database.Database,
  input: { method: string | undefined; token: unknown },
  env: NodeJS.ProcessEnv = process.env,
): UnsubscribeOutcome {
  const method = String(input.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") return { status: 405, ok: false, error: "Method not allowed" };
  const secret = String(env.OUTREACH_UNSUBSCRIBE_SECRET || "").trim();
  if (!secret) return { status: 503, ok: false, error: "Unsubscribe is not configured." };
  const token = Array.isArray(input.token) ? input.token[0] : input.token;
  const email = typeof token === "string" ? verifyUnsubscribeToken(token, secret) : null;
  if (!email) return { status: 400, ok: false, error: "This unsubscribe link is invalid." };
  recordEmailUnsubscribe(db, email);
  return { status: 200, ok: true, email };
}
