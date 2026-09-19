import assert from "node:assert/strict";
import test from "node:test";
import { hasVerifiedWorkEmail } from "../../lib/hunter/contact-verification";

test("email outreach requires both an address and an explicitly verified status", () => {
  assert.equal(hasVerifiedWorkEmail("jane@acme.com", "verified"), true);
  assert.equal(hasVerifiedWorkEmail("jane@acme.com", "VERIFIED"), true);
  assert.equal(hasVerifiedWorkEmail("jane@acme.com", "valid"), true);
  assert.equal(hasVerifiedWorkEmail("jane@acme.com", "deliverable"), true);
  assert.equal(hasVerifiedWorkEmail("jane@acme.com", null), false);
  assert.equal(hasVerifiedWorkEmail("jane@acme.com", "unverified"), false);
  assert.equal(hasVerifiedWorkEmail("jane@acme.com", "risky"), false);
  assert.equal(hasVerifiedWorkEmail(null, "verified"), false);
});
