import nodemailer from "nodemailer";
import Imap from "imap";
import type Database from "better-sqlite3";
import type { Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { emailTlsRejectUnauthorized } from "./tls";
import {
  buildCompliantEmail,
  EMAIL_SENDING_DISABLED_MESSAGE,
  EmailComplianceError,
  emailSendingEnabled,
  requireEmailComplianceConfig,
} from "./compliance";
import { isRecipientSuppressed } from "./suppression";

export interface EmailAccount {
  id: string;
  from_email: string;
  from_name: string | null;
  reply_to?: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number; // 0 = STARTTLS, 1 = SSL
  username: string;
  password: string;
}

export type SendEmailOptions = {
  /** Database used for the do-not-contact check. Defaults to the app database. */
  db?: Database.Database;
  /** Environment used for compliance config. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Transport factory override (tests only). */
  createTransport?: (options: SMTPTransport.Options) => Pick<Transporter, "sendMail">;
};

async function defaultDb(): Promise<Database.Database> {
  const { getDb } = await import("../db");
  return getDb();
}

/**
 * Sends one email. FAIL CLOSED: refuses to send unless
 * OUTREACH_EMAIL_SENDING_ENABLED is exactly "true", when the postal address /
 * unsubscribe config is missing or when the recipient is on the do-not-contact
 * list. Every message gets the postal-address + one-click unsubscribe footer and
 * RFC 8058 List-Unsubscribe headers.
 */
export async function sendEmail(
  account: EmailAccount,
  to: string,
  subject: string,
  body: string,
  options: SendEmailOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  // 0. Outbound email is locked unless the founder explicitly unlocks it.
  if (!emailSendingEnabled(env)) {
    throw new EmailComplianceError("email_sending_disabled", EMAIL_SENDING_DISABLED_MESSAGE);
  }

  // 1. Compliance config must be present before we even open a connection.
  const compliance = requireEmailComplianceConfig(env);

  // 2. Never email someone who opted out or is otherwise suppressed.
  const db = options.db ?? await defaultDb();
  if (isRecipientSuppressed(db, to)) {
    throw new EmailComplianceError(
      "recipient_suppressed",
      "Refusing to send email: recipient is on the do-not-contact list.",
    );
  }

  const content = buildCompliantEmail(to, body, compliance);
  const factory = options.createTransport ?? ((opts: SMTPTransport.Options) => nodemailer.createTransport(opts));
  const transporter = factory({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_secure === 1,
    auth: {
      user: account.username,
      pass: account.password,
    },
    // Allow self-signed certs (common in some corp SMTP setups)
    tls: { rejectUnauthorized: emailTlsRejectUnauthorized() },
  });

  const from = account.from_name
    ? `"${account.from_name}" <${account.from_email}>`
    : account.from_email;

  await transporter.sendMail({
    from, to, subject, text: content.text,
    headers: content.headers,
    ...(account.reply_to ? { replyTo: account.reply_to } : {}),
  });
}

/**
 * Verifies SMTP connectivity — used by the test-connection endpoint.
 * Returns null on success, error message string on failure.
 */
export async function testSmtpConnection(account: Omit<EmailAccount, "id">): Promise<string | null> {
  try {
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_secure === 1,
      auth: { user: account.username, pass: account.password },
      tls: { rejectUnauthorized: emailTlsRejectUnauthorized() },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });
    await transporter.verify();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export interface ImapTestAccount {
  imap_host: string;
  imap_port: number;
  username: string;
  password: string;
  imap_username: string | null;
  imap_password: string | null;
}

/**
 * Verifies IMAP connectivity — connects, authenticates, then disconnects.
 * Returns null on success, error message string on failure.
 */
export async function testImapConnection(account: ImapTestAccount): Promise<string | null> {
  return new Promise((resolve) => {
    const imap = new Imap({
      host: account.imap_host,
      port: account.imap_port,
      tls: true,
      tlsOptions: { rejectUnauthorized: emailTlsRejectUnauthorized() },
      user: account.imap_username ?? account.username,
      password: account.imap_password ?? account.password,
      authTimeout: 10_000,
      connTimeout: 12_000,
    });

    imap.once("ready", () => {
      try { imap.end(); } catch { /* ignore */ }
      resolve(null);
    });

    imap.once("error", (err: Error) => {
      resolve(err.message ?? String(err));
    });

    imap.connect();
  });
}
