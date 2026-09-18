import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

type Signal = {
  id: string;
  type: string;
  title: string;
  summary: string;
  sourceUrl: string;
  sourceName?: string | null;
  evidenceText: string;
  observedAt: string;
  expiresAt?: string | null;
  confidence: number;
  scoreContribution: number;
};

export default function HunterSignalsPage() {
  const router = useRouter();
  const companyId = typeof router.query.companyId === "string" ? router.query.companyId : "";
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loadedCompanyId, setLoadedCompanyId] = useState("");
  const [error, setError] = useState("");
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const loading = Boolean(companyId && loadedCompanyId !== companyId);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    fetch(`/api/hunter/signals?companyId=${encodeURIComponent(companyId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Signals could not be loaded.");
        if (cancelled) return;
        setSignals(body.data ?? []);
        setSnapshotAt(typeof body.generatedAt === "string" ? Date.parse(body.generatedAt) : null);
        setError("");
        setLoadedCompanyId(companyId);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Signals could not be loaded.");
        setLoadedCompanyId(companyId);
      });
    return () => { cancelled = true; };
  }, [companyId]);

  return (
    <>
      <Head><title>Buyer Signals · Foremention Outreach</title></Head>
      <main className="max-w-5xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div>
            <Link href="/hunter" className="text-xs text-base-content/35 hover:text-base-content">← Customer Hunter</Link>
            <h1 className="text-2xl font-semibold mt-2">Buyer intent & pain evidence</h1>
            <p className="text-sm text-base-content/40 mt-1">Every signal remains attributable to a source and observation time.</p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full border border-base-300 text-base-content/45">{signals.length} signals</span>
        </div>

        {!companyId && <div className="alert text-sm">Open this page from a Customer Hunter account to inspect its evidence.</div>}
        {error && <div className="alert alert-error text-sm mb-4">{error}</div>}
        {loading && <div className="py-16 flex justify-center"><span className="loading loading-spinner" /></div>}

        {!loading && companyId && signals.length === 0 && (
          <div className="rounded-xl border border-base-300/50 bg-base-200 p-10 text-center text-sm text-base-content/45">No stored signals for this account.</div>
        )}

        <div className="space-y-3">
          {signals.map((signal) => {
            const expired = signal.expiresAt && snapshotAt !== null ? Date.parse(signal.expiresAt) < snapshotAt : false;
            return (
              <article key={signal.id} className="rounded-xl border border-base-300/50 bg-base-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-info/20 bg-info/10 text-info">{signal.type.replaceAll("_", " ")}</span>
                      {expired && <span className="text-[10px] px-2 py-0.5 rounded border border-warning/20 bg-warning/10 text-warning">Expired</span>}
                    </div>
                    <h2 className="font-medium text-base-content mt-2">{signal.title}</h2>
                    <p className="text-sm text-base-content/50 mt-1">{signal.summary}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-semibold tabular-nums">+{signal.scoreContribution}</div>
                    <div className="text-[10px] text-base-content/30">intent weight</div>
                  </div>
                </div>
                <div className="mt-3 rounded-lg bg-base-300/20 border border-base-300/40 p-3 text-xs leading-relaxed text-base-content/55">
                  {signal.evidenceText}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-base-content/30">
                  <span>Observed {new Date(signal.observedAt).toLocaleString()}</span>
                  <span>Confidence {Math.round(signal.confidence * 100)}%</span>
                  {signal.sourceName && <span>{signal.sourceName}</span>}
                  <a href={signal.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">Open source</a>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </>
  );
}
