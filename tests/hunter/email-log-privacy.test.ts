import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("email inbox runtime logs do not print prospect email addresses", () => {
  const source = readFileSync("lib/email/inbox.ts", "utf8");
  const logLines = source
    .split("\n")
    .filter((line) => /console\.(log|warn|error)/.test(line))
    .join("\n");

  assert.doesNotMatch(logLines, /target\.email/);
  assert.doesNotMatch(logLines, /\$\{candidate\}/);
  assert.doesNotMatch(logLines, /fromEmail/);
});
