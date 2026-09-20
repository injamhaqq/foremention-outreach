import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("SearXNG runtime image enables JSON search output", () => {
  const dockerfile = readFileSync("infra/searxng/Dockerfile", "utf8");
  const settings = readFileSync("infra/searxng/settings.yml", "utf8");

  assert.match(dockerfile, /FROM searxng\/searxng:/);
  assert.match(dockerfile, /COPY --chown=977:977 settings\.yml \/etc\/searxng\/settings\.yml/);
  assert.match(settings, /formats:\s*\n\s*- html\s*\n\s*- json/);
  assert.match(settings, /limiter:\s*false/);
});
