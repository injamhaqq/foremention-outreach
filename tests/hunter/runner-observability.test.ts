import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Hunter runner emits counts-only cycle observability", () => {
  const source = readFileSync("lib/hunter/runner.ts", "utf8");
  assert.match(source, /\[hunter\] cycle summary/);
  assert.match(source, /companiesDiscovered/);
  assert.match(source, /buyersDiscovered/);
  assert.match(source, /outreachReady/);
  assert.match(source, /sourceErrors/);
  assert.match(source, /autopilotTargetsProcessed/);
  assert.doesNotMatch(source, /cycle summary[^\n]*(email|full_name|linkedin|domain)/i);
});
