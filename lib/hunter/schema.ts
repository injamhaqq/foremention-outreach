import type Database from "better-sqlite3";

export const HUNTER_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS hunter_account_profiles (
    company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    category TEXT,
    fit_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hunter_signals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_name TEXT,
    evidence_text TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    published_at TEXT,
    expires_at TEXT,
    confidence REAL NOT NULL DEFAULT 0,
    score_contribution INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hunter_signals_company_observed
    ON hunter_signals(company_id, observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_hunter_signals_target_observed
    ON hunter_signals(target_id, observed_at DESC);

  CREATE TABLE IF NOT EXISTS hunter_signal_evidence (
    id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL REFERENCES hunter_signals(id) ON DELETE CASCADE,
    evidence_hash TEXT NOT NULL,
    source_url TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(signal_id, evidence_hash)
  );

  CREATE TABLE IF NOT EXISTS hunter_scores (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    target_id TEXT REFERENCES targets(id) ON DELETE CASCADE,
    fit_score INTEGER NOT NULL,
    intent_score INTEGER NOT NULL,
    buyer_score INTEGER NOT NULL,
    total_score INTEGER NOT NULL,
    route TEXT NOT NULL,
    outreach_ready INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL,
    score_json TEXT NOT NULL,
    computed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hunter_scores_company_computed
    ON hunter_scores(company_id, computed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_hunter_scores_target_computed
    ON hunter_scores(target_id, computed_at DESC);

  CREATE TABLE IF NOT EXISTS hunter_research_reports (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    report_json TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hunter_research_target_created
    ON hunter_research_reports(target_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS hunter_mini_audits (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
    request_fingerprint TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    observed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hunter_message_drafts (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK(channel IN ('email', 'linkedin')),
    subject TEXT,
    body TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    first_touch_fingerprint TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'rejected', 'enrolled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hunter_drafts_target_created
    ON hunter_message_drafts(target_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS hunter_approvals (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL UNIQUE REFERENCES hunter_message_drafts(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('pending', 'approved', 'rejected')),
    approved_by TEXT,
    approved_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hunter_reply_classifications (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    source_reply_id TEXT,
    channel TEXT NOT NULL CHECK(channel IN ('email', 'linkedin')),
    classification TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    classifier TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hunter_reply_target_created
    ON hunter_reply_classifications(target_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS hunter_suppressions (
    id TEXT PRIMARY KEY,
    target_id TEXT REFERENCES targets(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    dedupe_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    value TEXT,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hunter_suppressions_target
    ON hunter_suppressions(target_id, kind);
  CREATE INDEX IF NOT EXISTS idx_hunter_suppressions_company
    ON hunter_suppressions(company_id, kind);

  CREATE TABLE IF NOT EXISTS hunter_opportunities (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    stage TEXT NOT NULL,
    next_action TEXT,
    next_action_due_at TEXT,
    commercial_evidence_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hunter_opportunities_stage
    ON hunter_opportunities(stage, updated_at DESC);

  CREATE TABLE IF NOT EXISTS hunter_outcomes (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL REFERENCES hunter_opportunities(id) ON DELETE CASCADE,
    outcome_type TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hunter_cost_events (
    id TEXT PRIMARY KEY,
    company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    amount_usd REAL NOT NULL DEFAULT 0,
    units REAL NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export function ensureHunterSchema(db: Database.Database) {
  db.exec(HUNTER_SCHEMA_SQL);
}
