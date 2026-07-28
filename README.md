# GroundTruth — Real Estate Signal Agent

An internal prospecting tool for **GroundTruth** (drone intelligence, operating under
Smoove Visuals LLC, FAA Part 107 licensed). It finds properties worth pitching for
aerial photography, drafts outreach specific to *why* each one is worth pitching, and
hands the result off as a reviewable Gmail draft plus a tentative calendar hold.

Single-user internal tool — no signup, no billing, no marketing pages.

---

## The idea

Most lead scoring ranks prospects on fit criteria (price, size, revenue). This ranks on
**situational signals** — moments when a property specifically needs aerial work:

| Signal | Why it matters |
|---|---|
| New construction, no listing media | Permit just completed, nothing shot yet |
| FSBO with amateur photos | Phone-camera photos on a property that deserves better |
| Stale listing, price drop, thin photos | Listing is underperforming and under-photographed |
| Acreage or waterfront | Land features that cannot be shown from the ground |

Signal types are stored in the database, not hardcoded in a prompt — they can be edited
without a deploy.

## How it runs

```
Mecklenburg County permit feed   (deterministic — public records, no key)
        ↓
   new completions               (deduped on parcel ID)
        ↓
   contact enrichment            (AI + web search — builder first, agent fallback)
        ↓
   signal detection              (AI judgment — may return a clean "no")
        ↓
   rank by confidence, cap N     (deterministic — daily cap lives in config)
        ↓
   best shoot window             (deterministic — Open-Meteo forecast + scoring)
        ↓
   shot list + outreach draft    (AI judgment)
        ↓
   pipeline row                  → Postgres trigger → Zapier
        ↓
   Gmail DRAFT + tentative hold  (never sent, never confirmed — you approve)
```

Triggered two ways: a **Run agent** button for a single lead, or a **daily sweep**
(Vercel Cron) that runs the whole chain unattended.

## Where AI is used — and where it deliberately isn't

AI is used only where the work is genuinely a judgment call:

- **Signal detection** — is this property actually worth pitching, and why
- **Contact enrichment** — finding a real, sourced business contact
- **Outreach drafting** — writing something specific rather than generic

Everything else is deterministic on purpose:

- **Permit sweep** — a public records query
- **Shoot window** — an Open-Meteo forecast plus a scoring function. This *used* to be an
  AI call with web search. It isn't a judgment call, it's a data fetch, so it was
  hardened: the step went from ~45s and ~$0.30 per run to ~1s and $0.00, and stopped
  occasionally returning stale dates.
- **The handoff** — a Postgres trigger and a Zap

## Guardrails

These are enforced in code and in the database, not just asked for in prompts:

- **The agent can never overwrite a human decision.** Moving a pipeline card sets
  `stage_locked`, and a Postgres trigger rejects any agent write to a locked row — and
  any backward move. Unidentified writers default to the *restricted* role, so a failure
  to identify costs privileges rather than granting them.
- **Never fabricate to fill a gap.** Enrichment must return a source URL or the contact is
  discarded. Signal detection returns explicit `dataGaps`. The email signature is stored
  in config so the model can never invent contact details.
- **A clean "no" is a first-class result.** `agent_runs` distinguishes `signal_found`,
  `no_signal`, `capped`, and `error` — so "found nothing" never looks like "broke".
- **Nothing irreversible is automated.** The chain ends at a Gmail *draft* and a
  *tentative* hold. Sending remains a human action.
- **Dates and times are validated.** Shoot windows are range-checked and carry an explicit
  Eastern offset, after a bare timestamp once landed an hour off in Calendar.

## Stack

Next.js (App Router, TypeScript) · Supabase Postgres · Claude API · Zapier · Vercel

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Anthropic keys
npm run dev
```

Then run the SQL in `supabase/` in order (`schema.sql`, then `002`…`014`) in the Supabase
SQL editor. Two notes:

- `004` ships with a placeholder Zapier hook URL. Set the real one directly:
  `update app_config set value = '<your catch hook url>' where key = 'zapier_catch_hook_url';`
- `013` adds an enum value and **must be run alone** — Postgres won't let a new enum value
  be used in the same transaction that adds it.

### Configuration stored as data

Change these with an `UPDATE`, no deploy required:

| Key | Purpose |
|---|---|
| `daily_lead_cap` | How many top-confidence leads the sweep processes per day |
| `zapier_catch_hook_url` | Where the pipeline webhook posts |
| `email_signature` | Appended to every draft; never model-generated |

## Scheduling

`vercel.json` runs `/api/sweep` daily at 11:00 UTC (07:00 ET). Set `CRON_SECRET` in the
Vercel project; the route rejects unauthenticated calls when it is present.
