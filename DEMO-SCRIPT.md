# GroundTruth — Loom script (~3:00)

Read-card. Every number here is real and checkable on screen.
Screen: **groundtruth-signal-agent.vercel.app**

---

## 0:00 – 0:30 · The problem

> In early-stage companies the hard part of outreach isn't sending more — it's
> knowing who's actually worth a conversation. Most prospecting tools score
> leads on fit: price, size, location. That tells you a property exists. It
> doesn't tell you it needs you *right now*.
>
> I run a Part 107 drone photography business in Charlotte. My best customer is
> a house that was finished last week and has no photos yet. That window is
> maybe two weeks wide, and there's no list of those anywhere.
>
> So I built an agent that finds them.

---

## 0:30 – 1:10 · What ran while I wasn't watching

**On screen:** top of the dashboard — the blue "Last automated sweep" bar.

> This ran on its own at 12:49 this afternoon. Two minutes, no errors.
>
> It pulled Mecklenburg County's building permit feed — public records, no
> scraping — and found nine single-family homes whose construction permits just
> closed. That's the closest public signal to "this house is finished and about
> to need marketing photos."
>
> Of those nine, it drafted outreach on three and deliberately held back six.
> That restraint is a setting: three a day, ranked by confidence. I'd rather
> have three good ones than nine mediocre ones.

**On screen:** the lead queue — point at the badges.

> And every lead says what happened to it. Drafted. Held back by cap. No
> contact found. Nine leads, nine outcomes, nothing unexplained.

**On screen:** scroll to the pipeline. Point at a card.

> Every card says why it's here, not just where it is. New construction, no
> listing media, sixty percent confidence. Shoot date. Timestamp.

**On screen:** the 5010 Ohm Ln card, then open Gmail → Drafts.

> And here's the part that matters. This lead has a real listing agent —
> found, with a source. That draft is sitting in my Gmail right now, written,
> addressed, waiting for me to hit send. Plus a tentative calendar hold on the
> shoot date.

---

## 1:10 – 2:05 · Watch it think

**On screen:** click a fresh lead → **Run agent**.

> Let me run one live so you can see the reasoning.
>
> Step one is signal detection — that's AI, because "is this worth pitching"
> is a judgment call. It's reading the property against a set of signals and
> telling me its confidence *and* what it couldn't verify.

**On screen:** the activity feed as it streams.

> Step two, the shoot window — that's not AI. It's a plain weather API call.
> This step used to be an AI web search, and I took the AI out on purpose:
> picking the clearest low-wind day isn't judgment, it's a data fetch. It went
> from forty-five seconds to about one, from thirty cents to free, and it
> stopped occasionally getting the date wrong.
>
> Step three is drafting — AI again, because writing something specific to
> *this* property is judgment.
>
> And step four hands off to Zapier: Gmail draft, tentative calendar hold.

---

## 2:05 – 2:35 · Where the human stays

> Three things I want to be clear about.
>
> **First** — it stops at a draft. Never a send. Never a confirmed booking. The
> one irreversible action in this whole system is still mine.
>
> **Second** — once I move a card, the agent can never move it back.

**On screen:** change a pipeline card's dropdown to **Contacted**. The `locked`
badge appears.

> Watch. I move this to Contacted, and it locks. That's enforced by the
> database, not by a prompt — the agent is physically unable to reverse it or
> re-send outreach on it. I tested it by trying to break it.
>
> **Third** — and this is my favorite one.

**On screen:** select **5014 OHM LN** in the queue and run it — it declines live.
(Or point at its badge if you'd rather not spend a run.)

> This is a one-point-nine-million-dollar property the agent said *no* to. It
> found the listing, saw twenty-two photos already existed, and declined —
> in writing, with what it couldn't confirm listed underneath.
>
> Eight of my nine leads had no contact it could verify, and it told me that
> instead of inventing an email address. A clean no is worth more than a
> confident maybe.

---

## 2:35 – 3:00 · Close

> Nine properties I had no visibility into, surfaced before I went looking.
> One with a verified contact and a drafted pitch. At six hundred dollars a
> shoot and roughly nineteen qualifying builds a month in this county, it pays
> for itself the first time it works.
>
> AI is doing three things here: reading the signal, finding the contact,
> writing the pitch. Everything else — the county pull, the forecast, the
> handoff — is deterministic, on purpose. This is a v1 built to be cut back,
> not a finished system.
>
> It's the tool I actually use. It's live, it runs every morning at seven, and
> I built it because I'm the one flying the drone.

---

## Notes before recording

- **Board state:** 9 leads, all county-sourced. 3 drafted, 6 held back by the
  daily cap. The four prototype properties from the original spec were deleted
  — they were fabricated addresses, and mixing them with real permit data would
  have undercut the whole claim.
- **For the live run**, pick a capped lead — 501 Magnolia, 1146 Concord, or
  13128 Asbury Chapel. They have a real signal but were never drafted, so the
  full chain runs cleanly.
- Each live run costs ~5¢; you have ~$0.41, so 6–8 takes.
- Have **Gmail Drafts** and **Google Calendar** open in tabs to cut to.
- Don't claim a conversion rate. "Pays for itself the first time it works" is
  true and checkable; a percentage would be invented — and inventing a number
  would contradict the exact discipline you're demonstrating.
- Never mention the private CEO email (spec §11.11) — background only.
