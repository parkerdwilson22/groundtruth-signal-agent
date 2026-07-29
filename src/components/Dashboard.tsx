'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BrandMark } from '@/components/Brand';
import LastSweep from '@/components/LastSweep';
import type {
  Lead,
  Draft,
  Signal,
  PipelineEntry,
  PipelineStage,
  SignalResult,
  ShootWindow,
  DraftResult,
} from '@/lib/types';

// --- types -----------------------------------------------------------------

type BoardRow = PipelineEntry & {
  leads: Pick<
    Lead,
    | 'address'
    | 'city'
    | 'state'
    | 'price'
    | 'agent_email'
    | 'listing_agent'
    | 'contact_type'
    | 'contact_source'
  > | null;
  drafts:
    | (Pick<Draft, 'outreach_subject' | 'best_shoot_window' | 'shoot_date_iso'> & {
        signals: Pick<Signal, 'signal_type' | 'confidence' | 'reasoning'> | null;
      })
    | null;
};

/** "2026-07-30" -> "Thu, Jul 30". Avoids parsing the human-readable prose. */
function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

type FeedKind = 'note' | 'good' | 'warn' | 'error' | 'plain';
interface FeedLine {
  id: number;
  at: string;
  text: string;
  kind: FeedKind;
}

/**
 * Step labels name which parts use AI judgment and which are deterministic —
 * the distinction spec §10.1 is built around, surfaced rather than hidden.
 */
const STEPS = [
  { label: 'Analyzing signal', mode: 'AI' as const },
  { label: 'Best shoot window', mode: 'Deterministic' as const },
  { label: 'Drafting shot list + outreach', mode: 'AI' as const },
  { label: 'Handoff to pipeline', mode: 'Deterministic' as const },
];

const COLUMNS: { stage: PipelineStage; label: string }[] = [
  { stage: 'new_signal', label: 'New signal' },
  { stage: 'contacted', label: 'Contacted' },
  { stage: 'scheduled', label: 'Scheduled' },
  { stage: 'completed', label: 'Completed' },
];

function clockNow() {
  return new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

// --- component -------------------------------------------------------------

export default function Dashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [activeStep, setActiveStep] = useState(-1);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  /** lead_id -> what the agent last decided, so every lead on screen is accounted for. */
  const [leadOutcome, setLeadOutcome] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<(DraftResult & { signalType: string }) | null>(null);
  const [declined, setDeclined] = useState<SignalResult | null>(null);
  const feedIdRef = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);

  const say = useCallback((text: string, kind: FeedKind = 'plain') => {
    setFeed((prev) => [...prev, { id: feedIdRef.current++, at: clockNow(), text, kind }]);
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [feed]);

  const loadBoard = useCallback(async () => {
    const { data, error } = await supabase
      .from('pipeline')
      .select(
        'id, lead_id, draft_id, stage, stage_locked, updated_at, ' +
          'leads(address, city, state, price, agent_email, listing_agent, contact_type, contact_source), ' +
          'drafts(outreach_subject, best_shoot_window, shoot_date_iso, ' +
          'signals(signal_type, confidence, reasoning))',
      )
      .order('updated_at', { ascending: false });

    if (error) {
      say(`Could not load pipeline: ${error.message}`, 'error');
      return;
    }
    setBoard((data ?? []) as unknown as BoardRow[]);
  }, [say]);

  const loadLeads = useCallback(async () => {
    const [{ data, error }, { data: runs }] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      // Latest outcome per lead, so a lead that was capped or declined says so
      // instead of looking identical to one that was never processed.
      supabase
        .from('agent_runs')
        .select('lead_id, run_status, created_at')
        .order('created_at', { ascending: true }),
    ]);

    if (error) {
      say(`Could not load leads: ${error.message}`, 'error');
      return;
    }
    setLeads((data ?? []) as Lead[]);

    const latest: Record<string, string> = {};
    for (const r of (runs ?? []) as { lead_id: string | null; run_status: string }[]) {
      if (r.lead_id) latest[r.lead_id] = r.run_status; // ascending, so last wins
    }
    setLeadOutcome(latest);
  }, [say]);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadLeads(), loadBoard()]);
    })();
  }, [loadLeads, loadBoard]);

  function resetRun() {
    setFeed([]);
    setDraft(null);
    setDeclined(null);
    setActiveStep(-1);
    setDoneCount(0);
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `${path} failed (${res.status})`);
    return json as T;
  }

  async function runAgent() {
    if (!selected || running) return;
    resetRun();
    setRunning(true);

    try {
      // 1 — signal (AI judgment)
      setActiveStep(0);
      say(`Reading signals for ${selected.address}`, 'note');
      const signal = await post<SignalResult & { signalId: string }>('/api/signal', {
        leadId: selected.id,
      });

      if (!signal.signal) {
        // A clean negative is a first-class result, not a failure (§11.2).
        say(`No signal — ${signal.reasoning}`, 'warn');
        if (signal.dataGaps?.length) {
          say(`Gaps the agent flagged: ${signal.dataGaps.join('; ')}`, 'note');
        }
        say('Stopped. A clean "no" is more useful than a forced yes.', 'note');
        setDeclined(signal);
        setActiveStep(-1);
        setDoneCount(1);
        return;
      }

      say(
        `Signal: ${signal.signalType.replace(/_/g, ' ')} · ${Math.round(signal.confidence * 100)}% confidence`,
        'good',
      );
      say(signal.reasoning, 'note');
      if (signal.dataGaps?.length) {
        say(`Data gaps noted: ${signal.dataGaps.join('; ')}`, 'note');
      }
      setDoneCount(1);

      // 2 — shoot window (deterministic)
      setActiveStep(1);
      say('Fetching forecast (Open-Meteo, no model call)', 'note');
      const win = await post<ShootWindow>('/api/shoot-window', { leadId: selected.id });
      say(`Best day: ${win.date} — ${win.conditions}, wind ${win.windKmh} km/h`, 'good');
      say(`Flight window ${win.startLocal}–${win.endLocal}. ${win.timeRationale}`, 'note');
      setDoneCount(2);

      // 3 — draft (AI judgment)
      setActiveStep(2);
      say('Drafting shot list and outreach', 'note');
      const result = await post<DraftResult & { draftId: string }>('/api/draft', {
        leadId: selected.id,
        signalId: signal.signalId,
        shootWindow: win,
      });
      setDraft({ ...result, signalType: signal.signalType });
      setDoneCount(3);

      // 4 — handoff (deterministic)
      setActiveStep(3);
      say('Added to pipeline — webhook fired to Zapier', 'good');
      await Promise.all([loadBoard(), loadLeads()]);
      setDoneCount(4);
      setActiveStep(-1);
      say('Gmail draft and tentative calendar hold created for review.', 'note');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      say(message, 'error');
      setActiveStep(-1);
    } finally {
      setRunning(false);
    }
  }

  /**
   * Human stage change. MUST go through set_stage — a direct update is
   * treated as an agent action and rejected by the pipeline_guard trigger.
   */
  async function moveStage(row: BoardRow, stage: PipelineStage) {
    const { error } = await supabase.rpc('set_stage', {
      p_lead_id: row.lead_id,
      p_stage: stage,
    });
    if (error) {
      say(`Could not move card: ${error.message}`, 'error');
      return;
    }
    say(`You moved ${row.leads?.address ?? 'lead'} to ${stage.replace('_', ' ')} — now locked.`, 'note');
    await loadBoard();
  }

  const surfaced = board.length;
  const inOutreach = board.filter((r) => r.stage === 'contacted').length;
  const booked = board.filter((r) => r.stage === 'scheduled' || r.stage === 'completed').length;
  // Counts leads that have a contact at all; whether that contact carries a
  // source URL is shown per-card, not flattened into this number. Claiming
  // "verified" for an unsourced contact was the actual defect — under-
  // counting to zero would be the opposite error.
  const withContact = board.filter((r) => r.leads?.agent_email).length;
  const unverifiedContacts = board.filter(
    (r) => r.leads?.agent_email && !r.leads?.contact_source,
  ).length;
  const sweptCount = leads.filter((l) => l.source === 'mecklenburg_permits').length;

  return (
    <div className="min-h-screen">
      {/* ---------- header ---------- */}
      <header className="border-b border-[var(--gt-border)] bg-[var(--gt-surface)]">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <BrandMark />
          <div className="flex items-center gap-2">
            <span className="gt-badge gt-badge-neutral">
              {sweptCount} of {leads.length} leads auto-sourced
            </span>
            <span className="gt-badge gt-badge-blue">Sweep runs daily 7:00 AM</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-6 py-6">
        {/* ---------- evidence that the autonomous run happened (§12 Surface) ---------- */}
        <LastSweep />

        {/* ---------- outcome metrics (§10.5 — outcomes, never time saved) ---------- */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Signals surfaced" value={surfaced} />
          <Stat
            label="Contact found"
            value={withContact}
            note={unverifiedContacts > 0 ? `${unverifiedContacts} unverified` : undefined}
          />
          <Stat label="In outreach" value={inOutreach} />
          <Stat label="Shoots booked" value={booked} accent />
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* ---------- lead queue ---------- */}
          <section className="gt-card flex flex-col p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="gt-section-label">Lead queue</h2>
              <span className="gt-mono text-[10.5px] text-[var(--gt-muted-soft)]">
                {leads.length} total
              </span>
            </div>

            <div className="max-h-[420px] flex-1 space-y-2 overflow-y-auto pr-1">
              {leads.length === 0 && (
                <p className="gt-mono py-6 text-center text-xs text-[var(--gt-muted-soft)]">
                  Loading leads…
                </p>
              )}
              {leads.map((lead) => {
                const isActive = selected?.id === lead.id;
                const fromSweep = lead.source === 'mecklenburg_permits';
                return (
                  <button
                    key={lead.id}
                    onClick={() => {
                      setSelected(lead);
                      resetRun();
                    }}
                    disabled={running}
                    className={`w-full rounded-lg border p-3 text-left transition disabled:opacity-55 ${
                      isActive
                        ? 'border-[var(--gt-blue)] bg-[var(--gt-blue-soft)]'
                        : 'border-[var(--gt-border)] bg-white hover:border-[var(--gt-border-strong)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13.5px] leading-snug font-medium">
                        {lead.address}
                      </span>
                      {fromSweep && (
                        <span className="gt-badge gt-badge-blue shrink-0">auto</span>
                      )}
                    </div>
                    <div className="gt-mono mt-1 text-[10.5px] text-[var(--gt-muted-soft)]">
                      {lead.city}
                      {lead.state ? `, ${lead.state}` : ''}
                      {lead.price ? ` · $${Number(lead.price).toLocaleString()}` : ''}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {/* What the agent decided — so every lead in the queue
                          reconciles against the sweep summary above. */}
                      <OutcomeBadge outcome={leadOutcome[lead.id]} />
                      {/* A contact with no source URL is NOT the same as a
                          sourced one — the system says so rather than
                          flattening both into "contact found". */}
                      {lead.agent_email ? (
                        lead.contact_source ? (
                          <span
                            className="gt-badge gt-badge-green"
                            title={`Source: ${lead.contact_source}`}
                          >
                            {lead.contact_type === 'builder' ? 'builder' : 'agent'} contact ·
                            sourced
                          </span>
                        ) : (
                          <span
                            className="gt-badge gt-badge-amber"
                            title="Found before source-tracking was added. Treat as unverified until re-checked."
                          >
                            contact · unverified
                          </span>
                        )
                      ) : lead.enrichment_status === 'insufficient_data' ? (
                        <span className="gt-badge gt-badge-neutral">no contact found</span>
                      ) : null}
                      {lead.photo_count != null && (
                        <span className="gt-badge gt-badge-neutral">
                          {lead.photo_count} photos
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={runAgent}
              disabled={!selected || running}
              className="gt-btn-primary mt-3 w-full py-2.5 text-[13.5px]"
            >
              {running ? 'Running…' : selected ? 'Run agent' : 'Select a lead'}
            </button>
          </section>

          {/* ---------- agent run ---------- */}
          <section className="gt-card p-4">
            <h2 className="gt-section-label mb-3">Agent run</h2>

            <ol className="mb-3 space-y-1">
              {STEPS.map((step, i) => {
                const done = i < doneCount;
                const active = i === activeStep;
                return (
                  <li key={step.label} className="flex items-center gap-2.5 py-0.5 text-[12.5px]">
                    <span className="flex w-3.5 justify-center">
                      {active ? (
                        <span className="gt-spin" />
                      ) : done ? (
                        <span className="text-[var(--gt-green)]">✓</span>
                      ) : (
                        <span className="text-[var(--gt-border-strong)]">○</span>
                      )}
                    </span>
                    <span
                      className={
                        done
                          ? 'text-[var(--gt-text)]'
                          : active
                            ? 'font-medium text-[var(--gt-blue)]'
                            : 'text-[var(--gt-muted-soft)]'
                      }
                    >
                      {step.label}
                    </span>
                    <span
                      className={`gt-badge ${
                        step.mode === 'AI' ? 'gt-badge-blue' : 'gt-badge-neutral'
                      }`}
                    >
                      {step.mode}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div ref={feedRef} className="gt-feed h-[228px] overflow-y-auto">
              {feed.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center">
                  <p className="text-[12px] text-[var(--gt-muted-soft)]">
                    Select a lead and run the agent to see each step as it happens.
                  </p>
                </div>
              ) : (
                feed.map((line) => (
                  <div
                    key={line.id}
                    className={`gt-feed-row ${
                      line.kind === 'plain' ? '' : `is-${line.kind}`
                    } gt-slide-in`}
                  >
                    <span className="gt-feed-time">{line.at}</span>
                    <span>{line.text}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* ---------- declined panel (§11.2 made visible) ---------- */}
        {declined && (
          <section className="gt-card gt-slide-in mt-5 border-l-[3px] border-l-[var(--gt-amber)] p-4">
            <div className="flex items-center gap-2">
              <h2 className="gt-section-label">Agent declined this lead</h2>
              <span className="gt-badge gt-badge-amber">no signal</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed">{declined.reasoning}</p>
            {declined.dataGaps?.length > 0 && (
              <div className="mt-3">
                <p className="gt-section-label mb-1">What it couldn&apos;t confirm</p>
                <ul className="space-y-0.5">
                  {declined.dataGaps.map((gap, i) => (
                    <li key={i} className="text-[12.5px] text-[var(--gt-muted)]">
                      — {gap}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* ---------- draft panel ---------- */}
        {draft && (
          <section className="gt-card gt-slide-in mt-5 p-4">
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div>
                <h2 className="gt-section-label mb-2">Shot list</h2>
                <ol className="space-y-1.5">
                  {draft.shotList.map((shot, i) => (
                    <li key={i} className="flex gap-2.5 text-[12.5px] leading-snug">
                      <span className="gt-mono shrink-0 text-[var(--gt-blue)]">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span>{shot}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h2 className="gt-section-label mb-2">Outreach draft</h2>
                <div className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-surface-sunk)] p-3">
                  <div className="mb-2 border-b border-[var(--gt-border)] pb-2">
                    <span className="gt-mono text-[10.5px] text-[var(--gt-muted-soft)]">
                      SUBJECT
                    </span>
                    <p className="text-[12.5px] font-medium">{draft.outreachSubject}</p>
                  </div>
                  <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">
                    {draft.outreachBody}
                  </p>
                </div>
                <p className="gt-mono mt-2 text-[10.5px] text-[var(--gt-muted-soft)]">
                  {draft.bestShootWindow}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ---------- pipeline ---------- */}
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="gt-section-label">Pipeline</h2>
            <span className="gt-mono text-[10.5px] text-[var(--gt-muted-soft)]">
              moving a card locks it from the agent
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {COLUMNS.map((col) => {
              const rows = board.filter((r) => r.stage === col.stage);
              return (
                <div
                  key={col.stage}
                  className="rounded-xl border border-[var(--gt-border)] bg-[var(--gt-surface-sunk)] p-2.5"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="gt-section-label">{col.label}</span>
                    <span className="gt-mono text-[10.5px] text-[var(--gt-muted-soft)]">
                      {rows.length}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {rows.map((row) => (
                      <article
                        key={row.id}
                        className="gt-slide-in rounded-lg border border-[var(--gt-border)] border-l-[3px] border-l-[var(--gt-blue)] bg-white p-2.5"
                      >
                        <div className="text-[12.5px] leading-snug font-medium">
                          {row.leads?.address ?? 'Unknown lead'}
                        </div>
                        <div className="gt-mono mt-0.5 text-[10.5px] text-[var(--gt-muted-soft)]">
                          {row.leads?.city}
                          {row.leads?.price
                            ? ` · $${Number(row.leads.price).toLocaleString()}`
                            : ''}
                        </div>

                        {/* Why this lead is here — the signal, not just the address. */}
                        {row.drafts?.signals?.signal_type && (
                          <div className="mt-1.5">
                            {/* Older rows carry free-text signal types that can be
                                long, so this badge wraps rather than overflowing. */}
                            <span className="gt-badge gt-badge-blue !whitespace-normal text-left leading-tight">
                              {row.drafts.signals.signal_type.replace(/_/g, ' ')}
                              {row.drafts.signals.confidence != null &&
                                ` · ${Math.round(Number(row.drafts.signals.confidence) * 100)}%`}
                            </span>
                          </div>
                        )}

                        {row.leads?.agent_email && (
                          <div className="gt-mono mt-1.5 truncate text-[10.5px] text-[var(--gt-green)]">
                            {row.leads.agent_email}
                          </div>
                        )}
                        {shortDate(row.drafts?.shoot_date_iso) && (
                          <div className="gt-mono mt-1 text-[10.5px] text-[var(--gt-blue)]">
                            {shortDate(row.drafts?.shoot_date_iso)}
                          </div>
                        )}

                        <div className="gt-mono mt-1 text-[10px] text-[var(--gt-muted-soft)]">
                          {new Date(row.updated_at).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </div>

                        <div className="mt-2 flex items-center gap-1.5">
                          <select
                            value={row.stage}
                            onChange={(e) => moveStage(row, e.target.value as PipelineStage)}
                            className="gt-mono flex-1 rounded border border-[var(--gt-border)] bg-white px-1.5 py-1 text-[10.5px]"
                          >
                            {COLUMNS.map((c) => (
                              <option key={c.stage} value={c.stage}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          {row.stage_locked && (
                            <span
                              title="You set this stage. The agent can no longer change it."
                              className="gt-badge gt-badge-green"
                            >
                              locked
                            </span>
                          )}
                        </div>
                      </article>
                    ))}
                    {rows.length === 0 && (
                      <p className="gt-mono px-1 py-4 text-center text-[10.5px] text-[var(--gt-muted-soft)]">
                        empty
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="mt-8 border-t border-[var(--gt-border)] pt-4">
          <p className="gt-mono text-[10.5px] leading-relaxed text-[var(--gt-muted-soft)]">
            GroundTruth v1 · Smoove Visuals LLC · FAA Part 107 · Leads sourced from Mecklenburg
            County public permit records. Signal detection and outreach drafting use AI judgment;
            forecast lookup and the Gmail/Calendar handoff are deterministic.
          </p>
        </footer>
      </main>
    </div>
  );
}

/**
 * Every lead shows what the agent decided about it. A lead with no badge was
 * genuinely never processed — which is itself information, and distinct from
 * one that was reviewed and turned down (spec §11.3).
 */
function OutcomeBadge({ outcome }: { outcome?: string }) {
  if (!outcome) return <span className="gt-badge gt-badge-neutral">not yet run</span>;

  const map: Record<string, { label: string; cls: string; title: string }> = {
    signal_found: {
      label: 'drafted',
      cls: 'gt-badge-green',
      title: 'Signal found — outreach drafted and sent to the pipeline.',
    },
    capped: {
      label: 'held back by cap',
      cls: 'gt-badge-amber',
      title: 'Real signal, but ranked outside the daily cap. Nothing was drafted.',
    },
    no_signal: {
      label: 'declined',
      cls: 'gt-badge-neutral',
      title: 'The agent reviewed this lead and judged it not worth outreach.',
    },
    error: {
      label: 'errored',
      cls: 'gt-badge-amber',
      title: 'A step failed on this lead — see agent_runs.',
    },
  };

  const m = map[outcome];
  if (!m) return null;
  return (
    <span className={`gt-badge ${m.cls}`} title={m.title}>
      {m.label}
    </span>
  );
}

function Stat({
  label,
  value,
  accent,
  note,
}: {
  label: string;
  value: number;
  accent?: boolean;
  note?: string;
}) {
  return (
    <div className="gt-card px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <span
          className={`gt-title text-[24px] leading-none ${
            accent ? 'text-[var(--gt-blue)]' : 'text-[var(--gt-text)]'
          }`}
        >
          {value}
        </span>
        {note && (
          <span className="gt-mono text-[10px] text-[var(--gt-amber)]">{note}</span>
        )}
      </div>
      <div className="gt-section-label mt-1.5">{label}</div>
    </div>
  );
}
