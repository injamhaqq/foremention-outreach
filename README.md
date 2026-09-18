<p align="center">
  <img src="public/logo_linki.png" alt="Linki" width="56" />
</p>

<h1 align="center">Linki</h1>
<p align="center">Open-source AI SDR for B2B outreach. LinkedIn sequences, cold email, and lead enrichment — self-hosted, no per-seat pricing.</p>

<p align="center">
  <a href="https://opsily.com/hosting/linki?utm_source=github&utm_medium=readme&utm_campaign=linki">
    <img src="public/deploy-with-opsily.svg" alt="Deploy with Opsily" height="36" />
  </a>
  &nbsp;
  <a href="https://discord.gg/8VPeFDJMn">
    <img src="https://img.shields.io/badge/Discord-Join%20our%20community-5865F2?logo=discord&logoColor=white" alt="Join our Discord" height="36" />
  </a>
</p>

---

<p align="center">
  <strong>▶ Full demo &nbsp;|&nbsp;</strong>
  <a href="https://youtu.be/S6n4RHULq3E">https://youtu.be/S6n4RHULq3E</a>
</p>
<p align="center">
  <a href="https://youtu.be/S6n4RHULq3E">
    <img src="https://img.youtube.com/vi/S6n4RHULq3E/maxresdefault.jpg" alt="Click to watch the full demo on YouTube" width="720" />
  </a>
</p>

---

## What is Linki

Linki is an open-source AI SDR built for B2B founders and sales teams who want full control over their outreach. You build multichannel campaigns — LinkedIn sequences, cold email, or both — enrich your leads, and run everything on your own server. Your data never leaves your machine.

No SaaS middleman. No per-seat pricing. No black box.

---

## Foremention Customer Hunter

This fork adds **Foremention Customer Hunter**, an internal evidence-backed buyer-intent and assisted-outreach layer on top of Linki's existing execution infrastructure.

The operating flow is:

`signal → qualification → evidence research → Foremention mini-audit → draft → policy/approval gate → Linki execution → reply routing → commercial outcome learning`

Customer Hunter surfaces are available at:

- `/hunter` — Buyer Feed ranked by route and evidence freshness.
- `/hunter/signals` — attributable signal evidence and freshness.
- `/hunter/research` — research, email/LinkedIn draft generation, and first-touch approval.
- `/hunter/opportunities` — commercial pipeline and observed conversion metrics.
- `/hunter/tasks` — high-priority human reply, follow-up, call, and manual-review work.

### Safety and evidence boundaries

- **Assisted mode** is the production launch default and requires human approval for first touch. Guarded/full-auto modes must be selected explicitly and still honor evidence, suppression, verified-email, reply-stop, account-limit, and channel-health gates.
- The production canary is separately armed, hard-forces assisted mode, limits discovery to one query / five results / two companies / two buyers per company, and cannot auto-send first touches.
- Any genuine human reply stops automated follow-up across both email and LinkedIn for that contact.
- Unsubscribe, complaint, hard bounce, and negative intent create durable suppressions that AI cannot override.
- Personalized factual claims must trace back to stored evidence or a bounded Foremention mini-audit.
- The Foremention private mini-audit accepts only 3–5 questions and is server-to-server only.
- Email execution requires a verified/valid/deliverable work-email state at both decision time and send time.
- Provider usage is recorded separately from known monetary cost; unknown provider pricing is never presented as zero-dollar spend.
- Automated tests and CI use synthetic fixtures and do **not** send real external prospect messages.
- `paid_pilot`, `customer`, and `expansion` transitions require explicit commercial evidence.

### Customer Hunter environment

Copy `.env.example` and configure the Foremention service boundary plus one supported AI provider:

```env
FOREMENTION_OUTREACH_URL=https://foremention.com
FOREMENTION_OUTREACH_SECRET=

HUNTER_AI_PROVIDER=groq
HUNTER_AI_BASE_URL=https://api.groq.com/openai/v1
HUNTER_AI_API_KEY=
HUNTER_AI_MODEL=

HUNTER_RUNNER_INTERVAL_MS=120000
```

Groq, OpenRouter, OpenAI, or another OpenAI-compatible endpoint can be used through the documented environment variables in `.env.example`.

Verification commands:

```bash
npm run test:hunter
npx eslint lib/hunter tests/hunter tests/e2e playwright.config.ts pages/hunter pages/api/hunter components/hunter
npm run build
docker build --build-arg APP_VERSION="$(git rev-parse HEAD)" -t foremention-outreach:local .
npm run test:e2e:hunter
```

The CI gate also starts the built production container and requires `/healthz` to pass before browser acceptance.

---

## Features

### 📬 Multichannel Campaigns

- **LinkedIn + email in one campaign**: run LinkedIn actions (visit, connect, message) and email actions in parallel within a single campaign sequence
- **Flexible step builder**: chain visit → connect → delay → message → cold email in any order, with configurable delays between steps
- **Per-lead state tracking**: see exactly where every lead is across both channels, with a live pipeline view broken down by step and status
- **A/B template pools**: assign multiple message templates to a step and rotate them automatically

### 🔐 Server-Side LinkedIn Login

- **Headless server-side authentication**: log in to LinkedIn directly on your server — no cookie-pasting — so the session is born under the exact browser fingerprint the automation runs with
- **Handles LinkedIn's real challenges**: email/SMS codes **and** mobile-app device approval, plus LinkedIn's dynamic React login fields
- **Longer, more stable sessions**: a pinned browser fingerprint keeps sessions alive far longer, enabling more complex and more frequent LinkedIn activity without forced logouts
- **Captures the full session**: including the httpOnly Sales Navigator seat cookie that cookie-paste can't reach — so Sales Nav import and enrichment just work

### 🔍 Data & Enrichment

- **Sales Navigator import**: paste a list URL and Linki pulls in all leads with name, title, company, location, seniority, and LinkedIn URL
- **CSV import**: bring in leads from anywhere else — a downloadable template covers LinkedIn URL, Sales Nav URL, email, and every contact field; each row just needs a LinkedIn URL and/or an email, so LinkedIn-only, email-only, and mixed lists all work
- **Batched & scheduled imports**: large lists split across days automatically under a global daily cap, with human-like pacing so imports never look like a bot burst
- **Apollo.io enrichment**: connect your Apollo API key and enrich any list with verified email addresses, company data, and seniority in one click
- **Sales Nav profile enrichment**: pull richer profile data (headline, positions) for better targeting, gathered at runner time to stay under the radar
- **Company model**: enriched company records (description, headcount, industry, location) linked from contacts; never duplicated across leads
- **Contact detail pages**: full profile view with outreach history, enrichment status, and all campaign activity per contact

### 📥 Unified Inbox

- **Aggregated reply feed**: all email replies from active campaigns surface in one inbox regardless of which email account received them
- **Email + LinkedIn reply detection**: the runner passively monitors both email and LinkedIn conversations and flags contacts who replied
- **Reply filtering**: only shows contacts who actually replied; noise-free by design
- **Inline reply composer**: read the full email thread and reply without leaving Linki

### ⚡ Reliability & Safety

- **Pinned browser fingerprint**: Chromium and its base image are version-pinned so a rebuild never changes the fingerprint LinkedIn sees — the single biggest cause of forced logouts, eliminated
- **63% improvement in connection reliability**: rewritten LinkedIn automation with smarter DOM targeting, clipboard-based message delivery, and graceful handling of LinkedIn's UI variants
- **Human-like import behavior**: lead list imports use randomized delays and pacing patterns to avoid triggering LinkedIn's bot detection
- **Email account ramp-up**: gradually increase sending volume on new email accounts to build sender reputation safely
- **Multiple accounts**: connect as many SMTP/IMAP email accounts and LinkedIn accounts as you need, each with its own daily limits
- **Daily limits & auto-reschedule**: set max connections and messages per day; when a limit is hit the runner reschedules work for the next day automatically instead of stopping the campaign

### 📊 Analytics

- **Campaign pipeline view**: funnel breakdown by step with prospect counts per stage; click any step to drill into the exact contacts at that point
- **Stats bar**: live counts for total prospects, in progress, completed, failed/skipped, connections sent, accepted, and messages sent
- **Acceptance rate**: tracks connection request → acceptance ratio per campaign
- **Dashboard overview**: cross-campaign summary of active runs, total contacts, recent activity

---

## What's new

- **CSV import** — bring your own leads from any source (a prior export, a website scrape, another tool). One template covers everything: LinkedIn URL, Sales Navigator URL, email, and every contact field — each row just needs a LinkedIn URL and/or an email
- **Generic inboxes supported** — role-based addresses (`info@`, `contact@`, `sales@…`) import as regular contacts, ready for email-only campaigns
- **Phone number field** — track a contact's phone alongside email and LinkedIn, editable inline on the contact page or via CSV/API
- **Bulk contact deletion** — permanently delete contacts (and their run history) from the Contacts page, with a confirmation step
- **Server-side headless LinkedIn login** — logs in on your server (email/SMS code **or** mobile-app approval), captures the full session incl. the Sales Navigator seat cookie, and unlocks longer, more frequent, more complex LinkedIn sessions
- **Pinned browser fingerprint** — Chromium + base image are version-pinned so rebuilds never trigger a forced logout
- **Batched & scheduled imports** — big Sales Nav lists split across days under a global daily cap with human-like pacing
- **Better reply sync** — reply detection for **both** email and LinkedIn, with accurate accepted-connection sync via LinkedIn's own APIs
- **Lead enrichment built in** — Apollo.io + Sales Nav profile enrichment, one-click on any list

---

## Hosting options

### One-click on Opsily (recommended)

[Opsily](https://opsily.com/hosting/linki?utm_source=github&utm_medium=readme&utm_campaign=linki) is the easiest way to run Linki. Create a server, deploy Linki from the app store, and you get a live URL in under a minute: no terminal required.

[![Deploy with Opsily](public/deploy-with-opsily.svg)](https://opsily.com/hosting/linki?utm_source=github&utm_medium=readme&utm_campaign=linki)

### Self-host with Docker

**1. Create your environment file**

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
# Public URL of the app (e.g. https://linki.yourdomain.com or http://localhost:3456)
NEXTAUTH_URL=http://localhost:3456

# Random secret: generate with: openssl rand -base64 32
NEXTAUTH_SECRET=your_random_secret_here

# Password to log in to the Linki UI
AUTH_PASSWORD=your_password_here
```

**2. Start the container**

```bash
docker compose up -d
```

For this Foremention fork, do **not** deploy the upstream Linki image: it does not contain Customer Hunter. To run the repository image directly:

```bash
docker build -t foremention-outreach:local .
docker run -d --name foremention-outreach -p 3456:3000 \
  --env-file .env.local \
  -v "$(pwd)/data:/data" \
  foremention-outreach:local
```

Foremention Outreach is then available at `http://localhost:3456`, with a public non-sensitive container health check at `/healthz`. SQLite state is persisted in `./data/linki.db` when using the provided Compose volume.

### Self-host manually (Node.js)

Requires Node.js 22+.

```bash
npm install
npm run build
npm start
```

---

## Setup

### 1. Add a LinkedIn account

Go to **Settings → LinkedIn** and add your account. Set conservative daily limits to start (recommended: 20 connections/day, 30 messages/day).

### 2. Authenticate LinkedIn

Click **Authenticate** and use **Server login** — Linki logs in on the server and walks you through LinkedIn's verification (email/SMS code or a tap in the LinkedIn mobile app). This captures a full, long-lived session, including the Sales Navigator seat needed for imports.

### 3. Add email accounts (optional)

Go to **Settings → Email** and add your SMTP/IMAP accounts. You can add as many as you need. Enable ramp-up on new accounts to build sender reputation gradually.

### 4. Connect Apollo (optional)

Go to **Settings → Integrations** and add your Apollo API key. Once connected, open any lead list and click **Enrich** to pull in verified emails and company data.

### 5. Import a lead list

Go to **Lists → New list** and paste a LinkedIn Sales Navigator list URL. Linki imports all leads with human-like pacing to avoid detection.

> **Note:** A LinkedIn Sales Navigator subscription is required to import leads.

### 6. Build and launch a campaign

Go to **Workflows → New workflow**. Add your steps — LinkedIn actions, email steps, delays — write your messages (or use templates and A/B pools), then create a run and launch.

---

## Managed edition

Everything above is open-source and runs standalone. If you'd rather not manage servers — or want the AI features on top — the fully-managed edition on **[Opsily](https://opsily.com/hosting/linki?utm_source=github&utm_medium=readme&utm_campaign=linki)** adds an **AI agent that writes every message per-lead** (any model via OpenRouter), a **hosted MCP endpoint** to drive Linki from Claude / Cursor, **automatic AI reply handling**, and **Sales Navigator InMail**. [Deploy in a minute →](https://opsily.com/hosting/linki?utm_source=github&utm_medium=readme&utm_campaign=linki)

---

## License

Linki is source-available under the [Linki Sustainable Use License](LICENSE).

**You can:** use it personally, use it for your business, self-host it on your own VPS or laptop, modify it, contribute to it.