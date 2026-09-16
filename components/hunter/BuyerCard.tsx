import Link from "next/link";
import type { HunterRoute } from "@/lib/hunter/types";

export type BuyerCardItem = {
  id: string;
  companyId: string;
  targetId: string | null;
  companyName: string;
  domain: string | null;
  industry: string | null;
  buyerName: string | null;
  buyerRole: string | null;
  email: string | null;
  linkedinUrl: string | null;
  fitScore: number;
  intentScore: number;
  buyerScore: number;
  totalScore: number;
  route: HunterRoute;
  outreachReady: boolean;
  reason: string;
  observedAt: string | null;
  latestSignalTitle: string | null;
  latestSignalEvidence: string | null;
  latestSignalUrl: string | null;
  draftStatus: string | null;
};

const ROUTE_STYLE: Record<HunterRoute, { label: string; className: string }> = {
  priority: { label: "High intent", className: "text-error bg-error/10 border-error/20" },
  good_cold: { label: "Good cold", className: "text-success bg-success/10 border-success/20" },
  cold_fit: { label: "Cold fit", className: "text-info bg-info/10 border-info/20" },
  monitor: { label: "Monitor", className: "text-base-content/50 bg-base-300/40 border-base-300" },
};

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-base-300/50 bg-base-300/20 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-base-content/35">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-base-content">{value}</div>
    </div>
  );
}

export default function BuyerCard({ item }: { item: BuyerCardItem }) {
  const route = ROUTE_STYLE[item.route];
  const queryTarget = item.targetId ? `&targetId=${encodeURIComponent(item.targetId)}` : "";

  return (
    <article className="bg-base-200 border border-base-300/50 rounded-xl p-4 hover:border-base-300 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-base-content truncate">{item.companyName}</h3>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${route.className}`}>
              {route.label}
            </span>
            {item.draftStatus && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-warning/20 bg-warning/10 text-warning">
                {item.draftStatus}
              </span>
            )}
          </div>
          <div className="text-xs text-base-content/40 mt-1 flex flex-wrap gap-x-2 gap-y-1">
            {item.domain && <span>{item.domain}</span>}
            {item.industry && <span>· {item.industry}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-semibold tabular-nums text-base-content">{item.totalScore}</div>
          <div className="text-[10px] uppercase tracking-wider text-base-content/30">score</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Score label="Fit" value={item.fitScore} />
        <Score label="Intent" value={item.intentScore} />
        <Score label="Buyer" value={item.buyerScore} />
      </div>

      <div className="mt-4 rounded-lg bg-base-300/20 border border-base-300/40 p-3">
        <div className="text-[10px] uppercase tracking-wider text-base-content/35 mb-1">Why now</div>
        <div className="text-sm text-base-content/80">{item.latestSignalTitle || "No current signal title"}</div>
        {item.latestSignalEvidence && (
          <p className="text-xs leading-relaxed text-base-content/45 mt-1 line-clamp-2">{item.latestSignalEvidence}</p>
        )}
        {item.latestSignalUrl && (
          <a href={item.latestSignalUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-1.5 text-[11px] text-info hover:underline">
            View evidence
          </a>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-base-content/80 truncate">{item.buyerName || "Buyer not assigned"}</div>
          <div className="text-xs text-base-content/35 truncate">{item.buyerRole || item.reason}</div>
          <div className="flex gap-1.5 mt-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${item.email ? "text-success border-success/20 bg-success/10" : "text-base-content/30 border-base-300"}`}>
              Email {item.email ? "ready" : "missing"}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${item.linkedinUrl ? "text-info border-info/20 bg-info/10" : "text-base-content/30 border-base-300"}`}>
              LinkedIn {item.linkedinUrl ? "ready" : "missing"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 shrink-0">
          <Link href={`/hunter/signals?companyId=${encodeURIComponent(item.companyId)}`} className="btn btn-xs btn-ghost">
            Evidence
          </Link>
          {item.targetId && (
            <Link href={`/hunter/research?companyId=${encodeURIComponent(item.companyId)}${queryTarget}`} className="btn btn-xs btn-outline">
              Research & outreach
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
