import { supabase } from '@/lib/supabase';
import type { AgentRunStatus, SignalType } from '@/lib/types';

/**
 * Record the outcome of an agent run.
 *
 * Spec §11.3: "nothing to report" must never look the same as "something
 * broke". Every route calls this on both success and failure paths, so a lead
 * the agent honestly declined is distinguishable from one it never processed.
 *
 * Deliberately swallows its own errors — a logging failure must not take down
 * the run it is trying to describe.
 */
export async function recordRun(args: {
  leadId: string | null;
  status: AgentRunStatus;
  step: string;
  errorDetail?: string | null;
}): Promise<void> {
  try {
    const { error } = await supabase.from('agent_runs').insert({
      lead_id: args.leadId,
      run_status: args.status,
      step: args.step,
      error_detail: args.errorDetail ?? null,
    });
    // Swallowing the failure is right — logging must never crash the run it
    // describes — but swallowing it *silently* hid a real bug once (the
    // 'capped' enum value hadn't committed, so six runs vanished with no
    // trace). Never fail loudly here; always leave a trace.
    if (error) {
      console.error(
        `[agent_runs] failed to record ${args.status}/${args.step}: ${error.message}`,
      );
    }
  } catch (err) {
    console.error(`[agent_runs] threw while recording ${args.status}/${args.step}:`, err);
  }
}

/**
 * Load the valid signal types from the database.
 *
 * Spec §11.4: reference values that will drift must not be hardcoded into a
 * prompt — a stale baked-in list is the first thing that breaks. Editing the
 * signal_types table changes agent behaviour with no code deploy.
 */
export async function loadSignalTypes(): Promise<SignalType[]> {
  const { data, error } = await supabase
    .from('signal_types')
    .select('*')
    .eq('active', true)
    .order('sort_order');

  if (error) throw new Error(`Could not load signal types: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('No active signal types configured — seed the signal_types table.');
  }
  return data as SignalType[];
}
