# Foremention Outreach — Free / Open-Source Production Stack

This document records the default low-cash-cost architecture for Foremention Outreach.
The goal is not to install every free tool. It is to use the smallest set that materially
improves acquisition quality, reliability, security, recoverability, or operating cost.

## Integrated in this repository

| Layer | Default / option | Role |
| --- | --- | --- |
| Buyer discovery | SearXNG | Free self-hosted metasearch discovery. |
| Search fallback | Firecrawl Cloud or self-hosted Firecrawl | Search/crawl adapter with attributable evidence. |
| Company enrichment | Crawl4AI | Self-hosted company-page crawl and LLM-friendly extraction. |
| Buyer/contact data | Hunter → Apollo → Prospeo waterfall | Decision-maker discovery plus verified work-email enrichment when available. |
| AI | Groq / OpenRouter / OpenAI / Ollama | Evidence classification, research and structured first-touch generation. Ollama is the zero-provider-fee local option. |
| Sending | Generic SMTP + IMAP | Works with EmailBD or another authenticated business-mail relay without provider-specific code. |
| Reply/bounce handling | Built-in IMAP runner | Captures replies, hard bounces and durable stop/suppression behavior. |
| Safety | Customer Hunter gates | Verified-email gate, evidence gate, channel health, rate limits, suppressions, reply stop and approval/autopilot policy. |
| Cost truth | Built-in provider usage ledger | Separates known monetary spend from usage with unknown provider price. |
| State | SQLite WAL | Persistent operational state. |
| Disaster recovery | Litestream 0.5.17 → S3-compatible storage | Optional Docker Compose backup profile. Cloudflare R2 is the recommended low-cost destination. |
| Health | /healthz + Docker HEALTHCHECK | Deployment and SQLite liveness. |
| CI acceptance | GitHub Actions | Unit/integration tests, lint, Next build, Docker build, live-container smoke and browser acceptance. |
| Dependency maintenance | GitHub Dependabot | Weekly npm, GitHub Actions and Docker update PRs. |

## Recommended production topology

Use a single Docker-capable VM with persistent disk for the application and SQLite.
For a student account, Azure for Students is the preferred starting host because the
student credit can cover a small VM while authenticated SMTP relay on port 587 is
supported. Do not depend on direct-to-MX port 25 delivery.

Run:

1. outreach — this repository.
2. SearXNG — self-hosted discovery.
3. Crawl4AI — self-hosted deep crawl.
4. Ollama only when the VM has enough RAM/CPU/GPU for the selected model; otherwise keep the existing hosted AI adapter.
5. sqlite-backup — optional Litestream profile after R2/S3 credentials are configured.

Firecrawl does not need to be self-hosted if its free cloud allocation is sufficient.
Avoid operating two tools that solve the same problem unless the fallback materially
improves reliability.

## Email architecture

Do not operate a new self-hosted cold-email MTA merely because Postal or Stalwart is
free software. Deliverability depends on IP/domain reputation, reverse DNS, authentication,
complaint handling and warm-up, not only software cost.

Use Foremention Outreach's generic SMTP/IMAP support with a reputable authenticated relay
on port 587/465. Required sender-domain work is operational, not application code:

- MX where inbound mail is hosted.
- SPF.
- DKIM from the selected mail provider.
- DMARC.
- Provider-supported reverse DNS when using a dedicated sending IP.
- A real monitored reply mailbox.
- Conservative account limits and ramp-up.

A hard bounce now invalidates only the bounced mailbox and stops only that target's email
track. It does not invalidate sibling buyers at the same company and it does not stop the
LinkedIn track.

## Free data strategy

Use free allocations as a waterfall rather than pretending a fully free verified-contact
database exists. Current provider free allowances can change, so verify each account's
billing/credit page before scaling.

SearXNG + Crawl4AI can discover and research accounts without per-request provider fees.
Hunter, Apollo and Prospeo remain the source of truth for work-email verification when their
APIs return a provider verification state.

A local SMTP/MX email verifier can be useful for syntax/domain hygiene, but it must not be
promoted to mailbox-level verification. Large mailbox providers intentionally make SMTP
existence probing unreliable.

## Tools deliberately not added

| Tool/category | Decision |
| --- | --- |
| n8n / Activepieces | Not needed for the core loop; the acquisition runner is already durable and in-process. Add only for unrelated business workflows. |
| Twenty CRM | Not needed yet; Customer Hunter already has opportunities and human sales tasks. |
| Postal / Stalwart as production cold sender | Not default. Free software does not solve new-IP deliverability. |
| theHarvester | Not used for sales prospecting; its documented use is security/authorized assessment. |
| Reacher check-if-email-exists | Not bundled. Licensing and port-25 requirements make it a poor default, and SMTP probing is not equivalent to provider-verified work email. |
| Self-hosted Sentry | Too heavy for this stack. Prefer a hosted student/free observability allowance if desired. |
| Infisical | Useful later for teams; unnecessary infrastructure for a single-operator launch. .env.local is ignored by Git and DB-stored mail secrets are encrypted. |
| Uptime Kuma on the same VM | It cannot detect failure of the VM hosting itself. Use an external monitor or separate host if added. |

## Manual production inputs that code cannot create for you

The repository can enforce readiness, but it cannot invent external credentials or DNS
authority. Before a live canary, supply:

- a deployed VM/VPS with persistent storage;
- NEXTAUTH_SECRET, AUTH_PASSWORD, and INTERNAL_API_SECRET;
- one usable discovery provider (SEARXNG_URL is the zero-fee default);
- one buyer/contact provider API key;
- one configured AI model/provider, or an Ollama model;
- FOREMENTION_OUTREACH_SECRET shared with the main Foremention deployment;
- a verified SMTP/IMAP sending mailbox;
- sender-domain SPF/DKIM/DMARC;
- an active HUNTER_DEFAULT_RUN_ID;
- an authenticated LinkedIn account only if LinkedIn outreach is desired;
- R2/S3 bucket credentials if off-host SQLite backup is enabled.

Keep HUNTER_AUTOPILOT_MODE=assisted for the first production canary and leave
HUNTER_CANARY_ENABLED=false until the readiness panel is fully green.
