import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { recordRun } from '@/lib/runs';
import { toEasternIso } from '@/lib/time';
import { runDraft } from '@/lib/agent-steps';
import { outreachPath } from '@/lib/outreach';
import type { Lead, Signal, ShootWindow, DraftResult, PipelineEntry } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Step 3 of the agent chain: shot list + outreach copy, then the handoff into
 * the pipeline.
 *
 * The pipeline insert is what Zapier's webhook watches (spec Section 3), so
 * this route is the transition point where a record becomes an active
 * outreach opportunity. Core drafting logic lives in lib/agent-steps.ts so
 * this route and the autonomous sweep share one implementation.
 */
export async function POST(req: Request) {
  let leadId: string | null = null;
  try {
    const parsed = (await req.json()) as {
      leadId?: string;
      signalId?: string;
      shootWindow?: ShootWindow;
    };
    const { signalId, shootWindow } = parsed;
    leadId = parsed.leadId ?? null;

    if (!leadId || !signalId || !shootWindow) {
      return NextResponse.json(
        { error: 'leadId, signalId and shootWindow are all required' },
        { status: 400 },
      );
    }

    // §11.9 in reverse: a caller passing a partial/error shootWindow object
    // (e.g. the shoot-window step declined for insufficientData) must not
    // silently produce a garbage timestamp in the database. Fail loudly here
    // instead of letting Postgres reject it with a confusing type error.
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(shootWindow.dateIso ?? '') ||
      !timeRe.test(shootWindow.startLocal ?? '') ||
      !timeRe.test(shootWindow.endLocal ?? '')
    ) {
      return NextResponse.json(
        {
          error:
            'shootWindow is missing a valid dateIso/startLocal/endLocal. Did the ' +
            'shoot-window step fail or return insufficientData? Do not proceed to drafting ' +
            'without a validated window.',
        },
        { status: 400 },
      );
    }

    const [{ data: lead }, { data: signal }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).single<Lead>(),
      supabase.from('signals').select('*').eq('id', signalId).single<Signal>(),
    ]);

    if (!lead || !signal) {
      return NextResponse.json({ error: 'Lead or signal not found' }, { status: 404 });
    }

    // --- Governance check (spec Section 3 / Section 10 principle 3) ---------
    // If a human has already moved this lead, do not re-trigger outreach on
    // it. The database trigger enforces this too; failing fast here gives a
    // clearer message and avoids spending tokens on a draft we would discard.
    const { data: existing } = await supabase
      .from('pipeline')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle<PipelineEntry>();

    if (existing?.stage_locked) {
      return NextResponse.json(
        {
          error:
            `This lead is locked at stage "${existing.stage}" by a human decision. ` +
            `The agent will not re-trigger outreach on it.`,
          stageLocked: true,
          stage: existing.stage,
        },
        { status: 409 },
      );
    }

    // --- Is there anyone to send this to? -----------------------------------
    // Checked BEFORE the model call, not after: drafting for a private
    // individual we have decided not to contact spends a request and then
    // leaves an unsendable draft (empty To: field) in a real inbox. The
    // manual "Run agent" path skips enrichment entirely, so without this it
    // would draft for anybody.
    const path = outreachPath(lead);
    if (!path.reachable) {
      await recordRun({
        leadId,
        status: 'no_signal',
        step: 'draft',
        errorDetail: path.reason,
      });
      return NextResponse.json(
        { error: path.reason, noOutreachPath: true },
        { status: 422 },
      );
    }

    const outcome = await runDraft(lead, signal, shootWindow);
    if ('refused' in outcome) {
      return NextResponse.json({ error: 'Model declined this request.' }, { status: 422 });
    }
    const result: DraftResult = outcome;

    const { data: draft, error: draftError } = await supabase
      .from('drafts')
      .insert({
        lead_id: lead.id,
        signal_id: signal.id,
        shot_list: result.shotList,
        outreach_subject: result.outreachSubject,
        outreach_body: result.outreachBody,
        best_shoot_window: result.bestShootWindow,
        // Machine-readable date/time for the calendar hold, taken from the
        // agent's own validated window choice — not a placeholder slot.
        // Explicit UTC offset (via toEasternIso) so Zapier/Google Calendar
        // never has to guess the timezone — a bare timestamp was landing an
        // hour off.
        shoot_date_iso: shootWindow.dateIso,
        shoot_start_iso: toEasternIso(shootWindow.dateIso, shootWindow.startLocal),
        shoot_end_iso: toEasternIso(shootWindow.dateIso, shootWindow.endLocal),
        time_rationale: shootWindow.timeRationale,
      })
      .select()
      .single();

    if (draftError) {
      return NextResponse.json(
        { error: `Failed to persist draft: ${draftError.message}` },
        { status: 500 },
      );
    }

    // --- The handoff: pipeline entry -> Supabase webhook -> Zapier ----------
    // Only ever create or refresh an unlocked entry. Never reset a stage.
    let pipelineEntry: PipelineEntry | null = null;

    if (existing) {
      const { data, error } = await supabase
        .from('pipeline')
        .update({ draft_id: draft.id })
        .eq('id', existing.id)
        .select()
        .single<PipelineEntry>();
      if (error) {
        return NextResponse.json(
          { error: `Failed to update pipeline entry: ${error.message}` },
          { status: 500 },
        );
      }
      pipelineEntry = data;
    } else {
      const { data, error } = await supabase
        .from('pipeline')
        .insert({ lead_id: lead.id, draft_id: draft.id, stage: 'new_signal' })
        .select()
        .single<PipelineEntry>();
      if (error) {
        return NextResponse.json(
          { error: `Failed to create pipeline entry: ${error.message}` },
          { status: 500 },
        );
      }
      pipelineEntry = data;
    }

    await recordRun({ leadId, status: 'signal_found', step: 'draft' });

    return NextResponse.json({ ...result, draftId: draft.id, pipeline: pipelineEntry });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun({ leadId, status: 'error', step: 'draft', errorDetail: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
