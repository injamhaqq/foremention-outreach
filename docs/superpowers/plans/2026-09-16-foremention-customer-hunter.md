# Foremention Customer Hunter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Linki-derived `foremention-outreach` app into Foremention's internal buyer-intent, research, cold email, LinkedIn DM, reply-routing, and opportunity system while preserving Linki's execution infrastructure.

**Architecture:** Keep `foremention-outreach` as a modular Next.js/Node monolith with SQLite and the existing Linki runner. Add focused Hunter domain modules and tables, reuse existing contacts/companies/workflows/inbox, and call `injamhaqq/foremention` through one signed private mini-audit endpoint rather than duplicating Foremention measurement logic.

**Tech Stack:** Next.js 16 Pages Router, React 19, TypeScript, better-sqlite3, Zod, Node 22 built-in test runner with type stripping, existing Linki SMTP/IMAP + LinkedIn runner, Foremention service-to-service HTTP.

**Spec:** `docs/superpowers/specs/2026-09-16-foremention-customer-hunter-design.md`

## Global Constraints

- Work only on `feature/foremention-customer-hunter` until final review.
- Keep qualification deliberately easy: one fit signal + one credible pain/timing signal + one reachable buyer is outreach-ready.
- First-touch cold outreach requires human approval in V1.
- Any genuine human reply stops automated follow-up across both email and LinkedIn for that contact.
- Unsubscribe, complaint, and hard bounce are deterministic suppressions and cannot be overridden by AI.
- Every personalized factual claim must be traceable to stored evidence or a Foremention mini-audit.
- Existing Linki account-level limits, email ramp-up, SMTP/IMAP handling, LinkedIn session handling, workflow execution, and inbox behavior remain authoritative.
- Do not copy GPLv3 OpenOutreach source into this Linki-derived repository; reimplement concepts behind our own interfaces or integrate as a separate service later.
- No real external cold message may be sent during automated tests or verification.
- Node.js floor remains 22+.

---

## File Structure

New domain modules live under `lib/hunter/` and stay small by responsibility:

- `lib/hunter/types.ts` — shared Hunter domain types and enums.
- `lib/hunter/qualification.ts` — fast-fit, intent, buyer-accessibility, and two-signal routing.
- `lib/hunter/signals.ts` — signal normalization, freshness, expiry, and contribution logic.
- `lib/hunter/repository.ts` — SQLite persistence for Hunter records.
- `lib/hunter/research.ts` — evidence-backed research brief construction.
- `lib/hunter/ai.ts` — provider abstraction + Zod schemas for AI-assisted research/drafting/classification.
- `lib/hunter/drafts.ts` — cold email/LinkedIn draft assembly and claim provenance.
- `lib/hunter/approval.ts` — assisted-mode approval state and enrollment guard.
- `lib/hunter/replies.ts` — deterministic reply-routing and suppression decisions.
- `lib/hunter/foremention-client.ts` — signed mini-audit client.
- `lib/hunter/opportunities.ts` — commercial stage transitions and outcome metrics.
- `lib/hunter/runner.ts` — idempotent queue orchestration plugged into Linki instrumentation.

New UI/API surfaces:

- `pages/hunter/index.tsx` — Buyer Feed / Find Buyers Now.
- `pages/hunter/signals.tsx` — signal evidence view.
- `pages/hunter/research.tsx` — research/approval queue.
- `pages/hunter/opportunities.tsx` — opportunity pipeline.
- `pages/api/hunter/feed.ts` — buyer-feed data.
- `pages/api/hunter/qualify.ts` — scoring/recompute endpoint.
- `pages/api/hunter/research.ts` — research generation.
- `pages/api/hunter/drafts.ts` — message draft generation.
- `pages/api/hunter/approve.ts` — first-touch approval/enrollment.
- `pages/api/hunter/signals.ts` — signal ingestion/read endpoint.
- `pages/api/hunter/opportunities.ts` — pipeline updates.

Foremention companion change:

- `app/api/internal/outreach/mini-audit/route.ts` — private signed mini-audit endpoint.
- `lib/outreach-mini-audit-auth.ts` — request authentication helper.
- `lib/outreach-mini-audit.ts` — bounded 3–5-question diagnostic adapter over existing measurement primitives.

Tests:

- `tests/hunter/qualification.test.ts`
- `tests/hunter/signals.test.ts`
- `tests/hunter/repository.test.ts`
- `tests/hunter/replies.test.ts`
- `tests/hunter/approval.test.ts`
- `tests/hunter/opportunities.test.ts`
- `tests/hunter/foremention-client.test.ts`
- `tests/hunter/acceptance.test.ts`

---

### Task 1: Establish Hunter Domain Contract and Test Harness

**Files:**
- Modify: `package.json`
- Create: `.github/workflows/customer-hunter-ci.yml`
- Create: `lib/hunter/types.ts`
- Create: `lib/hunter/qualification.ts`
- Create: `tests/hunter/qualification.test.ts`

**Interfaces:**
- Produces `HunterQualificationInput`, `HunterQualificationResult`, `HunterRoute`, and `qualifyHunterCandidate(input)` for all later tasks.
- No database dependency.

- [ ] **Step 1: Add the failing qualification test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { qualifyHunterCandidate } from "../../lib/hunter/qualification.ts";

test("two-signal rule makes a reachable buyer outreach-ready without a high numeric score", () => {
  const result = qualifyHunterCandidate({
    fit: { b2bSoftware: true, employeeBandFit: false, organicMotion: false, marketFit: false },
    signals: [{ type: "ai_search_hiring", strength: 20, sourceUrl: "https://example.com/job", observedAt: "2026-09-16T00:00:00.000Z" }],
    buyer: { role: "Head of SEO", hasEmail: true, hasLinkedIn: true },
  });
  assert.equal(result.outreachReady, true);
  assert.equal(result.reason, "TWO_SIGNAL_RULE");
});

test("candidate without credible timing or pain signal is not outreach-ready", () => {
  const result = qualifyHunterCandidate({
    fit: { b2bSoftware: true, employeeBandFit: true, organicMotion: true, marketFit: true },
    signals: [],
    buyer: { role: "CMO", hasEmail: true, hasLinkedIn: true },
  });
  assert.equal(result.outreachReady, false);
  assert.equal(result.route, "monitor");
});
```

- [ ] **Step 2: Add Node 22 test script and CI, then run the test to confirm RED**

`package.json` script:

```json
"test:hunter": "node --experimental-strip-types --test tests/hunter/*.test.ts"
```

CI commands:

```yaml
- run: npm ci
- run: npm run test:hunter
- run: npm run lint
- run: npm run build
```

Expected RED: import/definition failure because `lib/hunter/qualification.ts` does not exist yet.

- [ ] **Step 3: Implement minimal domain types and qualification logic**

`qualifyHunterCandidate` must calculate:

```ts
fitScore: number;          // 0..40
intentScore: number;       // 0..40
buyerScore: number;        // 0..20
totalScore: number;        // 0..100
outreachReady: boolean;
route: "priority" | "good_cold" | "cold_fit" | "monitor";
reason: "TWO_SIGNAL_RULE" | "SCORE_ROUTE" | "MISSING_SIGNAL" | "MISSING_BUYER";
```

Scoring must match the approved spec and must never require 70+ if the two-signal rule is satisfied.

- [ ] **Step 4: Run Hunter tests, lint, and build; confirm GREEN**

Expected: Hunter tests pass; lint/build remain green.

- [ ] **Step 5: Commit**

```bash
git add package.json .github/workflows/customer-hunter-ci.yml lib/hunter/types.ts lib/hunter/qualification.ts tests/hunter/qualification.test.ts
git commit -m "feat: add customer hunter qualification core"
```

---

### Task 2: Add Idempotent Hunter Persistence

**Files:**
- Modify: `lib/db.ts`
- Create: `lib/hunter/repository.ts`
- Create: `tests/hunter/repository.test.ts`

**Interfaces:**
- Consumes: `HunterQualificationResult`.
- Produces repository functions `upsertHunterSignal`, `saveHunterScore`, `saveHunterResearchReport`, `saveHunterDraft`, `setHunterApproval`, `upsertHunterSuppression`, `upsertHunterOpportunity`, and read helpers for Buyer Feed.

- [ ] **Step 1: Write a failing migration/repository test** that opens a temporary SQLite DB, initializes the Linki schema, inserts a company/target, upserts the same signal twice, and asserts one signal row remains.
- [ ] **Step 2: Run test; expected RED** because Hunter tables/repository do not exist.
- [ ] **Step 3: Add idempotent `CREATE TABLE IF NOT EXISTS` migrations** for the twelve Hunter tables from the design spec plus indexes on `(company_id, observed_at)`, `(target_id, created_at)`, suppression lookup keys, and opportunity stage.
- [ ] **Step 4: Implement repository functions with deterministic dedupe keys**: normalized source URL + signal type + company id for signals; target id + channel + first-touch fingerprint for drafts/approvals.
- [ ] **Step 5: Run repository test + full Hunter tests; expected GREEN.**
- [ ] **Step 6: Commit** with `feat: persist customer hunter evidence and pipeline`.

---

### Task 3: Build Signal Normalization and Freshness

**Files:**
- Create: `lib/hunter/signals.ts`
- Create: `tests/hunter/signals.test.ts`
- Create: `pages/api/hunter/signals.ts`

**Interfaces:**
- Produces `normalizeSignal(input)`, `signalContribution(signal, now)`, and authenticated internal signal-ingestion API.

- [ ] **Step 1: Write failing tests** proving (a) a current AI-search hiring signal contributes full weight, (b) an expired signal contributes zero, and (c) funding alone does not satisfy the two-signal rule as a strong pain signal.
- [ ] **Step 2: Run tests; expected RED.**
- [ ] **Step 3: Implement typed signal families:** `ai_search_hiring`, `seo_hiring`, `public_ai_search`, `leadership_change`, `funding`, `expansion`, `launch`, `foremention_gap`, `citation_gap`.
- [ ] **Step 4: Add API validation with Zod**; require source URL, observed date, company/target reference, and reject unsupported signal types.
- [ ] **Step 5: Run tests/lint/build; expected GREEN.**
- [ ] **Step 6: Commit** with `feat: add buyer intent signal engine`.

---

### Task 4: Add Foremention Private Mini-Audit Boundary

**Files in `injamhaqq/foremention`:**
- Create: `lib/outreach-mini-audit-auth.ts`
- Create: `lib/outreach-mini-audit.ts`
- Create: `app/api/internal/outreach/mini-audit/route.ts`
- Create: `tests/outreach-mini-audit-auth.test.mjs`

**Files in `injamhaqq/foremention-outreach`:**
- Create: `lib/hunter/foremention-client.ts`
- Create: `tests/hunter/foremention-client.test.ts`

**Interfaces:**
- `POST /api/internal/outreach/mini-audit` accepts maximum five questions and returns bounded observation evidence.
- `requestForementionMiniAudit(input)` is server-only and never called directly from browser code.

- [ ] **Step 1: Write failing auth tests** covering valid signature/token, missing auth, invalid auth, and over-five-question rejection.
- [ ] **Step 2: Run tests; expected RED.**
- [ ] **Step 3: Implement private auth helper** using a server-only high-entropy token or HMAC secret and constant-time comparison.
- [ ] **Step 4: Implement mini-audit adapter** by reusing Foremention's existing measurement/provider/evidence primitives; no customer workspace data is exposed.
- [ ] **Step 5: Write failing outreach-client tests** for success, 401, timeout, and partial-provider failure.
- [ ] **Step 6: Implement the outreach client** with bounded timeout and no browser exposure.
- [ ] **Step 7: Run both repositories' relevant tests/builds; expected GREEN.**
- [ ] **Step 8: Commit separately in each repository.**

---

### Task 5: Build Evidence-Backed Research and AI Abstraction

**Files:**
- Create: `lib/hunter/ai.ts`
- Create: `lib/hunter/research.ts`
- Create: `tests/hunter/research.test.ts`
- Create: `pages/api/hunter/research.ts`

**Interfaces:**
- `buildResearchBrief({ target, company, signals, miniAudit })` returns a deterministic evidence packet.
- `generateResearchSummary(packet, provider)` may summarize but cannot introduce unsupported factual claims.

- [ ] **Step 1: Write failing test** that supplies one hiring signal and one mini-audit result and asserts every emitted claim carries a provenance reference.
- [ ] **Step 2: Run test; expected RED.**
- [ ] **Step 3: Implement deterministic research packet builder** before AI summarization.
- [ ] **Step 4: Implement provider interface** for OpenAI-compatible/Groq/OpenRouter configuration with Zod-validated structured outputs.
- [ ] **Step 5: Reject model claims not represented in supplied provenance ids.**
- [ ] **Step 6: Run tests/lint/build; expected GREEN.**
- [ ] **Step 7: Commit** with `feat: add evidence backed prospect research`.

---

### Task 6: Build Cold Email and LinkedIn Drafts + Assisted Approval

**Files:**
- Create: `lib/hunter/drafts.ts`
- Create: `lib/hunter/approval.ts`
- Create: `tests/hunter/approval.test.ts`
- Create: `pages/api/hunter/drafts.ts`
- Create: `pages/api/hunter/approve.ts`

**Interfaces:**
- `generateHunterDraft` returns channel-specific copy plus evidence ids.
- `approveHunterDraft` is the only V1 path that may enroll a first touch.

- [ ] **Step 1: Write failing tests** proving an unapproved first touch cannot enroll, approved draft enrolls exactly once, and a suppressed contact can never enroll.
- [ ] **Step 2: Run tests; expected RED.**
- [ ] **Step 3: Implement concise default messaging contracts** for email and LinkedIn using only stored evidence.
- [ ] **Step 4: Implement approval guard** and deterministic first-touch fingerprint to prevent duplicates.
- [ ] **Step 5: Integrate with existing Linki workflow/run creation instead of a second sender.**
- [ ] **Step 6: Run tests/lint/build; expected GREEN.**
- [ ] **Step 7: Commit** with `feat: add assisted cold outreach approval`.

---

### Task 7: Make Reply Stop and Suppression Cross-Channel

**Files:**
- Create: `lib/hunter/replies.ts`
- Create: `tests/hunter/replies.test.ts`
- Modify: existing email reply dispatcher/classifier modules identified during implementation.
- Modify: existing LinkedIn reply-sync/runner modules identified during implementation.

**Interfaces:**
- `routeHunterReply(reply)` returns deterministic `stopAutomation`, `suppression`, `nextAction`, and normalized reply class.

- [ ] **Step 1: Write failing tests** for positive/question/objection/not-now/referral/OOO/unsubscribe/bounce/complaint.
- [ ] **Step 2: Add a failing integration test** showing one human reply stops both active tracks for a target.
- [ ] **Step 3: Run tests; expected RED.**
- [ ] **Step 4: Implement deterministic routing**; AI may classify ambiguous semantic intent but cannot override unsubscribe/complaint/bounce or the global stop rule.
- [ ] **Step 5: Wire into existing Linki email and LinkedIn reply handling.**
- [ ] **Step 6: Run tests/lint/build; expected GREEN.**
- [ ] **Step 7: Commit** with `feat: stop multichannel automation on replies`.

---

### Task 8: Build Buyer Feed and Hunter Navigation

**Files:**
- Modify: `components/layout/Sidebar.tsx`
- Create: `pages/hunter/index.tsx`
- Create: `pages/hunter/signals.tsx`
- Create: `pages/hunter/research.tsx`
- Create: `pages/api/hunter/feed.ts`
- Create: Hunter UI components under `components/hunter/`.

**Interfaces:**
- Buyer Feed reads repository data only; it does not send messages directly.
- Primary actions call Research/Draft/Approval APIs.

- [ ] **Step 1: Produce and approve a visual concept using the frontend-app-builder workflow** that preserves Linki's existing design language and adds only the required Buyer Feed surfaces.
- [ ] **Step 2: Write failing API/feed behavior tests** for ordering: priority > good_cold > cold_fit > monitor and freshness tie-breaking.
- [ ] **Step 3: Implement feed API and UI** with Find Buyers Now, evidence snippets, channel availability, research, generate DM, and approval actions.
- [ ] **Step 4: Add sidebar Hunter navigation** without removing existing Linki pages.
- [ ] **Step 5: Browser-test responsive states and compare implementation to the approved concept.**
- [ ] **Step 6: Run tests/lint/build; expected GREEN.**
- [ ] **Step 7: Commit** with `feat: add foremention buyer feed`.

---

### Task 9: Add Opportunities and Outcome Learning

**Files:**
- Create: `lib/hunter/opportunities.ts`
- Create: `tests/hunter/opportunities.test.ts`
- Create: `pages/hunter/opportunities.tsx`
- Create: `pages/api/hunter/opportunities.ts`

**Interfaces:**
- Stage order: `identified → contacted → replied → interested → meeting_booked → discovery → design_partner → pilot_proposed → pilot_active → paid_customer → lost`.

- [ ] **Step 1: Write failing stage-transition tests** including rejection of `paid_customer` without commercial evidence.
- [ ] **Step 2: Run tests; expected RED.**
- [ ] **Step 3: Implement transition rules and next-action due dates.**
- [ ] **Step 4: Implement aggregate metrics with numerator/denominator counts** for signal/persona/score/message/channel conversion views; never label correlation as causation.
- [ ] **Step 5: Add opportunity board UI.**
- [ ] **Step 6: Run tests/lint/build; expected GREEN.**
- [ ] **Step 7: Commit** with `feat: add hunter opportunity learning loop`.

---

### Task 10: Runner, End-to-End Acceptance, and Production Handoff

**Files:**
- Modify: `instrumentation.ts`
- Create: `lib/hunter/runner.ts`
- Create: `tests/hunter/acceptance.test.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- `ensureHunterRunnerStarted()` is idempotent and started only in Node runtime alongside Linki's existing runner.

- [ ] **Step 1: Write failing acceptance test** that seeds only synthetic data, creates a signal, qualifies, creates research/draft, approves without external send, injects a synthetic reply, and verifies automation stop + opportunity update.
- [ ] **Step 2: Run acceptance test; expected RED.**
- [ ] **Step 3: Implement idempotent Hunter runner queues** for signal refresh, score refresh, mini-audit, research, draft generation, expiry, and aggregation.
- [ ] **Step 4: Add environment documentation** for Foremention service URL/token and optional AI providers.
- [ ] **Step 5: Run `npm run test:hunter`, `npm run lint`, and `npm run build`; expected GREEN.**
- [ ] **Step 6: Open final PR with architecture summary, test evidence, migration notes, and explicit statement that verification did not message real prospects.**
- [ ] **Step 7: Use verification-before-completion and finishing-a-development-branch before merge.**
