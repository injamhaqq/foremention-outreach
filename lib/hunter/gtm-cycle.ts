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

export type HunterDiscoveryCycleOptions = {
  config: HunterGtmCycleConfig;
  discoveryProviders: HunterDiscoveryProvider[];
  buyerProviders: HunterBuyerProvider[];
  now?: Date;
};

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

export async function runHunterDiscoveryCycle(
  db: Database.Database,
  options: HunterDiscoveryCycleOptions,
) {
  const { config } = options;
  if (!config.discoveryEnabled) {
    return { companiesDiscovered: 0, buyersDiscovered: 0, outreachReady: 0, sourceErrors: 0 };
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

        const evidenceText = candidate.provenance.map((item) => item.evidenceText).join(" ");
        const fit = inferHunterCompanyFit({
          companyName: candidate.name,
          domain: candidate.domain,
          evidenceText,
        });

        const normalizedSignals = candidate.provenance.flatMap((provenance) =>
          classifyDiscoveryEvidence({
            sourceUrl: provenance.sourceUrl,
            sourceName: provenance.sourceName,
            evidenceText: provenance.evidenceText,
            observedAt: nowIso,
          }).map((signal) => normalizeHunterSignal(signal))
        );

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
            repository.upsertHunterOpportunity({
              companyId,
              targetId,
              stage: "identified",
              nextAction: "Research evidence-backed first touch",
            });
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
  };
}
