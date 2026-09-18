import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("docker compose ships Foremention Outreach code rather than upstream Linki image", () => {
  const compose = readFileSync(resolve(process.cwd(), "docker-compose.yml"), "utf8");
  assert.match(compose, /build:\s*\n\s*context:\s*\./);
  assert.doesNotMatch(compose, /moaljumaa\/linki/i);
  assert.match(compose, /LINKI_DB_PATH:\s*\/data\/linki\.db/);
});
