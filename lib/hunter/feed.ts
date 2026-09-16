import type Database from "better-sqlite3";
import type { HunterRoute } from "./types";

export type HunterFeedRankable = {
  id: string;
  route: HunterRoute;
  observedAt: string | null;
  totalScore: number;
};

export type HunterFeedItem = HunterFeedRankable & {
  scoreId: string;
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
  outreachReady: boolean;
  reason: string;
  latestSignalTitle: string | null;
  latestSignalEvidence: string | null;
  latestSignalUrl: string | null;
  draftStatus: string | null;
};

const ROUTE_WEIGHT: Record<HunterRoute, number> = {
  priority: 4,
  good_cold: 3,
  cold_fit: 2,
  monitor: 1,
};

function timestamp(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function rankHunterFeed<T extends HunterFeedRankable>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const routeDelta = ROUTE_WEIGHT[b.route] - ROUTE_WEIGHT[a.route];
    if (routeDelta) return routeDelta;
    const freshnessDelta = timestamp(b.observedAt) - timestamp(a.observedAt);
    if (freshnessDelta) return freshnessDelta;
    const scoreDelta = b.totalScore - a.totalScore;
    if (scoreDelta) return scoreDelta;
    return a.id.localeCompare(b.id);
  });
}

export function loadHunterFeed(db: Database.Database, limit = 250): HunterFeedItem[] {
  const rows = db.prepare(`
    SELECT
      hs.id AS score_id,
      hs.company_id,
      hs.target_id,
      hs.fit_score,
      hs.intent_score,
      hs.buyer_score,
      hs.total_score,
      hs.route,
      hs.outreach_ready,
      hs.reason,
      hs.computed_at,
      c.name AS company_name,
      c.domain,
      c.industry,
      t.full_name AS buyer_name,
      t.title AS buyer_role,
      t.email,
      t.linkedin_url,
      (
        SELECT s.observed_at FROM hunter_signals s
        WHERE s.company_id = hs.company_id
        ORDER BY s.observed_at DESC, s.id ASC LIMIT 1
      ) AS latest_signal_at,
      (
        SELECT s.title FROM hunter_signals s
        WHERE s.company_id = hs.company_id
        ORDER BY s.observed_at DESC, s.id ASC LIMIT 1
      ) AS latest_signal_title,
      (
        SELECT s.evidence_text FROM hunter_signals s
        WHERE s.company_id = hs.company_id
        ORDER BY s.observed_at DESC, s.id ASC LIMIT 1
      ) AS latest_signal_evidence,
      (
        SELECT s.source_url FROM hunter_signals s
        WHERE s.company_id = hs.company_id
        ORDER BY s.observed_at DESC, s.id ASC LIMIT 1
      ) AS latest_signal_url,
      (
        SELECT d.status FROM hunter_message_drafts d
        WHERE d.target_id = hs.target_id
        ORDER BY d.created_at DESC LIMIT 1
      ) AS draft_status
    FROM hunter_scores hs
    JOIN companies c ON c.id = hs.company_id
    LEFT JOIN targets t ON t.id = hs.target_id
    WHERE hs.id = (
      SELECT hs2.id FROM hunter_scores hs2
      WHERE hs2.company_id = hs.company_id
        AND COALESCE(hs2.target_id, '') = COALESCE(hs.target_id, '')
      ORDER BY hs2.computed_at DESC, hs2.created_at DESC
      LIMIT 1
    )
    LIMIT ?
  `).all(Math.max(1, Math.min(1000, limit))) as Array<Record<string, unknown>>;

  return rankHunterFeed(rows.map((row) => ({
    id: String(row.target_id ?? row.company_id),
    scoreId: String(row.score_id),
    companyId: String(row.company_id),
    targetId: row.target_id ? String(row.target_id) : null,
    companyName: String(row.company_name),
    domain: row.domain ? String(row.domain) : null,
    industry: row.industry ? String(row.industry) : null,
    buyerName: row.buyer_name ? String(row.buyer_name) : null,
    buyerRole: row.buyer_role ? String(row.buyer_role) : null,
    email: row.email ? String(row.email) : null,
    linkedinUrl: row.linkedin_url ? String(row.linkedin_url) : null,
    fitScore: Number(row.fit_score),
    intentScore: Number(row.intent_score),
    buyerScore: Number(row.buyer_score),
    totalScore: Number(row.total_score),
    route: String(row.route) as HunterRoute,
    outreachReady: Number(row.outreach_ready) === 1,
    reason: String(row.reason),
    observedAt: row.latest_signal_at ? String(row.latest_signal_at) : String(row.computed_at),
    latestSignalTitle: row.latest_signal_title ? String(row.latest_signal_title) : null,
    latestSignalEvidence: row.latest_signal_evidence ? String(row.latest_signal_evidence) : null,
    latestSignalUrl: row.latest_signal_url ? String(row.latest_signal_url) : null,
    draftStatus: row.draft_status ? String(row.draft_status) : null,
  })));
}
