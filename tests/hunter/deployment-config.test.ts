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


test("SQLite disaster recovery is opt-in, pinned, and shares the persistent data directory", () => {
  const compose = readFileSync(resolve(process.cwd(), "docker-compose.yml"), "utf8");
  const config = readFileSync(resolve(process.cwd(), "ops/litestream-r2.yml.example"), "utf8");

  assert.match(compose, /sqlite-backup:/);
  assert.match(compose, /profiles:\s*\["backup"\]/);
  assert.match(compose, /litestream\/litestream:0\.5\.17/);
  assert.match(compose, /\.\/data:\/data/);
  assert.match(config, /path:\s*\/data\/linki\.db/);
  assert.match(config, /endpoint:\s*\$\{LITESTREAM_S3_ENDPOINT\}/);
  assert.match(config, /region:\s*auto/);
});
