import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("healthz exposes only safe persistence readiness metadata", () => {
  const source = fs.readFileSync("pages/healthz.tsx", "utf8");
  assert.match(source, /evaluateHunterPersistenceReadiness\(db\)/);
  assert.match(source, /Persistence · \{persistenceReady \? "ready" : persistenceMode\}/);
  assert.doesNotMatch(source, /previousDeploymentId/);
  assert.doesNotMatch(source, /verifiedAt/);
});
