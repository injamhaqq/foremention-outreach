import type Database from "better-sqlite3";
import { getDb } from "../db";
import { ensureHunterSchema } from "./schema";
import { processPendingHunterEmailReplies, processStampedHunterLinkedInReplies, syncHunterBounceSuppressions } from "./reply-monitor";
import { qualifyHunterCandidate } from "./qualification";
import { createHunterRepository } from "./repository";
import { HUNTER_OPPORTUNITY_STAGES, transitionHunterOpportunity, type HunterOpportunityStage } from "./opportunities";
import type { HunterSignalInput, HunterSignalType } from "./types";

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;

function stageIndex(stage: HunterOpportunityStage) {
  return HUNTER_OPPORTUNITY_STAGES.indexOf(stage);
}

function targetFit(input: { industry: string | null; location: string | null; title: string | null; signalTypes: string[] }) {
  const industry = (input.industry || "").toLowerCase();
  const location = (input.location || "").toLowerCase();
  const title = (input.title || "").toLowerCase();
  return {
    b2bSoftware: /software|saas|technology|internet|cloud|platform/.test(industry),
    employeeBandFit: false,
    organicMotion: /seo|organic|content|growth|marketing/.test(title) || input.signalTypes.some((type) => /seo|ai_search|public_ai_search|foremention_gap|citation_gap/.test(type)),
    marketFit: /united states|\bus\b|united kingdom|\buk\b|canada|australia/.test(location),
  };
}

function refreshQualificationScores(db: Database.Database) {
  const repository = createHunterRepository(db);
  const candidates = db.prepare(`
    SELECT DISTINCT
      t.id AS target_id,
      t.company_id,
      t.title,
      t.email,
      t.linkedin_url,
      c.industry,
      c.location
    FROM targets t
    JOIN companies c ON c.id = t.company_id
    JOIN hunter_signals s ON s.company_id = t.company_id
    WHERE t.company_id IS NOT NULL
  `).all() as Array<{
    target_id: string;
    company_id: string;
    title: string | null;
    email: string | null;
    linkedin_url: string | null;
    industry: string | null;
    location: string | null;
  }>;

  let scored = 0;
  for (const candidate of candidates) {
    const signalRows = db.prepare(`
      SELECT type, score_contribution, source_url, observed_at, expires_at
      FROM hunter_signals
      WHERE company_id = ?
      ORDER BY observed_at DESC
    `).all(candidate.company_id) as Array<{
      type: HunterSignalType;
      score_contribution: number;
      source_url: string;
      observed_at: string;
      expires_at: string | null;
    }>;
    const now = Date.now();
    const signals: HunterSignalInput[] = signalRows
      .filter((signal) => !signal.expires_at || Date.parse(signal.expires_at) > now)
      .map((signal) => ({
        type: signal.type,
        strength: Number(signal.score_contribution),
        sourceUrl: signal.source_url,
        observedAt: signal.observed_at,
      }));
    const result = qualifyHunterCandidate({
      fit: targetFit({
        industry: candidate.industry,
        location: candidate.location,
        title: candidate.title,
        signalTypes: signals.map((signal) => signal.type),
      }),
      signals,
      buyer: candidate.title || candidate.email || candidate.linkedin_url
        ? { role: candidate.title || "Buyer", hasEmail: Boolean(candidate.email), hasLinkedIn: Boolean(candidate.linkedin_url) }
        : null,
    });

    const latest = db.prepare(`
      SELECT score_json FROM hunter_scores
      WHERE company_id = ? AND target_id = ?
      ORDER BY computed_at DESC, created_at DESC LIMIT 1
    `).get(candidate.company_id, candidate.target_id) as { score_json: string } | undefined;
    if (!latest || latest.score_json !== JSON.stringify(result)) {
      repository.saveHunterScore({ companyId: candidate.company_id, targetId: candidate.target_id, result });
      scored += 1;
    }

    if (result.outreachReady) {
      const existing = db.prepare("SELECT stage FROM hunter_opportunities WHERE company_id = ? AND target_id = ? LIMIT 1")
        .get(candidate.company_id, candidate.target_id) as { stage: HunterOpportunityStage } | undefined;
      if (!existing) transitionHunterOpportunity(db, { companyId: candidate.company_id, targetId: candidate.target_id, toStage: "identified" });
    }
  }
  return scored;
}

function expireSignals(db: Database.Database) {
  const result = db.prepare(`
    UPDATE hunter_signals
    SET score_contribution = 0, updated_at = datetime('now')
    WHERE expires_at IS NOT NULL
      AND datetime(expires_at) <= datetime('now')
      AND score_contribution != 0
  `).run();
  return result.changes;
}

function promoteReplyOutcomes(db: Database.Database) {
  const rows = db.prepare(`
    SELECT h.target_id, h.classification, t.company_id, MAX(h.created_at) AS latest_at
    FROM hunter_reply_classifications h
    JOIN targets t ON t.id = h.target_id
    WHERE t.company_id IS NOT NULL
    GROUP BY h.target_id
  `).all() as Array<{ target_id: string; classification: string; company_id: string; latest_at: string }>;

  let promoted = 0;
  for (const row of rows) {
    let desired: HunterOpportunityStage | null = null;
    if (row.classification === "positive") desired = "interested";
    else if (["question", "objection", "not_now", "referral"].includes(row.classification)) desired = "replied";
    else if (["unsubscribe", "bounce", "complaint", "negative"].includes(row.classification)) desired = "lost";
    if (!desired) continue;

    const existing = db.prepare("SELECT stage FROM hunter_opportunities WHERE company_id = ? AND target_id = ? LIMIT 1")
      .get(row.company_id, row.target_id) as { stage: HunterOpportunityStage } | undefined;
    if (existing && desired !== "lost" && stageIndex(existing.stage) >= stageIndex(desired)) continue;
    if (existing?.stage === "lost" && desired !== "lost") continue;

    transitionHunterOpportunity(db, {
      companyId: row.company_id,
      targetId: row.target_id,
      toStage: desired,
      allowForwardSkip: true,
      nextAction: desired === "interested"
        ? "Respond personally and book a meeting"
        : desired === "replied"
          ? "Review the reply and respond personally"
          : "Do not continue automated outreach",
      nextActionDueAt: desired === "lost" ? null : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    promoted += 1;
  }
  return promoted;
}

export async function runHunterMaintenanceCycle(db: Database.Database = getDb()) {
  ensureHunterSchema(db);
  const expiredSignals = expireSignals(db);
  const qualificationScoresRefreshed = refreshQualificationScores(db);

  let emailRepliesProcessed = 0;
  let linkedinRepliesProcessed = 0;
  let bounceSuppressionsProcessed = 0;
  try { emailRepliesProcessed = processPendingHunterEmailReplies(db); } catch (error) { console.warn("[hunter] email reply processing failed:", error); }
  try { linkedinRepliesProcessed = processStampedHunterLinkedInReplies(db); } catch (error) { console.warn("[hunter] LinkedIn reply processing failed:", error); }
  try { bounceSuppressionsProcessed = syncHunterBounceSuppressions(db); } catch (error) { console.warn("[hunter] bounce suppression sync failed:", error); }
  const opportunitiesPromoted = promoteReplyOutcomes(db);

  return {
    expiredSignals,
    qualificationScoresRefreshed,
    emailRepliesProcessed,
    linkedinRepliesProcessed,
    bounceSuppressionsProcessed,
    opportunitiesPromoted,
  };
}

type HunterGlobal = typeof globalThis & {
  __forementionHunterRunnerStarted?: boolean;
  __forementionHunterTimer?: ReturnType<typeof setInterval>;
};

export function ensureHunterRunnerStarted() {
  const holder = globalThis as HunterGlobal;
  if (holder.__forementionHunterRunnerStarted) return;
  holder.__forementionHunterRunnerStarted = true;

  const execute = () => {
    void runHunterMaintenanceCycle().catch((error) => console.error("[hunter] maintenance cycle failed:", error));
  };
  execute();
  const configured = Number(process.env.HUNTER_RUNNER_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  const interval = Number.isFinite(configured) ? Math.max(30_000, Math.min(configured, 60 * 60 * 1000)) : DEFAULT_INTERVAL_MS;
  holder.__forementionHunterTimer = setInterval(execute, interval);
  holder.__forementionHunterTimer.unref?.();
  console.log(`[hunter] Customer Hunter runner started (${interval}ms interval)`);
}
