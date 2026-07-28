import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { recordRun } from '@/lib/runs';
import { fetchShootWindow } from '@/lib/weather';
import type { Lead } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * Step 2 of the agent chain: best shoot window.
 *
 * HARDENED (spec §10.1). This used to be an AI call with the web_search
 * tool; it is now a deterministic Open-Meteo fetch plus a scoring function.
 * "It's not really a judgment call, it's a data fetch." See lib/weather.ts
 * for the full reasoning and the scoring weights.
 */
export async function POST(req: Request) {
  let leadId: string | null = null;
  try {
    const body = (await req.json()) as { leadId?: string };
    leadId = body.leadId ?? null;
    if (!leadId) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
    }

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single<Lead>();

    if (leadError || !lead) {
      return NextResponse.json(
        { error: `Lead not found: ${leadError?.message ?? leadId}` },
        { status: 404 },
      );
    }

    if (lead.lat == null || lead.lon == null) {
      return NextResponse.json(
        { error: `Lead ${lead.address} has no coordinates to look up a forecast for.` },
        { status: 422 },
      );
    }

    const outcome = await fetchShootWindow(lead.lat, lead.lon);

    if ('insufficientData' in outcome) {
      await recordRun({
        leadId,
        status: 'error',
        step: 'shoot-window',
        errorDetail: outcome.reason,
      });
      return NextResponse.json(
        { error: outcome.reason, insufficientData: true },
        { status: 422 },
      );
    }

    return NextResponse.json(outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun({ leadId, status: 'error', step: 'shoot-window', errorDetail: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
