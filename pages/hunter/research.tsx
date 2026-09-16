import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";

type Context = {
  target: { id: string; fullName: string; role: string; email?: string | null; linkedinUrl?: string | null };
  company: { id: string; name: string; domain: string };
  signals: Array<{ id: string; type: string; title: string; summary: string; evidenceText: string; sourceUrl: string; observedAt: string; confidence: number }>;
};

type Packet = {
  target: Context["target"];
  company: Context["company"];
  evidence: Array<{ id: string; kind: string; text: string; sourceUrl?: string | null; observedAt?: string | null }>;
  claims: Array<{ id: string; kind: string; text: string; provenanceIds: string[] }>;
  createdAt: string;
};

type Draft = {
  id: string;
  channel: "email" | "linkedin";
  subject?: string | null;
  body: string;
  evidenceIds: string[];
  status: string;
};

type Run = { id: string; status: string; workflow_name?: string | null; list_name?: string | null; account_name?: string | null };

export default function HunterResearchPage() {
  const router = useRouter();
  const targetId = typeof router.query.targetId === "string" ? router.query.targetId : "";
  const [context, setContext] = useState<Context | null>(null);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState("");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    setError("");
    try {
      const [contextResponse, runsResponse] = await Promise.all([
        fetch(`/api/hunter/context?targetId=${encodeURIComponent(targetId)}`, { cache: "no-store" }),
        fetch("/api/runs", { cache: "no-store" }),
      ]);
      const contextBody = await contextResponse.json();
      if (!contextResponse.ok) throw new Error(contextBody?.error || "Research context could not be loaded.");
      setContext(contextBody as Context);
      const runsBody = await runsResponse.json().catch(() => []);
      const runRows = Array.isArray(runsBody) ? runsBody : Array.isArray(runsBody?.runs) ? runsBody.runs : [];
      setRuns(runRows);
      const active = runRows.find((run: Run) => run.status === "running" || run.status === "paused") as Run | undefined;
      if (active) setRunId(active.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research context could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  useEffect(() => { void load(); }, [load]);

  async function buildResearch() {
    if (!context) return;
    setWorking("research"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/hunter/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...context, summarize: false }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Research failed.");
      setPacket(body.packet as Packet);
      setMessage("Evidence-backed research packet created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research failed.");
    } finally {
      setWorking("");
    }
  }

  async function createDraft(channel: "email" | "linkedin") {
    if (!packet) return;
    setWorking(channel); setError(""); setMessage("");
    try {
      const response = await fetch("/api/hunter/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packet, channel }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `${channel} draft failed.`);
      const draft = body.data as Draft;
      setDrafts((current) => [...current.filter((item) => item.id !== draft.id), draft]);
      setMessage(`${channel === "email" ? "Email" : "LinkedIn"} draft generated from stored evidence.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${channel} draft failed.`);
    } finally {
      setWorking("");
    }
  }

  async function approve(draft: Draft) {
    if (!runId) { setError("Choose an existing campaign run before approving first touch."); return; }
    setWorking(`approve:${draft.id}`); setError(""); setMessage("");
    try {
      const response = await fetch("/api/hunter/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, runId, approvedBy: "founder" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Approval failed.");
      setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, status: "enrolled" } : item));
      setMessage("Approved and enrolled exactly once. Linki now owns sequence execution and limits.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setWorking("");
    }
  }

  return (
    <>
      <Head><title>Research & Outreach · Foremention</title></Head>
      <main className="max-w-6xl mx-auto px-5 py-6">
        <div className="mb-6">
          <Link href="/hunter" className="text-xs text-base-content/35 hover:text-base-content">← Customer Hunter</Link>
          <div className="mt-2 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold">Research & assisted outreach</h1>
              <p className="text-sm text-base-content/40 mt-1">Research first. Every factual claim stays tied to evidence. First touch requires approval.</p>
            </div>
            {context && (
              <div className="text-right">
                <div className="text-sm font-medium">{context.target.fullName}</div>
                <div className="text-xs text-base-content/40">{context.target.role} · {context.company.name}</div>
              </div>
            )}
          </div>
        </div>

        {error && <div className="alert alert-error text-sm mb-4">{error}</div>}
        {message && <div className="alert alert-success text-sm mb-4">{message}</div>}
        {loading && <div className="py-20 flex justify-center"><span className="loading loading-spinner" /></div>}
        {!targetId && <div className="alert text-sm">Choose a buyer from Customer Hunter to start research.</div>}

        {context && !loading && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className="lg:col-span-1 space-y-4">
              <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
                <div className="text-xs font-medium uppercase tracking-wider text-base-content/40">Buyer</div>
                <div className="mt-2 font-medium">{context.target.fullName}</div>
                <div className="text-sm text-base-content/45">{context.target.role}</div>
                <div className="mt-3 space-y-1 text-xs text-base-content/45">
                  <div>Email: {context.target.email || "not available"}</div>
                  <div>LinkedIn: {context.target.linkedinUrl ? "available" : "not available"}</div>
                  <div>Signals: {context.signals.length}</div>
                </div>
                <button onClick={() => void buildResearch()} disabled={!!working || context.signals.length === 0} className="btn btn-sm btn-primary w-full mt-4">
                  {working === "research" && <span className="loading loading-spinner loading-xs" />}
                  Research prospect
                </button>
              </div>

              <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
                <div className="text-xs font-medium uppercase tracking-wider text-base-content/40 mb-2">Campaign destination</div>
                <select value={runId} onChange={(event) => setRunId(event.target.value)} className="select select-sm select-bordered w-full bg-base-100">
                  <option value="">Choose campaign run</option>
                  {runs.map((run) => <option key={run.id} value={run.id}>{run.workflow_name || run.id} · {run.status}</option>)}
                </select>
                <p className="text-[11px] text-base-content/30 mt-2">Approval enrolls the buyer into Linki&apos;s existing run; it does not bypass mailbox or LinkedIn limits.</p>
              </div>
            </section>

            <section className="lg:col-span-2 space-y-4">
              <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-base-content/40">Research packet</div>
                    <div className="text-sm text-base-content/45 mt-1">{packet ? `${packet.evidence.length} evidence items · ${packet.claims.length} supported claims` : "Not generated yet"}</div>
                  </div>
                  {packet && (
                    <div className="flex gap-2">
                      <button onClick={() => void createDraft("email")} disabled={!!working} className="btn btn-xs btn-outline">
                        {working === "email" ? <span className="loading loading-spinner loading-xs" /> : null} Cold email
                      </button>
                      <button onClick={() => void createDraft("linkedin")} disabled={!!working} className="btn btn-xs btn-outline">
                        {working === "linkedin" ? <span className="loading loading-spinner loading-xs" /> : null} LinkedIn DM
                      </button>
                    </div>
                  )}
                </div>
                {!packet ? (
                  <p className="text-sm text-base-content/35">Click Research prospect to build the evidence packet used by personalization.</p>
                ) : (
                  <div className="space-y-2">
                    {packet.claims.map((claim) => (
                      <div key={claim.id} className="rounded-lg bg-base-300/20 border border-base-300/40 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-info">{claim.kind}</div>
                        <div className="text-sm text-base-content/75 mt-1">{claim.text}</div>
                        <div className="text-[10px] text-base-content/30 mt-1">Evidence: {claim.provenanceIds.join(", ")}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {drafts.map((draft) => (
                <div key={draft.id} className="bg-base-200 border border-base-300/50 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase tracking-wider text-info">{draft.channel}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-base-300 text-base-content/40">{draft.status}</span>
                    </div>
                    {draft.status !== "enrolled" && (
                      <button onClick={() => void approve(draft)} disabled={!!working || !runId} className="btn btn-xs btn-success">
                        {working === `approve:${draft.id}` ? <span className="loading loading-spinner loading-xs" /> : null}
                        Approve & start
                      </button>
                    )}
                  </div>
                  {draft.subject && <div className="text-sm font-medium mb-2">Subject: {draft.subject}</div>}
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-base-content/70 bg-base-300/20 border border-base-300/40 rounded-lg p-3">{draft.body}</pre>
                  <div className="text-[10px] text-base-content/30 mt-2">Evidence: {draft.evidenceIds.join(", ")}</div>
                </div>
              ))}
            </section>
          </div>
        )}
      </main>
    </>
  );
}
