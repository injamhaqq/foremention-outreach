import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LINKEDIN_AUTOMATION_DISABLED_MESSAGE,
  LinkedInAutomationDisabledError,
} from "../../lib/linkedin/automation-disabled.ts";
import { sendConnectionRequest } from "../../lib/linkedin/connect.ts";
import { sendMessage } from "../../lib/linkedin/message.ts";
import { scrapePendingInvitationVanityNames } from "../../lib/linkedin/pending-invitations.ts";
import { scrapeProfile } from "../../lib/linkedin/profile-scrape.ts";
import { visitProfile } from "../../lib/linkedin/visit.ts";
import { scrapeLinkedInStats } from "../../lib/linkedin/li-stats.ts";
import { scrapeNavigatorList, scrapeNavigatorUrl, scrapeSavedSearch } from "../../lib/linkedin/scraper.ts";

assert.equal(LINKEDIN_AUTOMATION_DISABLED_MESSAGE, "LinkedIn automation disabled: draft only, founder sends manually");

// A fake Playwright page/context that records any attempt to touch the network.
function spyBrowser() {
  const calls: string[] = [];
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      calls.push(String(prop));
      return new Proxy(() => undefined, handler);
    },
    apply() {
      calls.push("call");
      return new Proxy(() => undefined, handler);
    },
  };
  return { calls, page: new Proxy({}, handler) as never };
}

function isDisabled(error: unknown) {
  return error instanceof LinkedInAutomationDisabledError
    && error.message.startsWith(LINKEDIN_AUTOMATION_DISABLED_MESSAGE);
}

const actions: Array<[string, (page: never) => Promise<unknown>]> = [
  ["connect", (page) => sendConnectionRequest(page, "https://www.linkedin.com/in/jane")],
  ["message", (page) => sendMessage(page, "Jane", "hi", "https://www.linkedin.com/in/jane", null)],
  ["pending invitations", (page) => scrapePendingInvitationVanityNames(page)],
  ["profile scrape", (ctx) => scrapeProfile(ctx, { sales_nav_url: "https://www.linkedin.com/sales/lead/x", linkedin_url: null })],
  ["visit", (page) => visitProfile(page, "https://www.linkedin.com/in/jane")],
  ["stats scrape", (page) => scrapeLinkedInStats(page)],
  ["navigator list scrape", (ctx) => scrapeNavigatorList(ctx, "https://www.linkedin.com/sales/lists/people/1")],
  ["saved search scrape", (ctx) => scrapeSavedSearch(ctx, "https://www.linkedin.com/sales/search/people?savedSearchId=1")],
  ["navigator url scrape", (ctx) => scrapeNavigatorUrl(ctx, "https://www.linkedin.com/sales/search/people")],
];

for (const [name, run] of actions) {
  test(`LinkedIn ${name} is hard-disabled and never touches the browser`, async () => {
    const { calls, page } = spyBrowser();
    await assert.rejects(run(page), isDisabled);
    assert.deepEqual(calls, []);
  });
}

test("session launch/login, enrichment and accepted-sync entry points are hard-disabled", () => {
  const checks: Record<string, string[]> = {
    "lib/linkedin/session.ts": ["getSessionContext", "getSessionPage", "authenticateAccount", "startHeadlessLogin", "submitLoginChallenge", "awaitLoginApproval"],
    "lib/linkedin/enrich.ts": ["enrichProfile", "enrichList"],
    "lib/linkedin/sync-accepted.ts": ["syncAcceptedConnections"],
  };
  for (const [file, fns] of Object.entries(checks)) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /HARD-DISABLED/, file);
    for (const fn of fns) {
      const body = source.slice(source.indexOf(`function ${fn}(`));
      const open = body.indexOf("{\n");
      const firstStatement = body.slice(open + 2).trimStart().split("\n")[0];
      assert.match(firstStatement, /^linkedInAutomationDisabled\("/, `${file}:${fn}`);
    }
  }
  const sync = readFileSync("lib/linkedin/sync-accepted.ts", "utf8");
  assert.match(sync, /if \(LINKEDIN_AUTOMATION_HARD_DISABLED\) return false;/);
});

test("sequencer skips every non-email (LinkedIn) step instead of automating it", () => {
  const source = readFileSync("lib/linkedin/runner.ts", "utf8");
  const guard = source.indexOf('if (LINKEDIN_AUTOMATION_HARD_DISABLED && step.step_type !== "email") {');
  assert.ok(guard > 0);
  assert.ok(guard < source.indexOf('if (step.step_type === "visit") {'));
  assert.ok(guard < source.indexOf('} else if (step.step_type === "connect") {'));
  assert.ok(guard < source.indexOf('} else if (step.step_type === "message") {'));
  assert.ok(guard < source.indexOf('} else if (step.step_type === "sales_inmail") {'));
});
