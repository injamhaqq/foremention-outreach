import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { runHunterAcquisitionCycle } from "@/lib/hunter/acquisition-runner";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const result = await runHunterAcquisitionCycle(getDb(), { forceDiscovery: true });
    return res.status(200).json({ ...result, generatedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Buyer discovery failed.";
    return res.status(502).json({ error: message });
  }
}
