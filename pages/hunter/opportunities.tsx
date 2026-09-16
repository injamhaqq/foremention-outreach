import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const STAGES = [
  "identified", "contacted", "replied", "interested", "meeting_booked", "discovery",
  "design_partner", "pilot_proposed", "pilot_active", "paid_customer", "lost",
] as const;
type Stage = typeof STAGES[number];

type Opportunity = {
  id: string;
  company_id: string;
  target_id: string | null;
  stage: Stage;
  next_action: string | null;
  next_action_due_at: string | null;
  company_name: string;
  domain: string | null;
  buyer_name: string | null;
  buyer_role: string | null;
  updated_at: string;
};

type Metrics = {
  totalOpportunities: number;
  paidCustomers: number;
  repliedOrBeyond: number;
  meetingBookedOrBeyond: number;
  replyRate: { numerator: number; denominator: number; rate: number };
  meetingRate: { numerator: number; denominator: number; rate: number };
  paidCustomerRate: { numerator: number; denominator: number; rate: number };
  note: string;
};

function pct(value: number) { return `${Math.round(value * 100)}%`; }
function title(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()); }

export default function HunterOpportunitiesPage() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/hunter/opportunities", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Opportunities could not be loaded.");
      setItems(body.data ?? []);
      setMetrics(body.metrics ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opportunities could not be loaded.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const out = new Map<Stage, Opportunity[]>();
    for (const stage of STAGES) out.set(stage, []);
    for (const item of items) out.get(item.stage)?.push(item);
    return out;
  }, [items]);

  return (
    <>
      <Head><title>Opportunities · Foremention Outreach</title></Head>
      <main className="max-w-[1500px] mx-auto px-5 py-6">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <Link href="/hunter" className="text-xs text-base-content/35 hover:text-base-content">← Customer Hunter</Link>
            <h1 className="text-2xl font-semibold mt-2">Opportunity & learning loop</h1>
            <p className="text-sm text-base-content/40 mt-1">Track replies → meetings → design partners → pilots → paid customers without inventing commercial evidence.</p>
          </div>
          <button onClick={() => void load()} className="btn btn-sm btn-outline" disabled={loading}>Refresh</button>
        </div>

        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="stat bg-base-200 border border-base-300/50 rounded-xl p-4"><div className="stat-title text-xs">Opportunities</div><div className="stat-value text-2xl">{metrics.totalOpportunities}</div></div>
            <div className="stat bg-base-200 border border-base-300/50 rounded-xl p-4"><div className="stat-title text-xs">Reply+ rate</div><div className="stat-value text-2xl">{pct(metrics.replyRate.rate)}</div><div className="text-[10px] text-base-content/30">{metrics.replyRate.numerator}/{metrics.replyRate.denominator}</div></div>
            <div className="stat bg-base-200 border border-base-300/50 rounded-xl p-4"><div className="stat-title text-xs">Meeting+ rate</div><div className="stat-value text-2xl">{pct(metrics.meetingRate.rate)}</div><div className="text-[10px] text-base-content/30">{metrics.meetingRate.numerator}/{metrics.meetingRate.denominator}</div></div>
            <div className="stat bg-base-200 border border-base-300/50 rounded-xl p-4"><div className="stat-title text-xs">Paid customers</div><div className="stat-value text-2xl">{metrics.paidCustomers}</div><div className="text-[10px] text-base-content/30">{metrics.paidCustomerRate.numerator}/{metrics.paidCustomerRate.denominator}</div></div>
          </div>
        )}

        {metrics?.note && <div className="text-[11px] text-base-content/30 mb-4">{metrics.note}</div>}
        {error && <div className="alert alert-error text-sm mb-4">{error}</div>}
        {loading && items.length === 0 ? <div className="py-20 flex justify-center"><span className="loading loading-spinner" /></div> : (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 min-w-max items-start">
              {STAGES.map((stage) => (
                <section key={stage} className="w-72 shrink-0 bg-base-200 border border-base-300/50 rounded-xl">
                  <div className="px-3 py-3 border-b border-base-300/40 flex items-center justify-between">
                    <span className="text-xs font-medium text-base-content/60">{title(stage)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-base-300/50 rounded">{grouped.get(stage)?.length ?? 0}</span>
                  </div>
                  <div className="p-2 space-y-2 min-h-20">
                    {(grouped.get(stage) ?? []).map((item) => (
                      <article key={item.id} className="rounded-lg bg-base-100 border border-base-300/50 p-3">
                        <div className="text-sm font-medium truncate">{item.company_name}</div>
                        <div className="text-xs text-base-content/35 mt-0.5 truncate">{item.buyer_name || "Company opportunity"}{item.buyer_role ? ` · ${item.buyer_role}` : ""}</div>
                        {item.next_action && <div className="mt-3 text-xs text-base-content/55 leading-relaxed">{item.next_action}</div>}
                        {item.next_action_due_at && <div className="mt-2 text-[10px] text-warning">Due {new Date(item.next_action_due_at).toLocaleDateString()}</div>}
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
