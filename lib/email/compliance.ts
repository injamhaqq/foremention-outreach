import { createHmac, timingSafeEqual } from "crypto";

/**
 * Outbound email compliance (CAN-SPAM, GDPR/PECR).
 *
 * Every commercial email must carry the sender's physical postal address and a
 * working, one-click unsubscribe mechanism (RFC 8058 List-Unsubscribe headers
 * plus a visible footer link). This module is deliberately FAIL CLOSED: if any
 * piece of required configuration is missing, `requireEmailComplianceConfig`
 * throws and the sender refuses to send.
 */

export const UNSUBSCRIBE_PATH = "/api/unsubscribe";

/**
 * Outbound email kill switch (default OFF).
 *
 * Configuring the postal address + unsubscribe settings is required for the
 * public opt-out route to work, so compliance config alone must NOT unlock
 * sending. Every send path (sequencer, inbox reply, manual compose, send-test)
 * additionally requires OUTREACH_EMAIL_SENDING_ENABLED to be exactly "true".
 */
export const EMAIL_SENDING_FLAG = "OUTREACH_EMAIL_SENDING_ENABLED";

export function emailSendingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[EMAIL_SENDING_FLAG] ?? "").trim().toLowerCase() === "true";
}

export const EMAIL_SENDING_DISABLED_MESSAGE =
  `Refusing to send email: outbound email is locked. Set ${EMAIL_SENDING_FLAG}=true only after founder review.`;
const TOKEN_VERSION = "v1";
const MIN_SECRET_LENGTH = 16;

export class EmailComplianceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EmailComplianceError";
    this.code = code;
  }
}

export type EmailComplianceConfig = {
  postalAddress: string;
  unsubscribeBaseUrl: string;
  unsubscribeSecret: string;
};

function clean(value: string | undefined) {
  return String(value ?? "").trim();
}

/** Returns the list of missing/invalid compliance settings (empty when ready). */
export function emailComplianceProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  if (!clean(env.OUTREACH_POSTAL_ADDRESS)) problems.push("OUTREACH_POSTAL_ADDRESS is not set");
  const base = clean(env.OUTREACH_UNSUBSCRIBE_BASE_URL);
  if (!base) {
    problems.push("OUTREACH_UNSUBSCRIBE_BASE_URL is not set");
  } else {
    try {
      const url = new URL(base);
      if (url.protocol !== "https:" && url.protocol !== "http:") problems.push("OUTREACH_UNSUBSCRIBE_BASE_URL must be an http(s) URL");
    } catch {
      problems.push("OUTREACH_UNSUBSCRIBE_BASE_URL is not a valid URL");
    }
  }
  if (clean(env.OUTREACH_UNSUBSCRIBE_SECRET).length < MIN_SECRET_LENGTH) {
    problems.push(`OUTREACH_UNSUBSCRIBE_SECRET must be set (at least ${MIN_SECRET_LENGTH} characters)`);
  }
  return problems;
}

export function requireEmailComplianceConfig(env: NodeJS.ProcessEnv = process.env): EmailComplianceConfig {
  const problems = emailComplianceProblems(env);
  if (problems.length) {
    throw new EmailComplianceError(
      "compliance_not_configured",
      `Refusing to send email: ${problems.join("; ")}.`,
    );
  }
  return {
    postalAddress: clean(env.OUTREACH_POSTAL_ADDRESS),
    unsubscribeBaseUrl: clean(env.OUTREACH_UNSUBSCRIBE_BASE_URL).replace(/\/+$/, ""),
    unsubscribeSecret: clean(env.OUTREACH_UNSUBSCRIBE_SECRET),
  };
}

export function normalizeEmailAddress(email: string) {
  return String(email ?? "").trim().toLowerCase();
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`${TOKEN_VERSION}.${payload}`).digest("base64url");
}

/** Signed, non-expiring opt-out token bound to one recipient address. */
export function createUnsubscribeToken(email: string, secret: string) {
  const payload = Buffer.from(normalizeEmailAddress(email), "utf8").toString("base64url");
  return `${TOKEN_VERSION}.${payload}.${sign(payload, secret)}`;
}

/** Returns the recipient address the token was issued for, or null if invalid. */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, payload, signature] = parts;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const email = normalizeEmailAddress(Buffer.from(payload, "base64url").toString("utf8"));
  return email.includes("@") ? email : null;
}

export function unsubscribeUrlFor(email: string, config: EmailComplianceConfig) {
  const token = createUnsubscribeToken(email, config.unsubscribeSecret);
  return `${config.unsubscribeBaseUrl}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}

export type CompliantEmailContent = {
  text: string;
  headers: Record<string, string>;
  unsubscribeUrl: string;
};

/** Appends the postal-address + unsubscribe footer and builds RFC 8058 headers. */
export function buildCompliantEmail(
  to: string,
  body: string,
  config: EmailComplianceConfig,
): CompliantEmailContent {
  const unsubscribeUrl = unsubscribeUrlFor(to, config);
  const footer = [
    "",
    "",
    "--",
    config.postalAddress,
    `Don't want these emails? Unsubscribe with one click: ${unsubscribeUrl}`,
  ].join("\n");
  return {
    text: `${body}${footer}`,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    unsubscribeUrl,
  };
}
