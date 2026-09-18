import assert from "node:assert/strict";
import test from "node:test";
import { inferHunterCompanyFit } from "../../lib/hunter/company-fit";

test("B2B SaaS with organic/search language qualifies without requiring every firmographic field", () => {
  const fit = inferHunterCompanyFit({
    companyName: "Acme",
    domain: "acme.com",
    evidenceText: "Acme is a B2B SaaS platform. We are hiring a Head of SEO to scale organic search.",
  });
  assert.equal(fit.b2bSoftware, true);
  assert.equal(fit.organicMotion, true);
  assert.equal(fit.employeeBandFit, false);
  assert.equal(fit.marketFit, false);
});

test("generic unrelated company evidence does not invent B2B software fit", () => {
  const fit = inferHunterCompanyFit({
    companyName: "Example",
    domain: "example.com",
    evidenceText: "A regional manufacturer of steel fasteners.",
  });
  assert.equal(fit.b2bSoftware, false);
});
