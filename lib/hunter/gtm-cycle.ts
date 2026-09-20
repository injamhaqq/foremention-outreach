import type Database from "better-sqlite3";
import type { HunterAutopilotMode } from "./autopilot";
import type { HunterBuyerProvider } from "./buyer-providers";
import { runBuyerProviders } from "./buyer-providers";
import { inferHunterCompanyFit } from "./company-fit";
import type { HunterDiscoveryProvider } from "./discovery";
import { normalizeDiscoveryCandidate } from "./discovery";
import { createHunterDiscoveryStore } from "./discovery-store";
import { qualifyHunterCandidate } from "./qualification";
import { createHunterRepository } from "./repository";
import { HUNTER_OPPORTUNITY_STAGES, transitionHunterOpportunity, type HunterOpportunityStage } from "./opportunities";
import { classifyDiscoveryEvidence } from "./signal-classifier";
import { normalizeHunterSignal, signalContribution } from "./signals";

export type HunterGtmCycleConfig = {
  discoveryEnabled: boolean;
  discoveryQueries: string[];
  discoveryIntervalMs: number;
  limitPerQuery: number;
  maxBuyersPerCompany: number;
  autopilotMode: HunterAutopilotMode;
  defaultRunId: string | null;
  crawl4aiUrl: string | null;
  autoCrawlCompany: boolean;
  maxCompaniesPerCycle: number;
};

export type HunterCrawlClient = {
  crawl(domainOrUrl: string): Promise<{ domain: string; url: string; text: string }>;
};

function safeDiscoveryProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const http = message.match(/HTTP\s+(\d{3})/i)?.[1];
  if (http) return `http_${http}`;
  if (/abort|timeout/i.test(message)) return "timed_out";
  if (/fetch failed|network|connect|dns|enotfound|econnrefused|eai_again/i.test(message)) return "fetch_failed";
  return "provider_error";
}

export type HunterDiscoveryCycleOptions = {
  config: HunterGtmCycleConfig;
  discoveryProviders: HunterDiscoveryProvider[];
  buyerProviders: HunterBuyerProvider[];
  crawlClient?: HunterCrawlClient | null;
  now?: Date;
};

function ensureQualifiedOpportunity(
  db: Database.Database,
  companyId: string,
  targetId: string,
) {
  const existing = db.prepare(
    "SELECT stage FROM hunter_opportunities WHERE company_id = ? AND target_id = ? LIMIT 1"
  ).get(companyId, targetId) as { stage: string } | undefined;
  if (!existing) {
    transitionHunterOpportunity(db, {
      companyId,
      targetId,
      toStage: "qualified",
      allowForwardSkip: true,
      nextAction: "Research evidence-backed first touch",
    });
    return;
  }
  if (existing.stage === "identified") {
    transitionHunterOpportunity(db, {
      companyId,
      targetId,
      toStage: "qualified",
      nextAction: "Research evidence-backed first touch",
    });
    return;
  }
  if (!HUNTER_OPPORTUNITY_STAGES.includes(existing.stage as HunterOpportunityStage)) {
    return;
  }
  // A later stage is commercial history. Rediscovery can refresh evidence/score but
  // must never move that opportunity backward.
}

const DEFAULT_BUYER_TITLES = [
  "CMO",
  "Chief Marketing Officer",
  "VP Marketing",
  "VP Growth",
  "Head of SEO",
  "Director of SEO",
  "Head of Organic",
  "Director Organic Growth",
  "Head of Content",
  "Head of Growth",
  "AI Search Lead",
  "GEO Lead",
  "AEO Lead",
];

function classifyCandidateEvidence(
  candidate: { provenance: Array<{ sourceUrl: string; sourceName: string; evidenceText: string }> },
  observedAt: string,
) {
  return candidate.provenance.flatMap((provenance) =>
    classifyDiscoveryEvidence({
      sourceUrl: provenance.sourceUrl,
      sourceName: provenance.sourceName,
      evidenceText: provenance.evidenceText,
      observedAt,
    }).map((signal) => normalizeHunterSignal(signal))
  );
}

export async function runHunterDiscoveryCycle(
  db: Database.Database,
  options: HunterDiscoveryCycleOptions,
) {
  const { config } = options;
  if (!config.discoveryEnabled) {
    return {
      companiesDiscovered: 0,
      buyersDiscovered: 0,
      outreachReady: 0,
      sourceErrors: 0,
      crawlsCompleted: 0,
      crawlErrors: 0,
    };
  }
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const store = createHunterDiscoveryStore(db);
  const repository = createHunterRepository(db);
  const uniqueCompanies = new Set<string>();
  const processedCompanies = new Set<string>();
  let buyersDiscovered = 0;
  let outreachReady = 0;
  let sourceErrors = 0;
  let crawlsCompleted = 0;
  let crawlErrors = 0;

  for (const query of config.discoveryQueries) {
    if (processedCompanies.size >= config.maxCompaniesPerCycle) break;
    for (const provider of options.discoveryProviders) {
      if (processedCompanies.size >= config.maxCompaniesPerCycle) break;
      const sourceRun = store.startSourceRun({ providerId: provider.id, query });
      let rawCandidates;
      try {
        rawCandidates = await provider.search({ query, limit: config.limitPerQuery });
        store.finishSourceRun(sourceRun.id, { status: "success", candidateCount: rawCandidates.length });
      } catch (error) {
        sourceErrors += 1;
        const safeReason = safeDiscoveryProviderError(error);
        console.warn(`[hunter] discovery provider failed provider=${provider.id} reason=${safeReason}`);
        store.finishSourceRun(sourceRun.id, {
          status: "failed",
          candidateCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      for (const raw of rawCandidates.slice(0, config.limitPerQuery)) {
        if (processedCompanies.size >= config.maxCompaniesPerCycle) break;
        let candidate;
        try {
          candidate = normalizeDiscoveryCandidate(raw);
        } catch {
          continue;
        }
        const { companyId } = store.upsertCandidate({ ...candidate, query });
        uniqueCompanies.add(companyId);
        if (processedCompanies.has(companyId)) continue;
        processedCompanies.add(companyId);

        let evidenceText = candidate.provenance.map((item) => item.evidenceText).join(" ");
        let fit = inferHunterCompanyFit({
          companyName: candidate.name,
          domain: candidate.domain,
          evidenceText,
        });
        let normalizedSignals = classifyCandidateEvidence(candidate, nowIso);

        const shouldCrawl = Boolean(
          options.crawlClient
          && config.autoCrawlCompany
          && config.crawl4aiUrl
          && (fit.b2bSoftware || fit.organicMotion || normalizedSignals.length > 0)
        );
        if (shouldCrawl) {
          const crawlRun = store.startSourceRun({ providerId: "crawl4ai", query: candidate.domain });
          try {
            const crawled = await options.crawlClient!.crawl(`https://${candidate.domain}`);
            candidate.provenance.push({
              sourceUrl: crawled.url,
              sourceName: "crawl4ai",
              evidenceText: crawled.text.slice(0, 4_000),
            });
            store.upsertCandidate({ ...candidate, query });
            store.finishSourceRun(crawlRun.id, { status: "success", candidateCount: 1 });
            crawlsCompleted += 1;

            evidenceText = candidate.provenance.map((item) => item.evidenceText).join(" ");
            fit = inferHunterCompanyFit({
              companyName: candidate.name,
              domain: candidate.domain,
              evidenceText,
            });
            normalizedSignals = classifyCandidateEvidence(candidate, nowIso);
          } catch (error) {
            crawlErrors += 1;
            store.finishSourceRun(crawlRun.id, {
              status: "failed",
              candidateCount: 0,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        for (const signal of normalizedSignals) {
          repository.upsertHunterSignal({
            companyId,
            type: signal.type,
            title: signal.title,
            summary: signal.summary,
            sourceUrl: signal.sourceUrl,
            sourceName: signal.sourceName,
            evidenceText: signal.evidenceText,
            observedAt: signal.observedAt,
            publishedAt: signal.publishedAt,
            expiresAt: signal.expiresAt,
            confidence: signal.confidence,
            scoreContribution: signalContribution(signal, now),
          });
        }

        const buyerResult = await runBuyerProviders(options.buyerProviders, {
          domain: candidate.domain,
          titles: DEFAULT_BUYER_TITLES,
          limit: config.maxBuyersPerCompany,
        });

        for (const buyer of buyerResult.buyers) {
          const { targetId } = store.upsertBuyer(companyId, buyer);
          buyersDiscovered += 1;
          const result = qualifyHunterCandidate({
            fit,
            signals: normalizedSignals.map((signal) => ({
              type: signal.type,
              strength: signalContribution(signal, now),
              sourceUrl: signal.sourceUrl,
              observedAt: signal.observedAt,
            })),
            buyer: {
              role: buyer.role,
              hasEmail: Boolean(buyer.email),
              hasLinkedIn: Boolean(buyer.linkedinUrl),
            },
          });
          repository.saveHunterScore({ companyId, targetId, result, computedAt: nowIso });
          if (result.outreachReady) {
            outreachReady += 1;
            ensureQualifiedOpportunity(db, companyId, targetId);
          }
        }
      }
    }
  }

  return {
    companiesDiscovered: uniqueCompanies.size,
    buyersDiscovered,
    outreachReady,
    sourceErrors,
    crawlsCompleted,
    crawlErrors,
  };
}
