import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { recordRun, loadSignalTypes } from '@/lib/runs';
import { runSignalDetection } from '@/lib/agent-steps';
import type { Lead, SignalResult } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * Step 1 of the agent chain: signal detection.
 *
 * Stays agentic (§10.1) — reading whether a record represents a real
 * opportunity is judgment, not a data fetch. Core logic lives in
 * lib/agent-steps.ts so the interactive route and the autonomous sweep
 * (api/sweep) share one implementation.
 */
export async function POST(req: Request) {
  let leadId: string | null = null;

  try {
    const body = (await req.json()) as { leadId?: string };
    leadId = body.leadId ?? null;
    if (!leadId) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
    }

    const [{ data: lead, error: leadError }, signalTypes] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).single<Lead>(),
      loadSignalTypes(),
    ]);

    if (leadError || !lead) {
      await recordRun({
        leadId,
        status: 'error',
        step: 'signal',
        errorDetail: `Lead not found: ${leadError?.message ?? leadId}`,
      });
      return NextResponse.json({ error: `Lead not found: ${leadId}` }, { status: 404 });
    }

    const outcome = await runSignalDetection(lead, signalTypes);
    if ('refused' in outcome) {
      await recordRun({
        leadId,
        status: 'error',
        step: 'signal',
        errorDetail: 'Model declined the request.',
      });
      return NextResponse.json({ error: 'Model declined this request.' }, { status: 422 });
    }
    const result: SignalResult = outcome;

    const { data: signal, error: insertError } = await supabase
      .from('signals')
      .insert({
        lead_id: lead.id,
        signal: result.signal,
        signal_type: result.signalType,
        confidence: result.confidence,
        reasoning: result.reasoning,
      })
      .select()
      .single();

    if (insertError) {
      await recordRun({
        leadId,
        status: 'error',
        step: 'signal',
        errorDetail: `Persist failed: ${insertError.message}`,
      });
      return NextResponse.json(
        { error: `Failed to persist signal: ${insertError.message}` },
        { status: 500 },
      );
    }

    // A clean "no signal" is a successful run, not a failure.
    await recordRun({
      leadId,
      status: result.signal ? 'signal_found' : 'no_signal',
      step: 'signal',
    });

    return NextResponse.json({ ...result, signalId: signal.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun({ leadId, status: 'error', step: 'signal', errorDetail: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
