'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * The Surface pattern (spec §12): an autonomous run is invisible by nature —
 * nobody watches a cron job. This states plainly when the agent last worked
 * and what it decided, so the overnight run is evidenced rather than
 * asserted.
 *
 * Reads from latest_sweep_batch(), which groups runs by a real batch id
 * written during the sweep. An earlier version inferred the batch from
 * timestamps and reported numbers that never happened — a manual test near
 * the same time got counted as part of the sweep.
 *
 * Read-only. No model calls, no cost.
 */

interface Batch {
  batch: string;
  started_at: string;
  ended_at: string;
  drafted: number;
  capped: number;
  no_signal: number;
  errors: number;
}

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function LastSweep() {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [totalRuns, setTotalRuns] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: batchData }, { count }] = await Promise.all([
      supabase.rpc('latest_sweep_batch'),
      supabase.from('agent_runs').select('id', { count: 'exact', head: true }),
    ]);
    setTotalRuns(count ?? 0);
    const rows = (batchData ?? []) as Batch[];
    if (rows.length) setBatch(rows[0]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (loading || !batch) return null;

  const started = new Date(batch.started_at);
  const stamp = started.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const durationMin = Math.max(
    1,
    Math.round(
      (new Date(batch.ended_at).getTime() - started.getTime()) / 60000,
    ),
  );

  return (
    <section className="gt-card mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--gt-border)] bg-[var(--gt-blue-soft)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="gt-section-label" style={{ color: 'var(--gt-blue)' }}>
            Last automated sweep
          </span>
          <span className="gt-badge gt-badge-blue">{relativeTime(batch.started_at)}</span>
        </div>
        <span className="gt-mono text-[10.5px] text-[var(--gt-muted)]">
          {stamp} · ran {durationMin} min · {totalRuns} runs logged all-time
        </span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-[var(--gt-border)] sm:grid-cols-4">
        <Cell value={batch.drafted} label="Drafted for review" tone="good" />
        <Cell value={batch.capped} label="Held back by cap" />
        <Cell value={batch.no_signal} label="Declined — no signal" />
        <Cell value={batch.errors} label="Errors" tone={batch.errors > 0 ? 'bad' : undefined} />
      </div>

      <p className="border-t border-[var(--gt-border)] px-4 py-2 text-[11.5px] text-[var(--gt-muted)]">
        {batch.errors === 0
          ? 'Completed with no errors. '
          : `${batch.errors} step${batch.errors === 1 ? '' : 's'} errored. `}
        Ran unattended against Mecklenburg County permit records. Every outcome is logged
        separately, so “found nothing” is never mistaken for “broke”.
      </p>
    </section>
  );
}

function Cell({ value, label, tone }: { value: number; label: string; tone?: 'good' | 'bad' }) {
  const color =
    tone === 'good' ? 'var(--gt-green)' : tone === 'bad' ? 'var(--gt-red)' : 'var(--gt-text)';
  return (
    <div className="px-4 py-3">
      <div className="gt-title text-[20px] leading-none" style={{ color }}>
        {value}
      </div>
      <div className="gt-section-label mt-1.5">{label}</div>
    </div>
  );
}
