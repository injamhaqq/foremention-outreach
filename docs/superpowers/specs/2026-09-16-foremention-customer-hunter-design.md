# Foremention Customer Hunter — Design Specification

Date: 2026-09-16
Status: Design for implementation
Primary repository: `injamhaqq/foremention-outreach`
Companion repository: `injamhaqq/foremention`

## 1. Mission

Build a single internal sales operating system for Foremention that continuously turns existing contact data and public market signals into timely, evidence-backed cold outreach across email and LinkedIn.

The system should answer five questions for the founder every day:

1. Which companies plausibly need Foremention?
2. Why might they care now?
3. Who is the right person to contact?
4. What should we say, based on real evidence rather than generic personalization?
5. What happened after outreach, and what should the system learn from it?

The product is internal customer acquisition infrastructure. It is not a public SaaS offering and must not turn into a generic Apollo/Clay/Instantly clone.

## 2. Product principle

Qualification must be deliberately easy enough to support cold outreach.

A prospect is outreach-ready when all three are true:

- **Foremention fit:** the company could reasonably benefit from recommendation/AI-search visibility intelligence;
- **one credible pain or timing signal:** at least one current, public, attributable reason makes outreach timely;
- **reachable buyer:** a relevant decision-maker or champion has an email and/or LinkedIn profile.

A full Foremention audit is not required before first contact. Expensive research happens only after the lead passes this fast gate.

## 3. What remains from Linki

`foremention-outreach` stays a Linki-derived application and keeps the existing execution infrastructure:

- SMTP/IMAP email accounts;
- LinkedIn accounts and session management;
- multichannel workflows;
- per-account daily limits;
- campaign/run state;
- email and LinkedIn reply detection;
- unified inbox;
- contacts and companies;
- Apollo enrichment where configured;
- CSV imports;
- the existing background runner and SQLite persistence.

We extend these systems rather than rebuilding them.

## 4. Architecture decision

### Recommended architecture: modular monolith + one private Foremention service boundary

`foremention-outreach` remains one deployable Next.js/Node application with SQLite. New customer-hunter modules live inside the same process and use the existing global runner.

`foremention` remains the authority for Foremention measurement. It gains a narrowly scoped signed internal endpoint for mini-audits so outreach can request a small 3–5-question diagnostic without duplicating Foremention's measurement semantics.

Data flow:

```text
existing leads / CSV / Linki contacts
              +
public company signals
              ↓
       fast qualification
              ↓
       intent / pain evidence
              ↓
        buyer resolution
              ↓
  Foremention mini-audit (optional)
              ↓
      prospect research brief
              ↓
       cold-message drafts
              ↓
         approval policy
              ↓
     Linki email + LinkedIn
              ↓
      unified reply inbox
              ↓
      stop / classify / route
              ↓
 meeting → design partner → pilot → customer
              ↓
       conversion learning
```

### Why not merge several repositories wholesale

We may reuse ideas, APIs, and patterns from other projects, but we will not blindly copy repositories together.

OpenOutreach is GPLv3. Linki uses the Linki Sustainable Use License. Copying GPLv3 source into this codebase would create licensing/distribution obligations and an unclear combined-license position. Therefore:

- no OpenOutreach source code is copied into `foremention-outreach`;
- useful concepts are reimplemented behind our own interfaces;
- if a future OpenOutreach capability is uniquely valuable, it may run as an optional separate service behind an adapter, preserving license boundaries;
- permissively licensed libraries may be added when they are materially useful and their licenses are retained.

The goal is the strongest product architecture, not the largest pile of merged code.

## 5. Core user experience

The founder should be able to live primarily inside `foremention-outreach`.

Main navigation additions:

- **Buyer Feed** — ranked outreach-ready prospects;
- **Signals** — new public timing/pain evidence;
- **Research** — account and buyer briefs;
- **Approval Queue** — first-touch messages awaiting approval;
- **Opportunities** — replied/meeting/pilot/customer pipeline;
- existing **Campaigns / Workflows / Inbox / Contacts / Settings** remain.

Primary action:

**Find Buyers Now**

It should process existing contacts/companies first rather than requiring a new lead database.

Buyer Feed card:

```text
Acme                           HIGH INTENT
Head of SEO: Jane Doe

Why now
• Hiring Organic Search lead; job text mentions AI Overviews

Foremention pain
• optional mini-audit: 1/5 appearances vs competitor 4/5

Channels
✓ verified work email
✓ LinkedIn

[Research] [Generate DM] [Start Outreach]
```

## 6. Fast qualification model

The system stores scores for prioritization but does not use an excessively strict gate.

### Fit: 0–40

Indicative signals:

- B2B SaaS/software: +15
- 20–1000 employees: +10
- meaningful SEO/content/organic motion: +10
- target-language/market fit: +5

The employee band is intentionally broad. A smaller company can qualify if the timing signal is strong.

### Intent / pain: 0–40

Examples:

- hiring for GEO/AEO/AI Search: +20
- explicit public AI-search initiative/discussion: +15
- Foremention mini-audit shows material competitor gap: up to +20
- hiring SEO/organic/content leadership: +15
- content/SEO expansion: +10
- new CMO/VP Marketing: +8
- recent funding/expansion: +8

Only evidence with a source URL and observation/publication date contributes to this score.

### Buyer accessibility: 0–20

- CMO / VP Marketing / VP Growth / Head SEO / Head Organic: +20
- Head Content / SEO Manager / GEO/AEO lead: +15
- less-direct but relevant marketing buyer: +10

### Routing

- 70–100: high intent; prioritize immediately
- 55–69: good cold prospect; contact
- 40–54: contact when the message angle is concrete
- below 40: monitor/skip

### Two-signal rule

The score never overrides this simpler rule:

**one fit signal + one credible pain/timing signal + right buyer = outreach-ready.**

## 7. Signal engine

V1 signal families:

1. **Jobs / hiring**
   - SEO, Organic, Content, GEO, AEO, AI Search, Generative Search;
   - inspect description text, not only titles.
2. **Leadership changes**
   - CMO, VP Marketing, VP Growth, Head/Director SEO/Organic/Content.
3. **Funding / expansion / launches**
   - supporting timing signal, never treated as purchase intent alone.
4. **Public AI-search activity**
   - ChatGPT, Gemini, Perplexity, AI Overviews, GEO/AEO, zero-click, LLM visibility/citations.
5. **Foremention-native pain**
   - weak appearance frequency;
   - competitor advantage;
   - missing high-intent questions;
   - citation/source gaps.

Every signal record stores:

- account/company id;
- signal family and subtype;
- title and normalized summary;
- source URL;
- source name;
- evidence excerpt or structured evidence;
- observed_at;
- published_at when known;
- expires_at;
- confidence;
- score contribution.

Stale/expired signals cannot retain full weight.

## 8. Foremention mini-audit service

The main `foremention` repository gains a private service-to-service API dedicated to outreach diagnostics.

Proposed contract:

`POST /api/internal/outreach/mini-audit`

Authentication:

- HMAC or high-entropy service token supplied from server-side environment only;
- reject missing/invalid auth before any expensive work;
- endpoint is not browser-callable and never exposes customer workspace data.

Input:

```json
{
  "brand": "Acme",
  "domain": "acme.com",
  "category": "employee engagement software",
  "competitors": ["Competitor A", "Competitor B"],
  "questions": ["..."],
  "maxQuestions": 5
}
```

Output:

```json
{
  "observedAt": "ISO-8601",
  "provider": "...",
  "model": "...",
  "questions": [
    {
      "question": "...",
      "targetAppeared": true,
      "competitorAppearances": ["Competitor A"],
      "citations": ["https://..."],
      "evidence": "bounded evidence object"
    }
  ],
  "summary": {
    "targetAppearances": 1,
    "questionCount": 5,
    "strongestCompetitorAppearances": 4
  },
  "methodology": "..."
}
```

The endpoint reuses Foremention's existing provider, evidence, accounting, and comparability primitives. Outreach must not independently recreate Foremention measurement logic.

Mini-audit execution is optional. A strong external trigger can qualify an account before an audit.

## 9. Research engine

After a prospect qualifies, produce a concise commercial research brief, not lifestyle personalization.

Required fields:

- company/domain/category;
- buyer name/title;
- why the company fits;
- public signal(s) with source/date;
- why now;
- Foremention mini-audit summary if available;
- relevant competitor context;
- buyer-role relevance;
- suggested outreach angle;
- confidence and unsupported-claim warnings.

Research must never invent facts. Every factual personalization claim must be traceable either to a stored signal/evidence item or to a Foremention mini-audit result.

## 10. AI provider abstraction

AI-assisted classification/research/drafting uses a provider interface rather than one hard-coded vendor.

Initial targets:

- OpenAI-compatible API;
- Groq;
- OpenRouter;
- optional local Ollama later.

Structured outputs use Zod validation. Invalid model output is rejected or retried; it cannot directly mutate campaign/send state.

AI responsibilities:

- normalize public signal text;
- classify relevance to Foremention;
- summarize account evidence;
- propose concise outreach angles;
- draft messages from approved evidence;
- classify inbound replies.

AI must not decide suppression, bypass daily limits, or fabricate personalization.

## 11. Cold email and LinkedIn messaging

Cold outreach is a first-class product workflow.

### Email default sequence

- Day 0: evidence/timing-based first touch
- Day 3: useful competitor/source observation
- Day 7: one additional Foremention finding or relevant question
- Day 12: close loop

Default maximum unanswered email touches: 4.

### LinkedIn default sequence

- optional profile visit;
- connection request or direct message, depending on account state;
- after acceptance: short evidence/timing-based DM;
- one useful follow-up;
- stop.

Default maximum unanswered LinkedIn messages after connection: 2.

### Message standard

Messages must be short and conversation-oriented. The first message should normally contain:

- one real reason for relevance;
- optionally one concrete Foremention observation;
- a low-friction CTA such as offering to send the breakdown.

No generic fake compliments, invented metrics, or unsupported customer claims.

## 12. Approval and autonomy

V1 uses **Assisted mode**:

- discovery, signal detection, qualification, research, and drafting run automatically;
- first touch requires human approval;
- approved follow-ups may run automatically;
- any genuine human reply stops all automated follow-ups for that contact across channels.

Future autonomy levels may be added only after real conversion/quality evidence exists.

## 13. Unified inbox and reply routing

Extend the existing Linki inbox with normalized reply classes:

- positive;
- question;
- objection;
- not_now;
- referral;
- out_of_office;
- unsubscribe;
- bounce;
- complaint;
- other.

Hard business rules enforced in code:

- any genuine human reply → stop active automated follow-up;
- unsubscribe → permanent suppression;
- complaint → permanent suppression and immediate stop;
- hard bounce → suppress that address;
- referral → create/link referred contact without auto-sending until qualified;
- OOO → reschedule only when an explicit return date is reliable;
- duplicate target/contact → never create duplicate first-touch sends.

AI classification may suggest a class; deterministic rules own suppression and sequence stops.

## 14. Data model

Prefer focused new tables instead of adding dozens of columns to `targets`.

New tables in `foremention-outreach`:

- `hunter_account_profiles`
- `hunter_signals`
- `hunter_signal_evidence`
- `hunter_scores`
- `hunter_research_reports`
- `hunter_mini_audits`
- `hunter_message_drafts`
- `hunter_approvals`
- `hunter_reply_classifications`
- `hunter_suppressions`
- `hunter_opportunities`
- `hunter_outcomes`
- `hunter_cost_events`

Existing `targets`, `companies`, `runs`, `workflow_steps`, email accounts, LinkedIn accounts, and inbox records remain the canonical execution entities.

All migrations must be idempotent because Linki currently initializes/migrates SQLite at runtime.

## 15. Background jobs

Extend the existing global runner; do not add n8n as a required runtime dependency in V1.

Jobs:

- signal refresh;
- score refresh;
- mini-audit queue;
- research queue;
- draft generation queue;
- stale evidence expiry;
- opportunity/outcome aggregation.

Each job is idempotent and lock-safe. A restart cannot duplicate a signal, audit, message draft, campaign enrollment, or first-touch send.

n8n may later be connected through webhooks for auxiliary workflows, but the core system must work without another orchestrator.

## 16. Opportunity pipeline

Internal commercial stages:

`identified → contacted → replied → interested → meeting_booked → discovery → design_partner → pilot_proposed → pilot_active → paid_customer → lost`

A record does not become `paid_customer` without verified commercial evidence.

The opportunity view should show:

- account;
- buyer;
- triggering evidence;
- last touch/reply;
- next action with due date;
- current stage;
- attributed campaign/message angle;
- Foremention mini-audit link/reference;
- outcome.

## 17. Learning loop

The system records outcomes so heuristic scores can eventually be replaced by evidence.

Measure:

- signal type → reply rate;
- signal type → meeting rate;
- signal type → paid pilot/customer;
- persona → reply/meeting/customer;
- score band → conversion;
- message angle → reply/meeting;
- channel sequence → conversion;
- mini-audit gap size → conversion;
- time from trigger to contact → conversion.

Do not claim causality from low sample sizes. Show counts next to rates.

## 18. Safety, deliverability, and platform controls

Required deterministic controls:

- SMTP/IMAP credentials remain encrypted using existing Linki secret handling;
- existing account-level daily limits remain authoritative;
- email ramp-up remains supported;
- no send to suppressed/unsubscribed/complaint contacts;
- no factual personalized claim without stored evidence;
- no automatic first touch in V1;
- no hidden bypass around LinkedIn account limits;
- no automatic re-enrollment after a reply;
- sending must be auditable by account, contact, campaign, and message.

LinkedIn automation remains technically riskier than standard email transport. The product should expose conservative per-account limits and never market or implement an "undetectable" guarantee.

## 19. Testing strategy

### Unit tests

- qualification score and two-signal rule;
- signal expiry/weighting;
- deterministic suppression rules;
- reply-class routing;
- duplicate-send prevention;
- AI structured-output validators;
- mini-audit request signing/verification;
- opportunity stage transitions.

### Integration tests

- SQLite migration from an existing Linki database;
- existing campaign workflows remain functional;
- reply stops both email and LinkedIn tracks;
- approved draft creates exactly one enrollment/send path;
- Foremention mini-audit client handles auth, timeout, provider failure, and partial evidence;
- suppression wins over scheduled send.

### End-to-end acceptance

Using synthetic contacts only:

1. seed a company/contact;
2. add a public signal;
3. qualify;
4. generate research;
5. generate draft;
6. approve;
7. create campaign enrollment without sending to a real external person;
8. inject a synthetic reply;
9. verify automation stops;
10. verify opportunity state and learning event update.

Production verification must not send cold outreach to a real person without explicit approval.

## 20. Delivery sequence

The implementation should be delivered in reviewable increments on `feature/foremention-customer-hunter`:

1. data model + qualification + signal evidence;
2. Buyer Feed UI + API;
3. research/AI provider abstraction;
4. approval/draft system;
5. integration with Linki workflow execution and inbox stop rules;
6. opportunity pipeline + analytics;
7. private Foremention mini-audit API + outreach client;
8. end-to-end hardening and docs.

The final result is one coherent internal application, not a collection of disconnected scripts.

## 21. Definition of done

The feature is ready for real first-touch use when all of the following are true:

- existing email and LinkedIn accounts still function through Linki;
- an existing contact/company can become outreach-ready from one fit signal + one evidence-backed pain/timing signal + a buyer;
- the Buyer Feed explains *why now* with source/date;
- research and message drafts contain no unsupported factual claims;
- first-touch approval works;
- approved prospects can enter combined email/LinkedIn workflows;
- a real reply deterministically stops automated follow-up;
- unsubscribe/complaint/bounce suppression is enforced;
- the unified inbox shows classification and next action;
- opportunity stages can reach design partner / pilot / paid customer without manufacturing evidence;
- mini-audits reuse Foremention measurement logic through the private service boundary;
- tests cover the critical failure and duplicate-send paths;
- no copied GPL source has been merged into the Linki-derived codebase.
