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


test("Railway volume startup repairs /data ownership then drops privileges to node", () => {
  const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
  const entrypoint = readFileSync(resolve(process.cwd(), "scripts/docker-entrypoint.sh"), "utf8");

  assert.match(dockerfile, /\bgosu\b/);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/foremention-entrypoint"\]/);
  assert.match(dockerfile, /USER root/);
  assert.match(entrypoint, /chown node:node \/data/);
  assert.match(entrypoint, /exec gosu node "\$@"/);
});


test("production health prefers Railway commit provenance over the Docker dev placeholder", () => {
  const healthPage = readFileSync(resolve(process.cwd(), "pages/healthz.tsx"), "utf8");
  assert.match(healthPage, /appVersion && appVersion !== "dev"/);
  assert.match(healthPage, /process\.env\.RAILWAY_GIT_COMMIT_SHA\s*\|\|\s*appVersion\s*\|\|\s*"dev"/);
});
