# Customer Hunter: claim-by-claim verification

- **Repository:** `injamhaqq/foremention-outreach`
- **Branch:** `safety/compliance-guards-20261013` (draft PR #21)
- **Verified on:** 2026-10-14, against PR head `ccee5c1` plus the fixes in this commit
- **Method:** I listed every capability Customer Hunter claims in its UI copy (`pages/hunter/*`, `components/hunter/*`, `components/layout/*`), `README.md`, `docs/superpowers/specs/2026-09-16-foremention-customer-hunter-design.md` ("spec"), `.env.example`, and the descriptions of PRs #1, #2 and #21. I then traced each claim through the code path that would carry it out, and through the tests that cover it.
- **Safety statement:** no email, LinkedIn action or prospect contact happened during this verification. Tests use in-memory SQLite and fake transports only.

Line numbers refer to files on this branch after this commit.

## Verdict key

| Verdict | Meaning |
| --- | --- |
| **Real** | A production code path does what the claim says, and a test covers it. |
| **Partial** | The code exists, but it is narrower, weaker or less automatic than the claim implies. |
| **Missing** | No code carries out the claim, or the safety PR deliberately disabled it. |

## 1. Safety and send-locking claims

| # | Claim (source) | Verdict | Evidence |
| --- | --- | --- | --- |
| S1 | Outbound sending stays locked; nothing goes out automatically (founder requirement, PR #21) | **Real (fixed here)** | Before this commit the only send lock was missing compliance config. That same config is also needed for the public unsubscribe route, so setting it up would have unlocked every send path. New kill switch: `lib/email/compliance.ts:25` `emailSendingEnabled()` (exactly `"true"`), checked first in `lib/email/sender.ts:58`, before compliance, suppression or any SMTP connection. `docker-compose.yml` sets the default to `false`. Tests: `tests/hunter/email-compliance.test.ts` ("sendEmail is locked by default…", "every send path routes through the guarded sender…"). |
| S2 | All four send paths go through one guarded sender (PR #21) | **Real** | The only `nodemailer` transport for sending is in `lib/email/sender.ts`. Callers: `lib/linkedin/runner.ts:952` (sequencer), `pages/api/inbox/reply.ts:34`, `pages/api/targets/[id]/emails.ts:108`, `pages/api/email-accounts/[id]/send-test.ts:31`. `testSmtpConnection` only runs `verify()` and sends nothing. A grep test enforces this. |
| S3 | Email compliance is fail-closed: postal address, signed one-click unsubscribe, RFC 8058 headers (README, PR #21) | **Real** | `lib/email/compliance.ts` (`requireEmailComplianceConfig`, HMAC token at `:104`, headers at `:145`), `lib/email/sender.ts:63-67`. Tests: `email-compliance.test.ts`. |
| S4 | Suppressed or unsubscribed recipients are never emailed (README, spec §18) | **Real** | `lib/email/suppression.ts:25` (address, target or company; an empty address fails closed at `:27`), enforced in `sender.ts:67`. Enrollment also checks it at `lib/hunter/approval.ts:70`. |
| S5 | Public `/api/unsubscribe` records the opt-out and stops email tracks (README) | **Real** | `pages/api/unsubscribe.ts`, `lib/email/unsubscribe-handler.ts` (returns 503 if unconfigured, 400 for a bad token, 405 for a bad method), `proxy.ts` (only this route is allowed through without a login). |
| S6 | Background runners are OFF by default (README, PR #21) | **Real** | `lib/hunter/runner-flags.ts:12`. Gates: `instrumentation.ts:5-6`, `lib/hunter/runner.ts:217`, `lib/linkedin/runner.ts:1009`, `lib/hunter/acquisition-runner.ts:427`, `pages/api/runs/[id]/start.ts:16` (returns 409). Tests: `runner-flags.test.ts`. |
| S7 | LinkedIn automation is hard-disabled with no env override (README, PR #21) | **Real** | `lib/linkedin/automation-disabled.ts:23,36`. Every entry point calls it first: `connect.ts:19`, `message.ts:43`, `pending-invitations.ts:18`, `profile-scrape.ts:270`, `visit.ts:39`, `enrich.ts:53,136`, `li-stats.ts:19`, `scraper.ts:274,363,453`, `session.ts` (all exported session and login functions; `chromium.launch` can only be reached through them), `sync-accepted.ts:52,67`. The sequencer skips LinkedIn steps (`lib/linkedin/runner.ts:509,968`). Tests: `linkedin-disabled.test.ts`. |
| S8 | Human approval is required for every automated send; autopilot cannot approve (README, PR #21) | **Real (strengthened here)** | `lib/hunter/send-guard.ts:22,36`. `evaluateAutopilotDecision` never returns `auto_start` (`lib/hunter/autopilot.ts:45,56`). Autopilot only writes drafts (`autopilot-execution.ts:208-223`). Enrollment needs a human approval (`approval.ts:67`), and the sequencer only sends human-approved drafts (`message-resolver.ts`, `lib/linkedin/runner.ts:831-842`). **Gap fixed here:** `/api/hunter/approve` used to accept `approvedBy` from the request body and accepted calls authenticated only by the internal service secret. It now requires a NextAuth founder session, ignores client-supplied approver names and records `founder:<session identity>` (`pages/api/hunter/approve.ts`). |
| S9 | Template or AI follow-up emails without a human-approved draft are skipped (README) | **Real** | `lib/linkedin/runner.ts:831-842`. After the first touch is delivered, `message-resolver.ts:33` returns nothing, so every later email step is skipped. **Consequence:** the spec's Day 3 / 7 / 12 sequence (§11) does not run. See F11. |
| S10 | The canary is separately armed, hard-forces assisted mode, has hard caps and cannot auto-send (README, PR #2) | **Real** | `pages/api/hunter/canary.ts:16,20,29` (env flag, confirmation phrase, full readiness). `lib/hunter/canary.ts:20-25` (assisted mode, 1 query, 5 results, 2 companies, 2 buyers per company). The caps are applied through `lib/hunter/config.ts:42-54`. It only produces drafts (S8). |
| S11 | A genuine human reply stops follow-up on both email and LinkedIn (README, PR #1) | **Partial** | The stop itself is real: `lib/hunter/replies.ts:154` skips every open track for the target. Tests: `replies.test.ts`. However, replies are detected from email IMAP only (`reply-monitor.ts:11`). LinkedIn reply and acceptance detection is disabled (S7), so a LinkedIn reply can only stop tracks if someone stamps it manually (`reply-monitor.ts:64`). Since LinkedIn tracks never execute, there is no safety impact. README wording corrected. |
| S12 | Unsubscribe, complaint, hard bounce and negative intent create durable suppressions (README, spec §13) | **Partial** | Unsubscribe and negative replies: keyword classifier (`replies.ts:48`) → suppression (`replies.ts:176`). Hard bounce: `reply-monitor.ts:91` reads `targets.email_status='invalid'`. Unsubscribe link: S5. **Complaint:** no automated source exists (no feedback-loop or webhook feed). It is recorded only when someone posts it to `pages/api/hunter/reply.ts`. README wording corrected. |
| S13 | Email requires a verified/valid/deliverable *work* email at decision time and send time (README, PR #2) | **Partial** | Checked at both points: `acquisition-runner.ts` channel health and `lib/linkedin/runner.ts:811`. `contact-verification.ts:1` only checks that a provider status string is present. Hunter.io results with confidence ≥ 0.8 are *labelled* "verified" (`buyer-providers.ts:336`), which is a confidence score, not an SMTP check. There is no free-mail (gmail etc.) work-domain check. README wording corrected. |
| S14 | Automated tests and CI never send real prospect messages (README, PR #1) | **Real** | Every send test injects `createTransport` fakes. CI env (`.github/workflows/customer-hunter-ci.yml`) sets no SMTP, LinkedIn or compliance config, so sends are refused regardless. |

## 2. Discovery, qualification and evidence

| # | Claim (source) | Verdict | Evidence |
| --- | --- | --- | --- |
| D1 | Multi-source discovery (SearXNG and Firecrawl) with a source-run ledger, provenance and dedupe (PR #2) | **Real** | `source-providers.ts:38,81`, `discovery.ts:114,135`, `discovery-store.ts`. Tests: `discovery*.test.ts`, `providers.test.ts`, `searxng-runtime-config.test.ts`. |
| D2 | Crawl4AI company-page enrichment (PR #2) | **Real** | `crawl4ai.ts:27`, wired in `acquisition-runner.ts:377`. Test: `crawl4ai.test.ts`. |
| D3 | Buyer waterfall Hunter → Apollo → Prospeo (→ SearXNG) that stops once buyers have verified emails (PR #2) | **Real** | `buyer-providers.ts:90-127,457-460`. Apollo match sets `reveal_personal_emails=false` and `reveal_phone_number=false` (`:263-264`). Test: `buyer-providers.test.ts`. "Verified" carries the caveat in S13. |
| D4 | Signals are normalized with source URL, dates, expiry and confidence (spec §7, PR #1) | **Real** | `signals.ts:35,64,85-113`. Expiry runs in `runner.ts:123`. Tests: `signals.test.ts`. |
| D5 | Signal engine covers hiring, leadership, funding/expansion/launch and public AI-search activity (spec §7) | **Partial** | `signal-classifier.ts:39-60` uses keyword regexes over search snippets. `leadership_change` (a "strong" signal) fires on a keyword match (`:55`), with no check that the change is recent or relevant. |
| D6 | Foremention-native pain signals (`foremention_gap` / `citation_gap`); mini-audit gap adds up to +20 intent (spec §6–7) | **Missing** | The types exist (`signals.ts`, `qualification.ts`), but no code ever creates these signals. Mini-audit results become research evidence only (`research.ts`). The mini-audit runs after the autopilot decision (`autopilot-execution.ts:157`), so it cannot affect the score. |
| D7 | Qualification scoring: fit 0–40, intent 0–40, buyer 0–20, routing bands, two-signal rule (spec §6, README) | **Real** | `qualification.ts:23-169`, `company-fit.ts`. Tests: `qualification.test.ts`, `company-fit.test.ts`. |
| D8 | Funding and expansion only support a case; they are not stand-alone intent (PR #2) | **Real** | Not in `STRONG_SIGNAL_TYPES` (`qualification.ts:9`). |
| D9 | Personalized factual claims trace back to stored evidence or a bounded mini-audit (README, research UI "Every factual claim stays tied to evidence") | **Partial → Real for the manual path (fixed here)** | The provenance check (`research.ts:171-174`, `drafts.ts:60-61`) only checks that cited IDs exist in the packet. Before this commit, `/api/hunter/research` and `/api/hunter/drafts` built that packet from **client-posted** signals, mini-audit data and evidence text, so a caller could inject made-up "evidence". Both routes now reload target, company and signals from SQLite (`lib/hunter/stored-evidence.ts`) and take only IDs from the client. Tests: `verification-fixes.test.ts`. **Still Partial:** nothing checks that the draft *body* says only what the cited evidence supports. That relies on the model prompt (`drafts.ts:45-52`), or on the deterministic template when no AI is configured. |
| D10 | Research packet: why-now, angle, confidence and unsupported-claim warnings (spec §9) | **Partial** | `research.ts:155-178` produces a summary, why-now, angle and claims when AI is configured. The manual UI calls it with `summarize:false` (`pages/hunter/research.tsx`). No "unsupported-claim warnings" field exists. |

## 3. Mini-audit service boundary

| # | Claim (source) | Verdict | Evidence |
| --- | --- | --- | --- |
| M1 | Private mini-audit accepts only 3–5 questions and is server-to-server only (README, spec §8) | **Real** | Client: `foremention-client.ts:58-59` (3–5 questions, timeout at `:97`, Ed25519 signature headers at `:89`). Server (repo `injamhaqq/foremention`): `app/api/internal/outreach/mini-audit/route.ts` (503 if unconfigured, 401 before any work is done) and `lib/outreach-mini-audit.ts:92-96` (min 3, max 5). Tests: `foremention-client.test.ts`, `mini-audit.test.ts`. |
| M2 | Mini-audits are cached at account level across buyers (PR #2) | **Real** | `mini-audit.ts:30,119-124` (request fingerprint plus lookup of an earlier successful run). |
| M3 | The mini-audit runs before first-touch research (PR #2) | **Partial** | Only in the autopilot path, and only when both an AI provider and the secret are configured (`autopilot-execution.ts:159`). The manual research UI never includes mini-audit evidence. After this commit the manual route also refuses client-posted mini-audit payloads (D9). |

## 4. Drafting, approval and execution

| # | Claim (source) | Verdict | Evidence |
| --- | --- | --- | --- |
| E1 | Evidence-grounded email and LinkedIn first-touch drafts (README, PR #1/#2, UI "Cold email" / "LinkedIn DM") | **Real** | `drafts.ts:37-69` (500-character LinkedIn cap, schema check, evidence IDs). Tests: `drafts.test.ts`. |
| E2 | "Approve & start" / "Approved and enrolled exactly once. Linki now owns sequence execution and limits." (research UI) | **Overstated → corrected here** | Before this commit, approving a **LinkedIn** draft enrolled LinkedIn tracks that the sequencer always skips. Approving an email draft enrolled every track in the workflow. Email delivery is also blocked by S1, S3 and S6. Now LinkedIn approval is "manual send only" and creates no enrollment. Email approval enrolls the email track only (`approve.ts`, `allowedChannels:["email"]`), and the UI copy says what actually happens. |
| E3 | The approved draft is exactly the message sent; exactly-once enrollment and duplicate-send prevention (PR #1/#2, spec §13) | **Real** | `approval.ts:76-86` (existing run profile per workflow), `message-resolver.ts:19-64,66-86` (each delivery stored once per draft and run), `lib/linkedin/runner.ts:846-849`. Tests: `approval.test.ts`, `message-resolver.test.ts`. |
| E4 | Autopilot modes manual / assisted / guarded_auto / full_auto (PR #2, `.env.example`) | **Partial** | All four modes are accepted, but since PR #21 every one of them behaves as "draft and wait for human approval" (`autopilot.ts:45-56`). The cockpit "N auto" counter (`operations.ts:151`) can only show legacy rows. The UI label has been changed to "Autopilot drafts" (`pages/hunter/index.tsx`). |
| E5 | Multichannel campaigns: LinkedIn + email sequences, step builder, A/B pools, InMail, server-side LinkedIn login, Sales Navigator import, Sales Nav enrichment, LinkedIn reply detection, "63% improvement in connection reliability" (README upstream Linki sections, Hunter page subtitle "multichannel cold outreach") | **Missing (disabled)** | Every LinkedIn execution path throws (S7), and follow-up email steps are skipped (S9). The workflow builder UI still exists but cannot execute LinkedIn steps. The "63%" figure is upstream marketing copy with no supporting code or measurement in this repo. **Corrected here:** a README fork-status notice, a global app banner (`components/layout/Layout.tsx`) and new Hunter subtitle copy. |
| E6 | Execution readiness counts authenticated LinkedIn accounts as an outreach channel (readiness banner "Customer acquisition configuration ready") | **Overstated → corrected here** | `readiness.ts` treated a LinkedIn-only setup as an execution channel, and the banner never said sending was locked. Now only verified email accounts count. A separate `sending` block (`email_sending_locked`, `email_compliance_not_configured`, `runners_disabled`, `linkedinAutomation: disabled_manual_only`) appears as "Sending locked: …" on `/hunter`. It is not part of `fullyReady`, so draft-only canaries still work. Tests: `verification-fixes.test.ts`. |
| E7 | Account daily limits, ramp-up and limit auto-reschedule stay authoritative (spec §18, README) | **Real (for email)** | `lib/linkedin/runner.ts` (`enforceSchedule`, last-line daily-limit guard before `sendEmail`). The LinkedIn limits no longer matter (S7). |

## 5. Replies, tasks and pipeline

| # | Claim (source) | Verdict | Evidence |
| --- | --- | --- | --- |
| R1 | Reply classification into positive / question / objection / not_now / referral / OOO / unsubscribe / bounce / complaint / negative (spec §13) | **Partial** | `replies.ts:48-79` is a deterministic keyword classifier (`hunter-deterministic-v1`), not the AI classification in spec §10. Complaints are never auto-classified (S12). Unknown replies default to `question`, which routes to a human. That is the safe default. Tests: `replies.test.ts`. |
| R2 | Positive, question, objection and referral replies become high-priority human sales tasks; NOT_NOW becomes future follow-up (PR #2) | **Real** | `replies.ts:193-225`, `sales-tasks.ts:11,64,84`, `/hunter/tasks`. Tests: `sales-tasks.test.ts`. |
| R3 | OOO reschedules only on a reliable return date (spec §13) | **Partial** | `reply-monitor.ts` always uses received time + 3 days and never parses a return date. |
| R4 | Referral creates or links the referred contact (spec §13) | **Missing** | A referral only creates a human task. No contact is created or linked. |
| R5 | The unified inbox shows classification and next action (spec DoD) | **Partial** | `pages/inbox.tsx:58` shows the `reply_kind` badge. The next action appears only on `/hunter/tasks`. AI classification and backfill are premium `ee/` code, which is absent from this repo. |
| P1 | Opportunity stages identified → … → paid_pilot → customer → expansion; commercial evidence required; no regression (PR #2, README) | **Real** | `opportunities.ts:4-20,112-170` (evidence required at `:124`, no backward moves at `:138`, no skipped stages at `:147`). Tests: `opportunities.test.ts`. |
| P2 | Observed conversion metrics with numerator/denominator counts and no causal claims (PR #1) | **Real** | `opportunities.ts:222-268`. |
| P3 | Learning loop: signal type / persona / score band / angle / channel / mini-audit gap / time-to-contact → conversion (spec §17) | **Missing** | Only overall stage rates exist (`aggregateHunterOutcomeMetrics`). No per-dimension attribution is computed. |

## 6. Operations, cost and deployment

| # | Claim (source) | Verdict | Evidence |
| --- | --- | --- | --- |
| O1 | Cockpit shows observed accounts, signals, buyers, verified contacts, approvals, replies, pipeline, channel health and source failures, with no projected conversions (UI, PR #2) | **Real** | `operations.ts`, `pages/hunter/index.tsx`. Tests: `operations.test.ts`. |
| O2 | The provider usage ledger covers discovery, enrichment, Crawl4AI, AI tokens and mini-audits; unknown prices are never shown as $0 (README, PR #2) | **Partial** | `costs.ts:54-59` keeps known spend separate from unknown. Usage is recorded in the acquisition and autopilot paths (`acquisition-runner.ts:360`). The **manual** research and draft routes call `hunterAiProviderFromEnv()` without a usage reporter, so manual AI calls are not recorded. Apollo enrichment from the Lists UI (`lib/apollo.ts`) is not recorded either. |
| O3 | Production readiness diagnostics report concrete blockers (PR #2, UI banner) | **Real** | `readiness.ts`. Tests: `readiness.test.ts`, extended in `verification-fixes.test.ts`. |
| O4 | Public non-sensitive `/healthz`, a Docker HEALTHCHECK and a cross-deployment persistence witness (PR #2/#5) | **Real** | `pages/healthz.tsx:19`, `Dockerfile:78`, `persistence-readiness.ts:52`. Tests: `healthz-persistence-observability.test.ts`, `persistence-readiness.test.ts`. |
| O5 | Hunter tables are created idempotently (PR #1) | **Real** | `schema.ts` has 20 `CREATE TABLE IF NOT EXISTS hunter_*` statements. |
| O6 | CI builds the image, smoke-tests `/healthz` and runs browser acceptance (README, PR #2) | **Real, but currently red** | `.github/workflows/customer-hunter-ci.yml`. Run `38433680527` on PR #21 failed at **`npm audit --omit=dev --audit-level=critical`**. The causes are new critical advisories against `next` 16.3.5 (range 16.0.0–16.3.7) and `proxy-addr` 2.0.7. The lockfile is identical to `main`, so `main` fails the same way. This PR does not cause it, and fixing it means bumping dependencies outside this safety PR's scope. |

## 7. Fixes added in this commit

1. **Outbound email kill switch** (`OUTREACH_EMAIL_SENDING_ENABLED`, default locked). It sits in `lib/email/compliance.ts` and `lib/email/sender.ts`, and is documented in `docker-compose.yml`, `.env.example` and `README.md`. Compliance config no longer unlocks sending.
2. **Founder-session-only approval** (`pages/api/hunter/approve.ts`). Service-secret calls are rejected with 403. The approver identity comes from the session. LinkedIn drafts are approved for manual sending and never enrolled. Email drafts enroll the email track only.
3. **Stored-evidence-only research and drafts** (`lib/hunter/stored-evidence.ts`, `pages/api/hunter/research.ts`, `pages/api/hunter/drafts.ts`). Client-posted evidence text and mini-audit payloads are no longer accepted.
4. **Readiness honesty** (`lib/hunter/readiness.ts`). LinkedIn no longer counts as an outreach channel. A new `sending` block appears as "Sending locked: …" on `/hunter`.
5. **UI and docs copy corrections.** The Hunter subtitle, the empty state, "Autopilot drafts" in place of "N auto", the research-page approval button and messages, a global LinkedIn-disabled banner, and README fork-status and caveat lines.
6. **Tests:** `tests/hunter/verification-fixes.test.ts` (8 tests), plus 2 new tests and updated fixtures in `tests/hunter/email-compliance.test.ts`.

Local results on this commit (Node 22.23.3): `npm run test:hunter` **176/176 pass**, `npx tsc --noEmit` **0 errors**, CI-scope ESLint plus touched dirs **0 errors** (2 warnings already on `main`), `npm run build` **OK**. I did not run Playwright e2e or Docker locally. The copy changes avoid the strings `tests/e2e/customer-hunter.spec.ts` matches on.

## 8. Open items for the founder (not fixed here)

- **Do not merge to `main` casually.** `.github/workflows/sync-railway-deploy-branch.yml` mirrors `main` to the Railway deployment branch, so a merge deploys to production.
- **CI audit gate:** this needs a separate dependency PR (`next` ≥ 16.3.8 and a patched `proxy-addr`) before any PR here can go green.
- **Follow-up emails:** the spec's Day 3 / 7 / 12 sequence no longer sends (S9). If you want it back, each follow-up needs its own human approval.
- **Draft body fact-checking (D9):** citations are validated, but the wording of the draft body is not.
- **Spec features still missing:** Foremention-native gap signals (D6), referral contact linking (R4), the learning-loop attribution (P3), automated complaint intake (S12), and work-domain or SMTP email verification (S13).
- **Production env:** confirm in Railway that `OUTREACH_EMAIL_SENDING_ENABLED` and `HUNTER_RUNNERS_ENABLED` are unset or `false`. These are read at runtime; this verification did not inspect the live deployment.
