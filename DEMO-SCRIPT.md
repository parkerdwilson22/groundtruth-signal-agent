# GroundTruth — Loom script

**~450 spoken words ≈ 3:00.** Screen: `groundtruth-signal-agent.vercel.app`
Every number is real and visible on screen.

---

## 0:00 – 0:25 · The window (60 words)

*Screen: the dashboard, top of page.*

> When a builder finishes a house, there's about a two-week window where the
> home exists and has zero marketing photos. That's my best customer — and
> there's no list of them anywhere.
>
> Most prospecting tools score leads on fit. Price, size, location. I needed
> one that scores on **timing**.

---

## 0:25 – 1:05 · What ran without me (115 words)

*Screen: the blue "Last automated sweep" bar.*

> This ran by itself at 12:49 yesterday. Two minutes, no errors. Nobody
> started it.
>
> It pulled Mecklenburg County's building permit records — public data, not a
> purchased list — and found nine homes whose permits just closed.

*Screen: scroll the lead queue. Point at the three "2 days ago" cards.*

> These three closed **two days ago**. Two of them are the same builder —
> Epic Homes — two houses on the same street, both finished this week.
>
> And notice what it's showing me: the **permit owner**. Not the listing
> agent. For a house this new there usually isn't an agent yet — but the
> county always tells you who pulled the permit. That's the builder, and a
> builder finishing two houses a week is a relationship, not a one-off.

*Screen: point at the two Ohm Ln cards — one drafted, one declined.*

> These two are the interesting pair. This one it drafted — it found an
> active listing, so it went to the listing agent. The one next door it
> **declined**, because that listing already had twenty-two photos.
>
> Same builder, same street, same week. Two different answers.
>
> It drafted three overall and held back six. Cap's three a day.

---

## 1:05 – 2:00 · Watch it work (135 words)

*Screen: pick a capped lead → **Run agent**.*

> Let me run one live.
>
> Step one, signal detection — that's **AI**, because "is this worth pitching"
> is a judgment call. It gives me a confidence score and tells me what it
> couldn't verify.

*Screen: the activity feed streaming.*

> Step two, the shoot window — that's **not** AI. It's a plain weather API.
> This used to be an AI web search and I took the AI out on purpose: picking
> the clearest low-wind day is a data fetch, not a judgment call. It went from
> forty-five seconds to one, and from thirty cents to free.
>
> Step three, drafting — AI again. Writing something specific to *this*
> property is judgment.
>
> Step four hands off to Zapier.

*Screen: cut to Gmail Drafts, then Google Calendar.*

> And there's the result. A Gmail draft — written, addressed, waiting. Plus a
> tentative calendar hold on the shoot date, shot list in the description.

---

## 2:00 – 2:35 · Where the human stays (90 words)

> Three things I want to be clear about.
>
> **It stops at a draft.** Never sends. The one irreversible action is still
> mine.

*Screen: change a card's dropdown to Contacted — the `locked` badge appears.*

> **Once I move a card, it locks.** The agent physically cannot reverse it.
> That's enforced in the database, not in a prompt.

*Screen: the 5014 Ohm Ln card — "declined".*

> And **this one it said no to.** A one-point-nine-million-dollar property. It
> found the listing, saw twenty-two photos already existed, and declined — in
> writing. Eight of my nine leads had no contact it could verify, and it told
> me that instead of inventing an email address.

---

## 2:35 – 3:00 · Close (65 words)

> Nine properties I had no visibility into, surfaced before I went looking. At
> six hundred dollars a shoot and roughly nineteen qualifying builds a month
> in this county, it pays for itself the first time it works.
>
> AI does three things here: reads the signal, finds the contact, writes the
> pitch. Everything else is deterministic on purpose.
>
> It's live, it runs every morning at seven — and I built it because I'm the
> one flying the drone.

---

# Key points, mapped to what they're scoring

| Criterion | The moment that earns it |
|---|---|
| **AI Integration Depth** | The AI/Deterministic labels on every step — *especially* saying you removed AI from the weather step on purpose. Almost nobody demos taking AI out. |
| **Real-World Impact** | The Gmail draft and calendar hold, real and on screen. Plus the $600 × ~19 builds/month framing. |
| **Innovation & Creativity** | Permit records as a lead source, and targeting the permit owner instead of an agent who doesn't exist yet. This is your strongest 20 seconds. |

## Three lines that do the most work

1. *"Not the listing agent — there isn't one yet. The permit owner."*
2. *"I took the AI out on purpose."*
3. *"It said no to a one-point-nine-million-dollar property."*

## Do not say

- **Any conversion rate.** You don't have one. "Pays for itself the first time
  it works" is true and checkable; a percentage would be invented — which
  would contradict the exact discipline you're demonstrating.
- **"Multi-agent system."** It's a disciplined chain of three AI calls with
  deterministic steps between them. Say that; it's more accurate and more
  impressive to anyone who builds these.
- Anything from spec §11.11 (the private CEO email). Background only.

## If you have 15 seconds spare

> This is a v1, built to be cut back. The next thing I'd harden is the contact
> lookup — and the next lead source is stale listings, which the signal types
> already support.

That answers "what's next" and quietly acknowledges the roadmap without being
asked.

## Before you hit record

- Board state: 9 leads, all county-sourced. 3 drafted, 6 held back.
- **For the live run** pick a *capped* lead — 501 Magnolia, 1146 Concord, or
  13128 Asbury Chapel. Real signal, never drafted, so the chain runs clean.
- Each run ≈ 5¢; you have ~$0.41, so 6–8 takes.
- Have **Gmail Drafts** and **Google Calendar** open in tabs to cut to.
- Unlock any card you locked in a previous take, or the agent will refuse it.
