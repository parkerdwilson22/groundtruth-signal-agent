import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { recordRun, loadSignalTypes } from '@/lib/runs';
import { runSignalDetection, runDraft } from '@/lib/agent-steps';
import { fetchShootWindow } from '@/lib/weather';
import { enrichAddress } from '@/lib/enrich';
import { fetchRecentCompletions, cityForZip } from '@/lib/mecklenburg';
import { toEasternIso } from '@/lib/time';
import type { Lead, SignalResult } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SOURCE = 'mecklenburg_permits';
const LOOKBACK_DAYS = 14;
const MIN_COST_USD = 300_000;
const FETCH_LIMIT = 20;

/**
 * The Rhythm pattern (spec §12): a scheduled sweep of a real public data
 * source, completing the loop this build was otherwise missing — everything
 * else in the app waits for a lead to already exist. Deterministic data
 * fetch + AI judgment layered on top, same three-step chain as the
 * interactive flow, just triggered by a clock instead of a click.
 *
 * Runs to completion autonomously, including the Zapier handoff — safe
 * specifically because that handoff ends in a Gmail *draft* and a
 * *tentative* calendar hold, never a send or a confirmed booking (§11.6:
 * automate the busywork, never the one action that can't be undone).
 *
 * Protected by a shared secret in production (Vercel Cron sets this header);
 * open in local dev when CRON_SECRET isn't configured.
 */
export async function POST(req: Request) {
  // Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>` when
  // that env var is set on the project — no custom header wiring needed.
  const requiredSecret = process.env.CRON_SECRET;
  if (requiredSecret) {
    const provided = req.headers.get('authorization');
    if (provided !== `Bearer ${requiredSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const summary = {
    swept: 0,
    newLeads: 0,
    enriched: 0,
    insufficientEnrichment: 0,
    signalFound: 0,
    noSignal: 0,
    capped: 0,
    errors: 0,
    processed: [] as { address: string; outcome: string; outreachSubject?: string }[],
  };

  try {
    const [cap, signalTypes, { data: existingRefs }] = await Promise.all([
      supabase.rpc('get_daily_lead_cap').then((r) => r.data as number),
      loadSignalTypes(),
      supabase.from('leads').select('source_ref').eq('source', SOURCE),
    ]);

    const knownRefs = new Set((existingRefs ?? []).map((r) => r.source_ref));

    const completions = await fetchRecentCompletions({
      lookbackDays: LOOKBACK_DAYS,
      minCostUsd: MIN_COST_USD,
      limit: FETCH_LIMIT,
    });
    summary.swept = completions.length;

    const fresh = completions.filter((c) => !knownRefs.has(c.parcelId));

    // --- Insert as new leads (deterministic — no AI judgment here) ----------
    const newLeads: Lead[] = [];
    for (const c of fresh) {
      const { data: inserted, error } = await supabase
        .from('leads')
        .insert({
          address: c.address,
          city: cityForZip(c.zipCode),
          state: 'NC',
          lat: c.lat,
          lon: c.lon,
          type: 'New construction (county permit)',
          price: c.buildingCost,
          days_on_market: 0,
          photo_count: null,
          notes:
            `New single-family construction permit completed ${c.completedOn}` +
            (c.totalSqft ? `, ${c.totalSqft.toLocaleString()} sq ft` : '') +
            `. Source: Mecklenburg County permit records (permit ${c.permitNumber}).`,
          source: SOURCE,
          source_ref: c.parcelId,
          source_detail: c,
          enrichment_status: 'pending',
        })
        .select()
        .single<Lead>();

      if (error) {
        // Race with a concurrent sweep or a genuine DB error — either way,
        // don't let one bad insert kill the whole run.
        await recordRun({ leadId: null, status: 'error', step: 'sweep-insert', errorDetail: error.message });
        summary.errors++;
        continue;
      }
      newLeads.push(inserted);
    }
    summary.newLeads = newLeads.length;

    // --- Enrich each new lead (AI + web search, honest insufficient-data) ---
    for (const lead of newLeads) {
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

        if (result.status === 'enriched') summary.enriched++;
        else summary.insufficientEnrichment++;

        // Reflect enrichment into our in-memory copy for the signal step below.
        Object.assign(lead, {
          listing_agent: result.contactName,
          agent_email: result.contactEmail,
          contact_type: result.contactType,
          contact_source: result.contactSource,
          photo_count: result.photoCount,
          days_on_market: result.daysOnMarket ?? lead.days_on_market,
          price: result.price ?? lead.price,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordRun({ leadId: lead.id, status: 'error', step: 'enrich', errorDetail: message });
        summary.errors++;
      }
    }

    // --- Signal detection on every new lead — judgment, not a data fetch ----
    const candidates: { lead: Lead; signal: SignalResult; signalId: string }[] = [];
    for (const lead of newLeads) {
      try {
        const outcome = await runSignalDetection(lead, signalTypes);
        if ('refused' in outcome) {
          await recordRun({ leadId: lead.id, status: 'error', step: 'signal', errorDetail: 'Model declined.' });
          summary.errors++;
          continue;
        }

        const { data: signalRow, error } = await supabase
          .from('signals')
          .insert({
            lead_id: lead.id,
            signal: outcome.signal,
            signal_type: outcome.signalType,
            confidence: outcome.confidence,
            reasoning: outcome.reasoning,
          })
          .select()
          .single();

        if (error) throw new Error(`Persist signal failed: ${error.message}`);

        if (outcome.signal) {
          candidates.push({ lead, signal: outcome, signalId: signalRow.id });
        } else {
          await recordRun({ leadId: lead.id, status: 'no_signal', step: 'signal' });
          summary.noSignal++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordRun({ leadId: lead.id, status: 'error', step: 'signal', errorDetail: message });
        summary.errors++;
      }
    }

    // --- Rank by confidence, take the top N, cap the rest -------------------
    candidates.sort((a, b) => b.signal.confidence - a.signal.confidence);
    const toProcess = candidates.slice(0, cap);
    const overflow = candidates.slice(cap);

    for (const { lead } of overflow) {
      await recordRun({
        leadId: lead.id,
        status: 'capped',
        step: 'signal',
        errorDetail: `Real signal, but ranked outside today's cap of ${cap}.`,
      });
      summary.capped++;
    }

    // --- Full chain for the top N — this is what reaches Zapier -------------
    for (const { lead, signal, signalId } of toProcess) {
      try {
        if (lead.lat == null || lead.lon == null) {
          await recordRun({
            leadId: lead.id,
            status: 'error',
            step: 'shoot-window',
            errorDetail: 'Lead has no coordinates.',
          });
          summary.errors++;
          continue;
        }

        const win = await fetchShootWindow(lead.lat, lead.lon);
        if ('insufficientData' in win) {
          await recordRun({
            leadId: lead.id,
            status: 'error',
            step: 'shoot-window',
            errorDetail: win.reason,
          });
          summary.errors++;
          continue;
        }

        const draftOutcome = await runDraft(
          lead,
          {
            signal_type: signal.signalType,
            confidence: signal.confidence,
            reasoning: signal.reasoning,
          },
          win,
        );
        if ('refused' in draftOutcome) {
          await recordRun({ leadId: lead.id, status: 'error', step: 'draft', errorDetail: 'Model declined.' });
          summary.errors++;
          continue;
        }

        const { data: draft, error: draftError } = await supabase
          .from('drafts')
          .insert({
            lead_id: lead.id,
            signal_id: signalId,
            shot_list: draftOutcome.shotList,
            outreach_subject: draftOutcome.outreachSubject,
            outreach_body: draftOutcome.outreachBody,
            best_shoot_window: draftOutcome.bestShootWindow,
            shoot_date_iso: win.dateIso,
            shoot_start_iso: toEasternIso(win.dateIso, win.startLocal),
            shoot_end_iso: toEasternIso(win.dateIso, win.endLocal),
            time_rationale: win.timeRationale,
          })
          .select()
          .single();

        if (draftError) throw new Error(`Persist draft failed: ${draftError.message}`);

        // Fires the Supabase -> Zapier webhook (spec §3).
        const { error: pipelineError } = await supabase
          .from('pipeline')
          .insert({ lead_id: lead.id, draft_id: draft.id, stage: 'new_signal' });
        if (pipelineError) throw new Error(`Pipeline insert failed: ${pipelineError.message}`);

        await recordRun({ leadId: lead.id, status: 'signal_found', step: 'sweep-draft' });
        summary.signalFound++;
        summary.processed.push({
          address: lead.address,
          outcome: 'drafted',
          outreachSubject: draftOutcome.outreachSubject,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordRun({ leadId: lead.id, status: 'error', step: 'sweep-draft', errorDetail: message });
        summary.errors++;
      }
    }

    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun({ leadId: null, status: 'error', step: 'sweep', errorDetail: message });
    return NextResponse.json({ error: message, ...summary }, { status: 500 });
  }
}
