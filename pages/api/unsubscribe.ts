import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { handleUnsubscribeRequest } from "@/lib/email/unsubscribe-handler";

// Public, unauthenticated endpoint (exempted in proxy.ts): recipients must be
// able to opt out without an account. The signed token is the only credential.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  let outcome;
  try {
    outcome = handleUnsubscribeRequest(getDb(), { method: req.method, token: req.query.token });
  } catch (error) {
    console.error("[unsubscribe] failed to record opt-out:", error instanceof Error ? error.message : "unknown error");
    return res.status(500).send("We could not process your request. Please reply to the email with \"unsubscribe\".");
  }
  if (req.method === "POST") {
    return res.status(outcome.status).json(outcome.ok ? { ok: true } : { error: outcome.error });
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const message = outcome.ok
    ? "You have been unsubscribed and will not receive further emails from us."
    : outcome.error;
  return res
    .status(outcome.status)
    .send(`<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Unsubscribe</title></head><body><p>${message}</p></body></html>`);
}
