import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import BuyerCard, { type BuyerCardItem } from "@/components/hunter/BuyerCard";
import type { HunterRoute } from "@/lib/hunter/types";
import type { HunterOperationsSnapshot } from "@/lib/hunter/operations";

type FeedResponse = {
  data: BuyerCardItem[];
  counts: Record<HunterRoute, number>;
  operations: HunterOperationsSnapshot;
  generatedAt: string;
};

const FILTERS: Array<{ value: "all" | HunterRoute; label: string }> = [
  { value: "all", label: "All buyers" },
  { value: "priority", label: "High intent" },
  { value: "good_cold", label: "Good cold" },
  { value: "cold_fit", label: "Cold fit" },
  { value: "monitor", label: "Monitor" },
];

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
      <div className="text-2xl font-semibold tabular-nums text-base-content">{value.toLocaleString()}</div>
      <div className="text-xs text-base-content/55 mt-1">{label}</div>
      <div className="text-[10px] text-base-content/30 mt-1">{detail}</div>
    </div>
  );
}


function ChannelHealth({ label, health }: {
  label: string;
  health: HunterOperationsSnapshot["health"]["channels"]["email"];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${health.healthy ? "bg-success" : "bg-error"}`} />
      <span className="text-xs text-base-content/65">{label}</span>
      <span className="text-[10px] text-base-content/35">
        {health.healthy ? `${health.remainingCapacity} capacity` : health.reasons.join(", ").replaceAll("_", " ")}
      </span>
    </div>
  );
}

export default function HunterBuyerFeedPage() {
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | HunterRoute>("all");
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/hunter/feed?limit=500", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Buyer feed could not be loaded.");
      setFeed(body as FeedResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Buyer feed could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  const findBuyersNow = useCallback(async () => {
    setDiscovering(true);
    setError("");
    try {
      const response = await fetch("/api/hunter/discover", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Buyer discovery could not be started.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Buyer discovery could not be started.");
    } finally {
      setDiscovering(false);
    }
  }, [refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (feed?.data ?? []).filter((item) => {
      if (filter !== "all" && item.route !== filter) return false;
      if (!normalized) return true;
      return [item.companyName, item.domain, item.buyerName, item.buyerRole, item.latestSignalTitle]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [feed, filter, query]);

  const counts = feed?.counts ?? { priority: 0, good_cold: 0, cold_fit: 0, monitor: 0 };
  const ready = counts.priority + counts.good_cold + counts.cold_fit;

  return (
    <>
      <Head><title>Customer Hunter · Foremention Outreach</title></Head>
      <main className="max-w-7xl mx-auto px-5 py-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-info font-medium">Foremention Outreach</div>
            <h1 className="text-2xl font-semibold text-base-content mt-1">Customer Hunter</h1>
            <p className="text-sm text-base-content/45 mt-1 max-w-2xl">
              Intent buyers, evidence, research, and multichannel cold outreach in one operating view.
            </p>
          </div>
          <button onClick={() => void findBuyersNow()} disabled={loading || discovering} className="btn btn-sm btn-primary">
            {discovering ? <span className="loading loading-spinner loading-xs" /> : null}
            {discovering ? "Finding buyers…" : "Find buyers now"}
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <Metric label="Ready to contact" value={ready} detail="Fit + intent + reachable buyer" />
          <Metric label="High intent" value={counts.priority} detail="Review first" />
          <Metric label="Good cold" value={counts.good_cold} detail="Strong outreach candidates" />
          <Metric label="Cold fit" value={counts.cold_fit} detail="Usable with a strong angle" />
          <Metric label="Monitoring" value={counts.monitor} detail="Waiting for a better trigger" />
        </div>

        {feed?.operations && (
          <section className="bg-base-200 border border-base-300/50 rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div>
                <div className="text-sm font-medium text-base-content">Today</div>
                <div className="text-[10px] text-base-content/35">Observed activity and current operational state — no projected conversions.</div>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <ChannelHealth label="Email" health={feed.operations.health.channels.email} />
                <ChannelHealth label="LinkedIn" health={feed.operations.health.channels.linkedin} />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
              <Metric label="Accounts monitored" value={feed.operations.today.accountsMonitored} detail="Seen today" />
              <Metric label="New signals" value={feed.operations.today.newSignals} detail="Captured today" />
              <Metric label="Buyers discovered" value={feed.operations.today.buyersDiscovered} detail="New buyer provenance" />
              <Metric label="Verified contacts" value={feed.operations.today.verifiedContacts} detail="Current verified work emails" />
              <Metric label="Waiting approval" value={feed.operations.today.messagesWaitingApproval} detail="Draft first touches" />
              <Metric label="Replies" value={feed.operations.today.replies} detail="Classified today" />
              <Metric label="Positive replies" value={feed.operations.today.positiveReplies} detail="Human-positive today" />
            </div>

            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 text-xs">
              <div className="rounded-lg border border-base-300/50 bg-base-300/20 px-3 py-2">
                <div className="text-base-content/35 text-[10px] uppercase tracking-wider">Meetings+</div>
                <div className="text-base-content font-semibold mt-0.5">{feed.operations.pipeline.meetingsOrBeyond.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-base-300/50 bg-base-300/20 px-3 py-2">
                <div className="text-base-content/35 text-[10px] uppercase tracking-wider">Active pilots+</div>
                <div className="text-base-content font-semibold mt-0.5">{feed.operations.pipeline.activePilotsOrBeyond.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-base-300/50 bg-base-300/20 px-3 py-2">
                <div className="text-base-content/35 text-[10px] uppercase tracking-wider">Paid customers</div>
                <div className="text-base-content font-semibold mt-0.5">{feed.operations.pipeline.paidCustomers.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-base-300/50 bg-base-300/20 px-3 py-2">
                <div className="text-base-content/35 text-[10px] uppercase tracking-wider">Source failures 24h</div>
                <div className="text-base-content font-semibold mt-0.5">{feed.operations.health.sourceFailures24h.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-base-300/50 bg-base-300/20 px-3 py-2">
                <div className="text-base-content/35 text-[10px] uppercase tracking-wider">Tracked cost today</div>
                <div className="text-base-content font-semibold mt-0.5">${feed.operations.costs.todayUsd.toFixed(2)}</div>
              </div>
              <div className="rounded-lg border border-base-300/50 bg-base-300/20 px-3 py-2">
                <div className="text-base-content/35 text-[10px] uppercase tracking-wider">Autopilot</div>
                <div className="text-base-content font-semibold mt-0.5">
                  {feed.operations.autopilot.autoStartedToday} auto · {feed.operations.autopilot.approvalRequiredToday} review · {feed.operations.autopilot.blockedToday} blocked
                </div>
              </div>
            </div>
          </section>
        )}

        <div className="bg-base-200 border border-base-300/50 rounded-xl p-3 mb-4 flex items-center gap-3 flex-wrap">
          <div className="join">
            {FILTERS.map((entry) => (
              <button
                key={entry.value}
                onClick={() => setFilter(entry.value)}
                className={`btn btn-xs join-item ${filter === entry.value ? "btn-active" : "btn-ghost"}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search company, buyer, role, or signal…"
            className="input input-sm input-bordered flex-1 min-w-56 bg-base-100"
          />
          {feed?.generatedAt && (
            <span className="text-[10px] text-base-content/30 ml-auto">
              Updated {new Date(feed.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>

        {error && <div className="alert alert-error text-sm mb-4">{error}</div>}

        {loading && !feed ? (
          <div className="py-20 flex justify-center"><span className="loading loading-spinner loading-md text-info" /></div>
        ) : items.length === 0 ? (
          <div className="bg-base-200 border border-base-300/50 rounded-xl py-16 px-6 text-center">
            <div className="text-base-content/70 font-medium">No buyers match this view yet.</div>
            <p className="text-sm text-base-content/35 mt-2">
              Signals and qualification results will appear here as the Hunter runner processes your prospect universe.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {items.map((item) => <BuyerCard key={`${item.companyId}:${item.targetId ?? "company"}`} item={item} />)}
          </div>
        )}
      </main>
    </>
  );
}
