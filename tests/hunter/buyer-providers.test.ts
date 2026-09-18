import assert from "node:assert/strict";
import test from "node:test";
import {
  createApolloBuyerProvider,
  createHunterDomainBuyerProvider,
  createProspeoBuyerProvider,
  runBuyerProviders,
} from "../../lib/hunter/buyer-providers";

test("Apollo buyer provider searches decision makers by company domain", async () => {
  const provider = createApolloBuyerProvider({
    apiKey: "apollo-test",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.match(url.pathname, /mixed_people\/api_search$/);
      assert.equal(url.searchParams.get("q_organization_domains_list[]"), "acme.com");
      return new Response(JSON.stringify({
        people: [{
          id: "p1",
          first_name: "Jane",
          last_name: "Doe",
          name: "Jane Doe",
          title: "Head of SEO",
          linkedin_url: "https://linkedin.com/in/jane",
        }],
      }), { status: 200 });
    },
  });
  const results = await provider.findBuyers({ domain: "acme.com", titles: ["Head of SEO"], limit: 3 });
  assert.equal(results.length, 1);
  assert.equal(results[0].fullName, "Jane Doe");
  assert.equal(results[0].linkedinUrl, "https://linkedin.com/in/jane");
  assert.equal(results[0].sourceName, "apollo");
});

test("Hunter domain provider returns verified work contacts with confidence", async () => {
  const provider = createHunterDomainBuyerProvider({
    apiKey: "hunter-test",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "api.hunter.io");
      assert.equal(url.searchParams.get("domain"), "acme.com");
      return new Response(JSON.stringify({
        data: {
          emails: [{
            value: "jane@acme.com",
            first_name: "Jane",
            last_name: "Doe",
            position: "VP Marketing",
            confidence: 96,
            linkedin: "https://linkedin.com/in/jane",
          }],
        },
      }), { status: 200 });
    },
  });
  const results = await provider.findBuyers({ domain: "acme.com", titles: ["VP Marketing"], limit: 3 });
  assert.equal(results[0].email, "jane@acme.com");
  assert.equal(results[0].emailStatus, "verified");
  assert.equal(results[0].confidence, 0.96);
});

test("Prospeo provider scopes search to company website and buyer titles", async () => {
  const provider = createProspeoBuyerProvider({
    apiKey: "prospeo-test",
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.filters.company.websites.include, ["acme.com"]);
      assert.deepEqual(body.filters.person_job_title.include, ["Head of SEO"]);
      return new Response(JSON.stringify({
        error: false,
        results: [{
          person: {
            person_id: "prospeo-1",
            full_name: "Jane Doe",
            current_job_title: "Head of SEO",
            linkedin_url: "https://linkedin.com/in/jane",
          },
        }],
      }), { status: 200 });
    },
  });
  const results = await provider.findBuyers({ domain: "acme.com", titles: ["Head of SEO"], limit: 3 });
  assert.equal(results[0].providerPersonId, "prospeo-1");
  assert.equal(results[0].sourceName, "prospeo");
});

test("buyer waterfall deduplicates the same person and preserves the best contact data", async () => {
  const first = {
    id: "one",
    findBuyers: async () => [{
      fullName: "Jane Doe", role: "Head of SEO", email: null, emailStatus: null,
      linkedinUrl: "https://linkedin.com/in/jane", sourceName: "one", providerPersonId: null, confidence: 0.7,
    }],
  };
  const second = {
    id: "two",
    findBuyers: async () => [{
      fullName: "Jane Doe", role: "Head of SEO", email: "jane@acme.com", emailStatus: "verified",
      linkedinUrl: "https://linkedin.com/in/jane", sourceName: "two", providerPersonId: "2", confidence: 0.95,
    }],
  };
  const result = await runBuyerProviders([first, second], { domain: "acme.com", titles: ["Head of SEO"], limit: 3 });
  assert.equal(result.buyers.length, 1);
  assert.equal(result.buyers[0].email, "jane@acme.com");
  assert.equal(result.buyers[0].confidence, 0.95);
});
