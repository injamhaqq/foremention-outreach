import assert from "node:assert/strict";
import test from "node:test";
import {
  createApolloBuyerProvider,
  createHunterDomainBuyerProvider,
  createProspeoBuyerProvider,
  runBuyerProviders,
} from "../../lib/hunter/buyer-providers";

test("Apollo buyer provider searches decision makers then enriches only selected people", async () => {
  const calls: string[] = [];
  const provider = createApolloBuyerProvider({
    apiKey: "apollo-test",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (/mixed_people\/api_search$/.test(url.pathname)) {
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
      }

      assert.match(url.pathname, /people\/match$/);
      assert.equal(url.searchParams.get("id"), "p1");
      assert.equal(url.searchParams.get("reveal_personal_emails"), "false");
      assert.equal(url.searchParams.get("reveal_phone_number"), "false");
      return new Response(JSON.stringify({
        person: {
          id: "p1",
          name: "Jane Doe",
          title: "Head of SEO",
          email: "jane@acme.com",
          email_status: "verified",
          linkedin_url: "https://linkedin.com/in/jane",
        },
      }), { status: 200 });
    },
  });

  const results = await provider.findBuyers({ domain: "acme.com", titles: ["Head of SEO"], limit: 3 });
  assert.deepEqual(calls, ["/api/v1/mixed_people/api_search", "/api/v1/people/match"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].fullName, "Jane Doe");
  assert.equal(results[0].email, "jane@acme.com");
  assert.equal(results[0].emailStatus, "verified");
  assert.equal(results[0].linkedinUrl, "https://linkedin.com/in/jane");
  assert.equal(results[0].sourceName, "apollo");
});

test("Apollo keeps a discovered buyer reachable on LinkedIn if enrichment has no email", async () => {
  const provider = createApolloBuyerProvider({
    apiKey: "apollo-test",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (/mixed_people\/api_search$/.test(url.pathname)) {
        return new Response(JSON.stringify({
          people: [{
            id: "p1",
            name: "Jane Doe",
            title: "Head of SEO",
            linkedin_url: "https://linkedin.com/in/jane",
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ person: { id: "p1" } }), { status: 200 });
    },
  });

  const results = await provider.findBuyers({ domain: "acme.com", titles: ["Head of SEO"], limit: 1 });
  assert.equal(results[0].email, null);
  assert.equal(results[0].linkedinUrl, "https://linkedin.com/in/jane");
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

test("Prospeo searches by company and title then enriches only selected person ids", async () => {
  const calls: string[] = [];
  const provider = createProspeoBuyerProvider({
    apiKey: "prospeo-test",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      const body = JSON.parse(String(init?.body));

      if (url.pathname === "/search-person") {
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
      }

      assert.equal(url.pathname, "/enrich-person");
      assert.equal(body.only_verified_email, true);
      assert.deepEqual(body.data, { person_id: "prospeo-1" });
      return new Response(JSON.stringify({
        error: false,
        person: {
          person_id: "prospeo-1",
          full_name: "Jane Doe",
          current_job_title: "Head of SEO",
          linkedin_url: "https://linkedin.com/in/jane",
          email: { email: "jane@acme.com", status: "VERIFIED" },
        },
      }), { status: 200 });
    },
  });

  const results = await provider.findBuyers({ domain: "acme.com", titles: ["Head of SEO"], limit: 3 });
  assert.deepEqual(calls, ["/search-person", "/enrich-person"]);
  assert.equal(results[0].providerPersonId, "prospeo-1");
  assert.equal(results[0].sourceName, "prospeo");
  assert.equal(results[0].email, "jane@acme.com");
  assert.equal(results[0].emailStatus, "verified");
});

test("Prospeo keeps a search result available for LinkedIn when enrichment misses", async () => {
  const provider = createProspeoBuyerProvider({
    apiKey: "prospeo-test",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/search-person") {
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
      }
      return new Response(JSON.stringify({ error: true, error_code: "NO_MATCH" }), { status: 404 });
    },
  });

  const results = await provider.findBuyers({ domain: "acme.com", titles: ["Head of SEO"], limit: 1 });
  assert.equal(results[0].email, null);
  assert.equal(results[0].linkedinUrl, "https://linkedin.com/in/jane");
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
