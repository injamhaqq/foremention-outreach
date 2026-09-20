import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("discovery provider failures log provider id plus a sanitized reason only", () => {
  const source = readFileSync("lib/hunter/gtm-cycle.ts", "utf8");
  assert.match(source, /discovery provider failed provider=\$\{provider\.id\} reason=\$\{safeReason\}/);
  assert.match(source, /return "fetch_failed"/);
  assert.match(source, /return `http_\$\{http\}`/);
  assert.doesNotMatch(source, /discovery provider failed[^\n]*query/i);
  assert.doesNotMatch(source, /discovery provider failed[^\n]*(email|linkedin|domain)/i);
});
