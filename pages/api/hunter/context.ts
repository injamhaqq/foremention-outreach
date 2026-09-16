import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { ensureHunterSchema } from "@/lib/hunter/schema";
import { getHunterRepository } from "@/lib/hunter/runtime-repository";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const targetId = typeof req.query.targetId === "string" ? req.query.targetId.trim() : "";
  if (!targetId) return res.status(400).json({ error: "targetId is required." });

  const db = getDb();
  ensureHunterSchema(db);
  const target = db.prepare(`
    SELECT id, full_name, title, email, linkedin_url, company_id, company
    FROM targets WHERE id = ?
  `).get(targetId) as {
    id: string;
    full_name: string | null;
    title: string | null;
    email: string | null;
    linkedin_url: string | null;
    company_id: string | null;
    company: string | null;
  } | undefined;
  if (!target) return res.status(404).json({ error: "Target not found." });
  if (!target.company_id) return res.status(409).json({ error: "Target is not linked to a company." });

  const company = db.prepare("SELECT id, name, domain FROM companies WHERE id = ?").get(target.company_id) as
    | { id: string; name: string; domain: string | null }
    | undefined;
  if (!company) return res.status(404).json({ error: "Company not found." });

  const signals = getHunterRepository().listSignalsForCompany(company.id);
  return res.status(200).json({
    target: {
      id: target.id,
      fullName: target.full_name || target.email || "Unknown buyer",
      role: target.title || "Buyer",
      email: target.email,
      linkedinUrl: target.linkedin_url,
    },
    company: {
      id: company.id,
      name: company.name || target.company || company.domain || "Unknown company",
      domain: company.domain || "",
    },
    signals: signals.map((signal) => ({
      id: signal.id,
      type: signal.type,
      title: signal.title,
      summary: signal.summary,
      evidenceText: signal.evidenceText,
      sourceUrl: signal.sourceUrl,
      observedAt: signal.observedAt,
      confidence: signal.confidence,
    })),
  });
}
