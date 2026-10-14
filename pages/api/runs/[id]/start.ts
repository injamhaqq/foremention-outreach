import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { ensureGlobalRunnerStarted } from "@/lib/linkedin/runner";
import { hunterRunnersEnabled, HUNTER_RUNNERS_DISABLED_MESSAGE } from "@/lib/hunter/runner-flags";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const id = req.query.id as string;

  const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(id) as { status: string } | undefined;
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (run.status === "running") return res.status(400).json({ error: "Run already running" });
  // Runners are OFF by default; refuse rather than mark a run "running" that nothing will process.
  if (!hunterRunnersEnabled(process.env)) return res.status(409).json({ error: HUNTER_RUNNERS_DISABLED_MESSAGE });

  db.prepare(
    "UPDATE runs SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?"
  ).run(id);

  ensureGlobalRunnerStarted();

  return res.json({ ok: true });
}
