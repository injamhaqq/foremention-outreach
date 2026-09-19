import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { runHunterAssistedCanary } from "@/lib/hunter/canary";
import { evaluateHunterReadiness } from "@/lib/hunter/readiness";

function enabled(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!enabled(process.env.HUNTER_CANARY_ENABLED)) {
    return res.status(403).json({ error: "Customer Hunter assisted canary is disabled." });
  }

  if (req.body?.confirmation !== "RUN_ASSISTED_CANARY") {
    return res.status(400).json({
      error: "Explicit canary confirmation is required.",
      confirmation: "RUN_ASSISTED_CANARY",
    });
  }

  const db = getDb();
  const readiness = evaluateHunterReadiness(db);
  if (!readiness.fullyReady) {
    return res.status(409).json({
      error: "Customer Hunter is not fully ready for a production canary.",
      readiness,
    });
  }

  try {
    const result = await runHunterAssistedCanary(db);
    return res.status(200).json({
      mode: "assisted",
      hardCaps: {
        discoveryQueries: 1,
        resultsPerQuery: 5,
        companies: 2,
        buyersPerCompany: 2,
        autoSend: false,
      },
      result,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Customer Hunter assisted canary failed.",
    });
  }
}
