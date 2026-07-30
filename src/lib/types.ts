// Shared domain types — mirrors supabase/schema.sql

export type PipelineStage = 'new_signal' | 'contacted' | 'scheduled' | 'completed';

export const PIPELINE_STAGES: PipelineStage[] = [
  'new_signal',
  'contacted',
  'scheduled',
  'completed',
];

export interface Lead {
  id: string;
  address: string;
  city: string;
  state: string | null;
  lat: number | null;
  lon: number | null;
  type: string | null;
  price: number | null;
  days_on_market: number | null;
  photo_count: number | null;
  notes: string | null;
  created_at: string;
  // Provenance + enrichment (county sweep — spec §12 Rhythm)
  source: string | null;
  source_ref: string | null;
  source_detail: Record<string, unknown> | null;
  /** Contact name — may be a builder or a listing agent; see contact_type. */
  listing_agent: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  /** 'builder' | 'listing_agent' | null */
  contact_type: string | null;
  /** URL the contact details were actually found at — no source, no contact. */
  contact_source: string | null;
  /**
   * Permits this owner of record filed in the county lookback window. 1
   * suggests a homeowner building their own house, 2+ suggests a builder.
   * Null means not yet counted, which is not the same as zero.
   */
  owner_permit_count: number | null;
  /** 'pending' | 'enriched' | 'insufficient_data' — never silently blank (§11.9). */
  enrichment_status: string | null;
  enrichment_notes: string | null;
  enriched_at: string | null;
}

export interface Signal {
  id: string;
  lead_id: string;
  signal: boolean;
  signal_type: string | null;
  confidence: number | null;
  reasoning: string | null;
  created_at: string;
}

export interface Draft {
  id: string;
  lead_id: string;
  signal_id: string | null;
  shot_list: string[];
  outreach_subject: string | null;
  outreach_body: string | null;
  /** Human-readable window, e.g. "Thursday, July 30, 2026, 6:45–8:15 PM…". */
  best_shoot_window: string | null;
  /** YYYY-MM-DD — machine-readable, drives the calendar hold. */
  shoot_date_iso: string | null;
  /** Full ISO with explicit Eastern offset, e.g. "2026-07-30T18:45:00-04:00". */
  shoot_start_iso: string | null;
  shoot_end_iso: string | null;
  /** Why the agent picked this window — light and wind, from real numbers. */
  time_rationale: string | null;
  created_at: string;
}

export interface PipelineEntry {
  id: string;
  lead_id: string;
  draft_id: string | null;
  stage: PipelineStage;
  /**
   * True once a human has changed the stage. The agent must never overwrite a
   * locked entry — enforced by the pipeline_guard trigger in schema.sql.
   * See spec Section 3 (governance rule) and Section 10 principle 3.
   */
  stage_locked: boolean;
  updated_at: string;
}

/** Reference data, not a prompt constant — see spec §5 / §11.4. */
export interface SignalType {
  code: string;
  label: string;
  description: string;
  active: boolean;
  sort_order: number;
}

/**
 * 'capped' is distinct from 'no_signal' — a lead that showed a real signal
 * but lost to the daily volume cap is a different honest outcome from one
 * the agent judged weak. Collapsing them would violate §11.3.
 */
export type AgentRunStatus = 'signal_found' | 'no_signal' | 'error' | 'capped';

/**
 * One row per agent run. Exists so "the agent ran and found nothing" is never
 * indistinguishable from "the agent broke" — spec §5 / §11.3.
 */
export interface AgentRun {
  id: string;
  lead_id: string | null;
  run_status: AgentRunStatus;
  step: string | null;
  error_detail: string | null;
  created_at: string;
}

// --- AI call result shapes -------------------------------------------------

/** Result of the signal-detection call. */
export interface SignalResult {
  signal: boolean;
  /** A code from signal_types, or 'none' when signal is false. */
  signalType: string;
  confidence: number;
  reasoning: string;
  /**
   * Facts that would have changed the answer but were not present in the
   * record. Makes missing data visible instead of silently guessed — §11.9.
   */
  dataGaps: string[];
}

/** Result of the weather / shoot-window lookup. */
export interface ShootWindow {
  /** YYYY-MM-DD. Validated server-side to fall within the next 7 days. */
  dateIso: string;
  date: string;
  conditions: string;
  windKmh: number;
  sunrise: string;
  sunset: string;
  /** 24-hour local start of the recommended flight window, e.g. "18:15". */
  startLocal: string;
  /** 24-hour local end, e.g. "20:00". */
  endLocal: string;
  /** Why this specific slot — light, wind, or sun angle. Shown to the user. */
  timeRationale: string;
}

/** Result of the draft-generation call. */
export interface DraftResult {
  shotList: string[];
  outreachSubject: string;
  outreachBody: string;
  bestShootWindow: string;
}
