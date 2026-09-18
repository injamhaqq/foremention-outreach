import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type SalesTask = {
  id: string;
  company_id: string | null;
  target_id: string | null;
  task_type: "human_reply" | "follow_up_later" | "call" | "manual_review";
  status: string;
  priority: "high" | "normal" | "low";
  reason: string;
  source_reply_id: string | null;
  due_at: string | null;
  company_name: string | null;
  domain: string | null;
  buyer_name: string | null;
  buyer_role: string | null;
  email: string | null;
  linkedin_url: string | null;
};

function priorityClass(priority: SalesTask["priority"]) {
  if (priority === "high") return "text-error bg-error/10 border-error/20";
  if (priority === "low") return "text-base-content/45 bg-base-300/30 border-base-300";
  return "text-warning bg-warning/10 border-warning/20";
}

function taskLabel(type: SalesTask["task_type"]) {
  if (type === "human_reply") return "Human reply";
  if (type === "follow_up_later") return "Follow up later";
  if (type === "call") return "Call";
  return "Manual review";
}

export default function HunterSalesTasksPage() {
  const [tasks, setTasks] = useState<SalesTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/hunter/tasks?limit=250", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Sales tasks could not be loaded.");
      setTasks(Array.isArray(body?.data) ? body.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sales tasks could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  const complete = useCallback(async (taskId: string) => {
    setBusy(taskId);
    setError("");
    try {
      const response = await fetch("/api/hunter/tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Task could not be completed.");
      setTasks((current) => current.filter((task) => task.id !== taskId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task could not be completed.");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <>
      <Head><title>Sales Tasks · Customer Hunter</title></Head>
      <main className="max-w-6xl mx-auto px-5 py-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-info font-medium">Foremention Customer Hunter</div>
            <h1 className="text-2xl font-semibold text-base-content mt-1">Human sales tasks</h1>
            <p className="text-sm text-base-content/45 mt-1 max-w-2xl">
              The third channel for work that should not be automated: genuine replies, future follow-ups, calls, and manual review.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/hunter" className="btn btn-sm btn-ghost">Customer Hunter</Link>
            <button onClick={() => void refresh()} disabled={loading} className="btn btn-sm btn-outline">
              {loading ? <span className="loading loading-spinner loading-xs" /> : null}
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="alert alert-error text-sm mb-4">{error}</div>}

        {loading && tasks.length === 0 ? (
          <div className="py-20 flex justify-center"><span className="loading loading-spinner loading-md text-info" /></div>
        ) : tasks.length === 0 ? (
          <div className="bg-base-200 border border-base-300/50 rounded-xl py-16 px-6 text-center">
            <div className="text-base-content/70 font-medium">No pending human sales tasks.</div>
            <div className="text-sm text-base-content/35 mt-2">
              Positive replies and other human-required actions will be routed here automatically.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <article key={task.id} className="bg-base-200 border border-base-300/50 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${priorityClass(task.priority)}`}>
                        {task.priority} priority
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-info/20 bg-info/10 text-info">
                        {taskLabel(task.task_type)}
                      </span>
                    </div>
                    <h2 className="font-semibold text-base-content mt-2">
                      {task.company_name || "Unknown company"}
                      {task.buyer_name ? <span className="font-normal text-base-content/55"> · {task.buyer_name}</span> : null}
                    </h2>
                    <div className="text-xs text-base-content/35 mt-0.5">
                      {[task.buyer_role, task.domain].filter(Boolean).join(" · ")}
                    </div>
                    <p className="text-sm text-base-content/70 mt-3">{task.reason}</p>
                    {task.due_at && (
                      <div className="text-xs text-base-content/40 mt-2">
                        Due {new Date(task.due_at).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap justify-end">
                    {task.company_id && task.target_id && (
                      <Link
                        href={`/hunter/research?companyId=${encodeURIComponent(task.company_id)}&targetId=${encodeURIComponent(task.target_id)}`}
                        className="btn btn-xs btn-outline"
                      >
                        Open buyer
                      </Link>
                    )}
                    {task.email && (
                      <a href={`mailto:${task.email}`} className="btn btn-xs btn-ghost">Email</a>
                    )}
                    {task.linkedin_url && (
                      <a href={task.linkedin_url} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-ghost">
                        LinkedIn
                      </a>
                    )}
                    <button
                      onClick={() => void complete(task.id)}
                      disabled={busy === task.id}
                      className="btn btn-xs btn-primary"
                    >
                      {busy === task.id ? <span className="loading loading-spinner loading-xs" /> : null}
                      Complete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
