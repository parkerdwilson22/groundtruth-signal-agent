import { anthropic, MODEL } from '@/lib/anthropic';
import type { Lead, Signal, SignalType, SignalResult, ShootWindow, DraftResult } from '@/lib/types';

/**
 * The three core AI calls, extracted so both the interactive API routes and
 * the autonomous sweep call one implementation each — duplicating these
 * prompts across two call sites is exactly the drift Section 10 argues
 * against pruning toward.
 */

// --- Step 1: signal detection -----------------------------------------------

function signalSchema(codes: string[]) {
  return {
    type: 'object',
    properties: {
      signal: {
        type: 'boolean',
        description:
          'True only if this property is genuinely worth drone-photography outreach right now.',
      },
      signalType: {
        type: 'string',
        enum: [...codes, 'none'],
        description: 'The matching signal code, or "none" when signal is false.',
      },
      confidence: { type: 'number', description: 'Between 0 and 1.' },
      reasoning: {
        type: 'string',
        description: 'One or two sentences. State plainly why, including why not.',
      },
      dataGaps: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Facts that would have changed your answer but were absent from the record. Empty array if none.',
      },
    },
    required: ['signal', 'signalType', 'confidence', 'reasoning', 'dataGaps'],
    additionalProperties: false,
  } as const;
}

export async function runSignalDetection(
  lead: Lead,
  signalTypes: SignalType[],
): Promise<SignalResult | { refused: true }> {
  const catalogue = signalTypes.map((t) => `- ${t.code} — ${t.label}: ${t.description}`).join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: signalSchema(signalTypes.map((t) => t.code)) },
    },
    system:
      'You are a signal-detection analyst for GroundTruth, a licensed FAA Part 107 drone ' +
      'aerial photography company serving the Charlotte, NC metro area.\n\n' +
      'For every property record you receive, you must return ALL FIVE of the following, ' +
      'every time, with no exceptions:\n' +
      '  1. signal      — boolean\n' +
      '  2. signalType  — one of the valid codes below, or "none"\n' +
      '  3. confidence  — a number between 0 and 1\n' +
      '  4. reasoning   — one or two plain sentences\n' +
      '  5. dataGaps    — an array of facts you did not have (empty array if none)\n\n' +
      `Valid signal types:\n${catalogue}\n\n` +
      'RULES:\n' +
      '1. A clean negative is a valuable answer. If the evidence is weak, return ' +
      'signal: false with signalType "none" and say plainly why. Do NOT stretch toward a ' +
      'soft positive to seem useful — an honest miss costs less than a bad lead.\n' +
      '2. Never invent facts to fill a gap. If the record lacks something you would need ' +
      '(photo count, listing status, agent details), say so in dataGaps and lower your ' +
      'confidence. Do not produce an answer that merely sounds complete.\n' +
      '3. Confidence must reflect the evidence actually present, not how appealing the ' +
      'property is.',
    messages: [
      {
        role: 'user',
        content: `Property record:\n\n${JSON.stringify(
          {
            address: lead.address,
            city: lead.city,
            state: lead.state,
            type: lead.type,
            price: lead.price,
            daysOnMarket: lead.days_on_market,
            photoCount: lead.photo_count,
            listingAgent: lead.listing_agent ?? null,
            source: lead.source,
            notes: lead.notes,
          },
          null,
          2,
        )}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') return { refused: true };
  return JSON.parse(response.content.map((b) => ('text' in b ? b.text : '')).join('')) as SignalResult;
}

// --- Step 2: shoot window ---------------------------------------------------
// HARDENED OUT OF THIS FILE. The weather/shoot-window lookup used to be an AI
// call with web_search and lived here. Per spec §10.1 it is a data fetch, not
// a judgment call, so it now lives in lib/weather.ts as a deterministic
// Open-Meteo query. Deliberately not kept around as dead code (§10.6 —
// "prune, don't just launch").

// --- Step 3: shot list + outreach draft -------------------------------------

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    shotList: {
      type: 'array',
      items: { type: 'string' },
      description:
        '4 to 6 aerial shots, in real flight order (wide establishing, then orbit/approach, ' +
        'then a detail shot, then a golden-hour hero shot), each tied to the specific signal ' +
        'and the actual light at the recommended time.',
    },
    outreachSubject: { type: 'string', description: 'Email subject line.' },
    outreachBody: {
      type: 'string',
      description:
        'The email body: a greeting line, then 2-3 short paragraphs separated by blank ' +
        'lines, then a brief closing line. No signature — one is appended automatically.',
    },
    bestShootWindow: {
      type: 'string',
      description: 'Human-readable restatement of the recommended shoot window.',
    },
  },
  required: ['shotList', 'outreachSubject', 'outreachBody', 'bestShootWindow'],
  additionalProperties: false,
} as const;

export async function runDraft(
  lead: Lead,
  signal: Pick<Signal, 'signal_type' | 'confidence' | 'reasoning'>,
  shootWindow: ShootWindow,
): Promise<DraftResult | { refused: true }> {
  const contactType = lead.contact_type;
  const contactName = lead.listing_agent;

  const audience =
    contactType === 'builder'
      ? `You are writing to the BUILDER${contactName ? ` (${contactName})` : ''} who just ` +
        `completed this home. Frame it around their business: getting marketing media ready ` +
        `before the home lists, and the value of a repeat relationship across the homes they ` +
        `build. Do NOT write as though they are a listing agent selling one house.`
      : contactType === 'listing_agent'
        ? `You are writing to the LISTING AGENT${contactName ? ` (${contactName})` : ''} for ` +
          `this property. Frame it around the listing's performance.`
        : `You do not know who will receive this. Open with a neutral greeting (e.g. "Hi ` +
          `there,") and do NOT guess at a name, role, or company.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: DRAFT_SCHEMA },
    },
    system:
      'You draft outreach for GroundTruth, a licensed FAA Part 107 drone aerial photography ' +
      'company serving the Charlotte, NC metro area, operating under Smoove Visuals LLC.\n\n' +
      'You must return ALL FOUR of the following, every time:\n' +
      '  1. shotList        — 4 to 6 aerial shots, specific to THIS property\n' +
      '  2. outreachSubject — a subject line\n' +
      '  3. outreachBody    — see formatting rules below\n' +
      '  4. bestShootWindow — a plain restatement of the recommended window\n\n' +
      `WHO YOU ARE WRITING TO:\n${audience}\n\n` +
      'SHOT LIST — sequence it like a real flight plan, not a random list:\n' +
      '  1. A wide establishing shot first (orients the viewer to the property and street).\n' +
      '  2. Then an orbit, approach, or perimeter shot (shows the structure/lot from multiple ' +
      'angles).\n' +
      '  3. Then one detail shot addressing the SPECIFIC signal: for a stale or price-dropped ' +
      'listing, a shot that replaces its weakest existing photo; for no listing media, the ' +
      'shot that would matter most to a first-time viewer; for a builder audience, a shot that ' +
      'shows off finish quality or curb appeal they would want for their own portfolio.\n' +
      '  4. End with a golden-hour or dusk hero shot, and say WHY that specific time works ' +
      '(reference the actual sunset time and wind from the shoot window below, not generic ' +
      '"good lighting").\n' +
      '  Do not invent lot size, acreage, waterfront, or interior features not present in the ' +
      'property data below. A shot description should only reference what the record actually ' +
      'supports.\n\n' +
      'BODY FORMATTING — this is a real email a real person will open:\n' +
      '- Start with a greeting line on its own (e.g. "Hi Sarah," or "Hi there,").\n' +
      '- Then 2 to 3 SHORT paragraphs, each separated by a blank line (\\n\\n).\n' +
      '- Then a brief closing line (e.g. "Happy to send samples if useful.").\n' +
      '- Do NOT write a signature, name, phone number, website, or sign-off like "Best, ' +
      'Parker" — a verified signature is appended automatically. Anything you write there ' +
      'would be invented.\n' +
      '- No markdown, no bullet characters, no subject line inside the body.\n' +
      '- NEVER use em dashes or en dashes (— or –) anywhere in the subject, body, ' +
      'shot list, or shoot window text. They read as machine-written. Use a comma, ' +
      'a full stop, or restructure the sentence instead.\n\n' +
      'TONE: a working professional, not marketing copy. Specific and brief. Cite the ' +
      'concrete signal and the shoot window — never generic copy that could apply to any ' +
      'property.\n\n' +
      'NEVER invent details you were not given. Do not name a person, company, brokerage, ' +
      'feature, or measurement that does not appear in the data below. If a detail would ' +
      'strengthen the email but you do not have it, write around it rather than inventing ' +
      'it — this goes to a real recipient who will know immediately if you made something up.',
    messages: [
      {
        role: 'user',
        content:
          `Property:\n${JSON.stringify(
            {
              address: lead.address,
              city: lead.city,
              state: lead.state,
              type: lead.type,
              price: lead.price,
              daysOnMarket: lead.days_on_market,
              photoCount: lead.photo_count,
              notes: lead.notes,
            },
            null,
            2,
          )}\n\n` +
          `Detected signal:\n${JSON.stringify(
            {
              signalType: signal.signal_type,
              confidence: signal.confidence,
              reasoning: signal.reasoning,
            },
            null,
            2,
          )}\n\n` +
          `Best shoot window:\n${JSON.stringify(shootWindow, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') return { refused: true };
  return JSON.parse(response.content.map((b) => ('text' in b ? b.text : '')).join('')) as DraftResult;
}
