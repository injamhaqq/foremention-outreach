import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { ensureHunterSchema } from "@/lib/hunter/schema";
import { completeHunterSalesTask, listPendingHunterSalesTasks } from "@/lib/hunter/sales-tasks";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  ensureHunterSchema(db);

  if (req.method === "GET") {
    const raw = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(500, Math.floor(raw))) : 100;
    return res.status(200).json({ data: listPendingHunterSalesTasks(db, limit) });
  }

  if (req.method === "PATCH") {
    const taskId = typeof req.body?.taskId === "string" ? req.body.taskId.trim() : "";
    if (!taskId) return res.status(400).json({ error: "taskId is required." });
    const completed = completeHunterSalesTask(db, taskId);
    if (!completed) return res.status(404).json({ error: "Pending sales task not found." });
    return res.status(200).json({ completed: true, taskId });
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "Method not allowed." });
}
