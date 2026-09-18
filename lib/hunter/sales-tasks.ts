import { createHash } from "crypto";
import type Database from "better-sqlite3";

export type HunterSalesTaskType = "human_reply" | "follow_up_later" | "call" | "manual_review";
export type HunterSalesTaskPriority = "high" | "normal" | "low";

function stableId(value: string) {
  return `hst_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export function createHunterSalesTask(db: Database.Database, input: {
  companyId?: string | null;
  targetId?: string | null;
  taskType: HunterSalesTaskType;
  priority?: HunterSalesTaskPriority;
  reason: string;
  sourceReplyId?: string | null;
  dueAt?: string | null;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}) {
  const reason = input.reason.trim().slice(0, 1_000);
  if (!reason) throw new Error("Hunter sales task reason is required.");
  const dedupeKey = input.dedupeKey?.trim()
    || [
      input.targetId ?? "",
      input.taskType,
      input.sourceReplyId ?? "",
      reason.toLowerCase(),
    ].join("|");
  const id = stableId(dedupeKey);
  const priority = input.priority ?? "normal";

  db.prepare(`
    INSERT INTO hunter_sales_tasks (
      id, company_id, target_id, dedupe_key, task_type, status, priority,
      reason, source_reply_id, due_at, metadata_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(dedupe_key) DO UPDATE SET
      reason = excluded.reason,
      due_at = COALESCE(excluded.due_at, hunter_sales_tasks.due_at),
      metadata_json = excluded.metadata_json,
      updated_at = datetime('now')
  `).run(
    id,
    input.companyId ?? null,
    input.targetId ?? null,
    dedupeKey,
    input.taskType,
    priority,
    reason,
    input.sourceReplyId ?? null,
    input.dueAt ?? null,
    JSON.stringify(input.metadata ?? {}),
  );

  return db.prepare(`
    SELECT id, company_id, target_id, task_type, status, priority, reason,
           source_reply_id, due_at, metadata_json, created_at, updated_at
    FROM hunter_sales_tasks WHERE dedupe_key = ?
  `).get(dedupeKey);
}

export function listPendingHunterSalesTasks(db: Database.Database, limit = 100) {
  return db.prepare(`
    SELECT
      st.id, st.company_id, st.target_id, st.task_type, st.status, st.priority,
      st.reason, st.source_reply_id, st.due_at, st.metadata_json, st.created_at, st.updated_at,
      c.name AS company_name, c.domain,
      t.full_name AS buyer_name, t.title AS buyer_role, t.email, t.linkedin_url
    FROM hunter_sales_tasks st
    LEFT JOIN companies c ON c.id = st.company_id
    LEFT JOIN targets t ON t.id = st.target_id
    WHERE st.status = 'pending'
    ORDER BY
      CASE st.priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      CASE WHEN st.due_at IS NULL THEN 1 ELSE 0 END,
      datetime(st.due_at) ASC,
      datetime(st.created_at) ASC
    LIMIT ?
  `).all(Math.max(1, Math.min(500, limit)));
}

export function completeHunterSalesTask(db: Database.Database, taskId: string) {
  const result = db.prepare(`
    UPDATE hunter_sales_tasks
    SET status = 'completed', updated_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(taskId);
  return result.changes === 1;
}
