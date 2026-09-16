import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { ensureHunterSchema } from "@/lib/hunter/schema";
import { loadHunterFeed } from "@/lib/hunter/feed";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 250;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 250;
  const db = getDb();
  ensureHunterSchema(db);
  const data = loadHunterFeed(db, limit);
  const counts = data.reduce((acc, item) => {
    acc[item.route] += 1;
    return acc;
  }, { priority: 0, good_cold: 0, cold_fit: 0, monitor: 0 });

  return res.status(200).json({ data, counts, generatedAt: new Date().toISOString() });
}
