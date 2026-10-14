import type { NextApiRequest, NextApiResponse } from "next";
import { getToken } from "next-auth/jwt";
import { getDb } from "@/lib/db";
import { enrollApprovedHunterDraft } from "@/lib/hunter/approval";
import { getHunterRepository } from "@/lib/hunter/runtime-repository";
import { LINKEDIN_AUTOMATION_DISABLED_MESSAGE } from "@/lib/linkedin/automation-disabled";

/**
 * First-touch approval. Safety rules:
 *  - Only a signed-in founder browser session can approve. Service-to-service
 *    calls authenticated with the internal secret (and any other non-session
 *    caller) cannot approve outreach, because the send guard trusts approvals.
 *  - The approver identity comes from the session, never from the request body.
 *  - LinkedIn drafts are approved for MANUAL sending only; they are never
 *    enrolled into an automated run (LinkedIn automation is hard-disabled).
 *  - Email drafts are enrolled on the email track only. Actual sending is still
 *    locked by OUTREACH_EMAIL_SENDING_ENABLED, compliance config, suppressions,
 *    and HUNTER_RUNNERS_ENABLED.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const draftId = typeof req.body?.draftId === "string" ? req.body.draftId.trim() : "";
  const runId = typeof req.body?.runId === "string" ? req.body.runId.trim() : "";
  if (!draftId) return res.status(400).json({ error: "draftId is required" });

  const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!session) {
    return res.status(403).json({
      error: "Human approval requires a signed-in founder session; service calls cannot approve outreach.",
    });
  }
  const sessionIdentity = String(session.email || session.sub || session.name || "session").trim().slice(0, 180);
  const approvedBy = `founder:${sessionIdentity || "session"}`;

  try {
    const db = getDb();
    const draft = db.prepare("SELECT channel FROM hunter_message_drafts WHERE id = ?").get(draftId) as
      | { channel: "email" | "linkedin" }
      | undefined;
    if (!draft) return res.status(404).json({ error: "Hunter draft not found." });

    const repository = getHunterRepository();
    if (draft.channel === "linkedin") {
      repository.setHunterApproval({ draftId, state: "approved", approvedBy, note: "manual_linkedin_send_only" });
      return res.status(200).json({
        data: { enrolled: false, alreadyEnrolled: false, runProfileId: null, manualSendRequired: true },
        message: `${LINKEDIN_AUTOMATION_DISABLED_MESSAGE}. Copy the approved text and send it from LinkedIn yourself.`,
      });
    }

    if (!runId) return res.status(400).json({ error: "runId is required for email drafts" });
    repository.setHunterApproval({ draftId, state: "approved", approvedBy });
    const enrollment = enrollApprovedHunterDraft(db, { draftId, runId, allowedChannels: ["email"] });
    return res.status(200).json({ data: { ...enrollment, manualSendRequired: false } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval failed";
    const status = /not found/i.test(message) ? 404 : /suppressed|approval|required|active/i.test(message) ? 409 : 400;
    return res.status(status).json({ error: message });
  }
}
