import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type { HunterBuyerCandidate } from "./buyer-providers";
import type { HunterDiscoveryProvenance } from "./discovery";

export type PersistedDiscoveryCandidate = {
  name: string;
  domain: string;
  query: string;
  provenance: HunterDiscoveryProvenance[];
};

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function domain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function clean(value: string | null | undefined, max = 2_000) {
  return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function targetKey(buyer: HunterBuyerCandidate) {
  return buyer.linkedinUrl?.trim().toLowerCase()
    || buyer.email?.trim().toLowerCase()
    || `${buyer.fullName.trim().toLowerCase()}|${buyer.role.trim().toLowerCase()}`;
}

export function createHunterDiscoveryStore(db: Database.Database) {
  function upsertCandidate(input: PersistedDiscoveryCandidate) {
    const normalizedDomain = domain(input.domain);
    if (!normalizedDomain || !normalizedDomain.includes(".")) throw new Error("A valid discovery domain is required.");
    const existing = db.prepare("SELECT id, name FROM companies WHERE lower(domain) = lower(?) LIMIT 1")
      .get(normalizedDomain) as { id: string; name: string } | undefined;
    const companyId = existing?.id ?? stableId("company", normalizedDomain);
    if (!existing) {
      db.prepare("INSERT INTO companies (id, name, domain) VALUES (?, ?, ?)")
        .run(companyId, clean(input.name, 300) || normalizedDomain, normalizedDomain);
    } else if ((!existing.name || existing.name === normalizedDomain) && clean(input.name, 300)) {
      db.prepare("UPDATE companies SET name = ? WHERE id = ?").run(clean(input.name, 300), companyId);
    }

    for (const evidence of input.provenance) {
      const sourceUrl = clean(evidence.sourceUrl, 2_000);
      const excerpt = clean(evidence.evidenceText, 4_000);
      const hash = createHash("sha256").update(`${sourceUrl}|${excerpt}`).digest("hex");
      const dedupeKey = `${companyId}|${hash}`;
      db.prepare(`
        INSERT INTO hunter_discovery_evidence (
          id, company_id, dedupe_key, query, source_url, source_name, evidence_text, observed_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(dedupe_key) DO UPDATE SET
          query = excluded.query,
          source_name = excluded.source_name,
          evidence_text = excluded.evidence_text,
          last_seen_at = datetime('now')
      `).run(
        stableId("hde", dedupeKey),
        companyId,
        dedupeKey,
        clean(input.query, 800),
        sourceUrl,
        clean(evidence.sourceName, 120),
        excerpt,
      );
    }
    return { companyId };
  }

  function upsertBuyer(companyId: string, buyer: HunterBuyerCandidate) {
    const key = targetKey(buyer);
    const byLinkedIn = buyer.linkedinUrl
      ? db.prepare("SELECT id FROM targets WHERE lower(linkedin_url) = lower(?) LIMIT 1").get(buyer.linkedinUrl) as { id: string } | undefined
      : undefined;
    const byEmail = !byLinkedIn && buyer.email
      ? db.prepare("SELECT id FROM targets WHERE lower(email) = lower(?) LIMIT 1").get(buyer.email) as { id: string } | undefined
      : undefined;
    const byName = !byLinkedIn && !byEmail
      ? db.prepare("SELECT id FROM targets WHERE company_id = ? AND lower(full_name) = lower(?) LIMIT 1")
          .get(companyId, buyer.fullName) as { id: string } | undefined
      : undefined;
    const targetId = byLinkedIn?.id ?? byEmail?.id ?? byName?.id ?? stableId("target", `${companyId}|${key}`);

    if (!byLinkedIn && !byEmail && !byName) {
      db.prepare(`
        INSERT INTO targets (id, company_id, full_name, title, email, email_status, linkedin_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(targetId, companyId, clean(buyer.fullName, 300), clean(buyer.role, 300), buyer.email, buyer.emailStatus, buyer.linkedinUrl);
    } else {
      db.prepare(`
        UPDATE targets SET
          company_id = COALESCE(company_id, ?),
          full_name = CASE WHEN full_name IS NULL OR trim(full_name) = '' THEN ? ELSE full_name END,
          title = CASE WHEN title IS NULL OR trim(title) = '' THEN ? ELSE title END,
          email = COALESCE(email, ?),
          email_status = COALESCE(email_status, ?),
          linkedin_url = COALESCE(linkedin_url, ?)
        WHERE id = ?
      `).run(companyId, clean(buyer.fullName, 300), clean(buyer.role, 300), buyer.email, buyer.emailStatus, buyer.linkedinUrl, targetId);
    }

    const provenanceKey = `${targetId}|${buyer.sourceName}|${buyer.providerPersonId ?? ""}`;
    db.prepare(`
      INSERT INTO hunter_buyer_provenance (
        id, target_id, company_id, dedupe_key, provider, provider_person_id, confidence, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(dedupe_key) DO UPDATE SET confidence = MAX(confidence, excluded.confidence), last_seen_at = datetime('now')
    `).run(stableId("hbp", provenanceKey), targetId, companyId, provenanceKey, buyer.sourceName, buyer.providerPersonId, buyer.confidence);
    return { targetId };
  }

  function startSourceRun(input: { providerId: string; query: string }) {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO hunter_source_runs (id, provider_id, query, status, candidate_count, started_at)
      VALUES (?, ?, ?, 'running', 0, datetime('now'))
    `).run(id, clean(input.providerId, 120), clean(input.query, 800));
    return { id };
  }

  function finishSourceRun(id: string, input: { status: "success" | "failed"; candidateCount: number; error?: string | null }) {
    db.prepare(`
      UPDATE hunter_source_runs
      SET status = ?, candidate_count = ?, error = ?, finished_at = datetime('now')
      WHERE id = ?
    `).run(input.status, Math.max(0, Math.trunc(input.candidateCount)), clean(input.error ?? "", 2_000) || null, id);
  }

  return { upsertCandidate, upsertBuyer, startSourceRun, finishSourceRun };
}
