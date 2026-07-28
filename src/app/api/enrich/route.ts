import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { recordRun } from '@/lib/runs';
import { enrichAddress } from '@/lib/enrich';
import type { Lead } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Re-run enrichment on specific leads.
 *
 * Exists so a lead whose contact lookup came back empty can be retried
 * without re-sweeping the whole county — enrichment is the most expensive
 * step per lead, so retrying nine to fix one is real waste.
 */
export async function POST(req: Request) {
  try {
    const { leadIds } = (await req.json()) as { leadIds?: string[] };
    if (!leadIds?.length) {
      return NextResponse.json({ error: 'leadIds (array) is required' }, { status: 400 });
    }

    const results: {
      address: string;
      status: string;
      contactType: string | null;
      contactName: string | null;
      contactEmail: string | null;
      contactSource: string | null;
      notes: string;
    }[] = [];

    for (const leadId of leadIds) {
      const { data: lead, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single<Lead>();

      if (error || !lead) {
        results.push({
          address: leadId,
          status: 'error',
          contactType: null,
          contactName: null,
          contactEmail: null,
          contactSource: null,
          notes: `Lead not found: ${error?.message ?? leadId}`,
        });
        continue;
      }

      try {
        const detail = lead.source_detail as {
          zipCode?: string;
          ownerOfRecord?: string | null;
          ownerCity?: string | null;
          ownerState?: string | null;
        };

        const result = await enrichAddress({
          address: lead.address,
          zipCode: detail?.zipCode ?? '',
          ownerOfRecord: detail?.ownerOfRecord ?? null,
          ownerCity: detail?.ownerCity ?? null,
          ownerState: detail?.ownerState ?? null,
        });

        await supabase
          .from('leads')
          .update({
            listing_agent: result.contactName,
            agent_email: result.contactEmail,
            agent_phone: result.contactPhone,
            contact_type: result.contactType,
            contact_source: result.contactSource,
            price: result.price ?? lead.price,
            photo_count: result.photoCount,
            days_on_market: result.daysOnMarket ?? lead.days_on_market,
            enrichment_status: result.status,
            enrichment_notes: result.notes,
            enriched_at: new Date().toISOString(),
          })
          .eq('id', lead.id);

        results.push({
          address: lead.address,
          status: result.status,
          contactType: result.contactType,
          contactName: result.contactName,
          contactEmail: result.contactEmail,
          contactSource: result.contactSource,
          notes: result.notes,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordRun({ leadId: lead.id, status: 'error', step: 'enrich', errorDetail: message });
        results.push({
          address: lead.address,
          status: 'error',
          contactType: null,
          contactName: null,
          contactEmail: null,
          contactSource: null,
          notes: message,
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
