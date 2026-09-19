import type Database from "better-sqlite3";

export type HunterPersistenceReadiness = {
  ready: boolean;
  mode:
    | "not_required"
    | "operator_confirmed"
    | "awaiting_cross_deployment_witness"
    | "verified_cross_deployment"
    | "production_unverified";
  reasons: string[];
  deploymentId: string | null;
  previousDeploymentId: string | null;
  verifiedAt: string | null;
};

function value(env: NodeJS.ProcessEnv, key: string) {
  return String(env[key] || "").trim();
}

function truthy(value: string) {
  return /^(1|true|yes|on)$/i.test(value);
}

function ensureStateTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hunter_persistence_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function readState(db: Database.Database, key: string) {
  const row = db.prepare(
    "SELECT value FROM hunter_persistence_state WHERE key = ? LIMIT 1"
  ).get(key) as { value?: string | null } | undefined;
  return String(row?.value || "").trim() || null;
}

function writeState(db: Database.Database, key: string, value: string) {
  db.prepare(`
    INSERT INTO hunter_persistence_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
  `).run(key, value);
}

export function evaluateHunterPersistenceReadiness(
  db: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
): HunterPersistenceReadiness {
  if (truthy(value(env, "HUNTER_PERSISTENT_STORAGE_CONFIRMED"))) {
    return {
      ready: true,
      mode: "operator_confirmed",
      reasons: [],
      deploymentId: value(env, "RAILWAY_DEPLOYMENT_ID") || null,
      previousDeploymentId: null,
      verifiedAt: null,
    };
  }

  const deploymentId = value(env, "RAILWAY_DEPLOYMENT_ID");
  const railwayManaged = Boolean(value(env, "RAILWAY_PROJECT_ID") || deploymentId);
  const production = value(env, "NODE_ENV").toLowerCase() === "production";

  // Local/test development has no meaningful cross-deployment lifecycle to witness.
  if (!production && !railwayManaged) {
    return {
      ready: true,
      mode: "not_required",
      reasons: [],
      deploymentId: null,
      previousDeploymentId: null,
      verifiedAt: null,
    };
  }

  // Generic production hosts can explicitly confirm their persistent mount. Without
  // a platform deployment ID we refuse to infer persistence from a writable path.
  if (!deploymentId) {
    return {
      ready: false,
      mode: "production_unverified",
      reasons: ["persistent_storage_not_verified"],
      deploymentId: null,
      previousDeploymentId: null,
      verifiedAt: null,
    };
  }

  ensureStateTable(db);
  const previousDeploymentId = readState(db, "last_deployment_id");
  const verifiedAt = readState(db, "verified_at");

  if (verifiedAt) {
    writeState(db, "last_deployment_id", deploymentId);
    return {
      ready: true,
      mode: "verified_cross_deployment",
      reasons: [],
      deploymentId,
      previousDeploymentId,
      verifiedAt,
    };
  }

  if (previousDeploymentId && previousDeploymentId !== deploymentId) {
    const witnessedAt = new Date().toISOString();
    const transaction = db.transaction(() => {
      writeState(db, "verified_at", witnessedAt);
      writeState(db, "last_deployment_id", deploymentId);
    });
    transaction();
    return {
      ready: true,
      mode: "verified_cross_deployment",
      reasons: [],
      deploymentId,
      previousDeploymentId,
      verifiedAt: witnessedAt,
    };
  }

  writeState(db, "last_deployment_id", deploymentId);
  return {
    ready: false,
    mode: "awaiting_cross_deployment_witness",
    reasons: ["persistent_storage_has_not_survived_a_deployment_change"],
    deploymentId,
    previousDeploymentId,
    verifiedAt: null,
  };
}
