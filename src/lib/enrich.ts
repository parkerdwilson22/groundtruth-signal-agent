import { anthropic, MODEL, textOf, extractJson } from '@/lib/anthropic';
import { looksLikeCompany } from '@/lib/mecklenburg';
import type Anthropic from '@anthropic-ai/sdk';

export interface EnrichmentResult {
  status: 'enriched' | 'insufficient_data';
  /** 'builder' | 'listing_agent' | null — who the contact details belong to. */
  contactType: 'builder' | 'listing_agent' | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactSource: string | null;
  price: number | null;
  photoCount: number | null;
  daysOnMarket: number | null;
  notes: string;
}

/**
 * Step 0 of the sweep chain: find someone to actually contact about a
 * freshly-completed build.
 *
 * BUILDER-FIRST. A brand-new construction permit almost never has a listing
 * agent yet — that absence is the signal (spec §2), so searching for one is
 * usually a dead end. The county permit always names an owner of record,
 * which for new construction is typically the builder: a findable business
 * with public contact details, and a repeat customer rather than a one-off.
 * Falls back to a listing agent when the property genuinely is listed.
 *
 * §11.9: `insufficient_data` is a valid, common outcome. Never fabricate a
 * contact — a made-up email is worse than none, because it goes to a real
 * person under GroundTruth's name.
 */
export async function enrichAddress(args: {
  address: string;
  zipCode: string;
  ownerOfRecord?: string | null;
  ownerCity?: string | null;
  ownerState?: string | null;
}): Promise<EnrichmentResult> {
  const schema = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['enriched', 'insufficient_data'] },
      // An `enum` cannot sit alongside a nullable union type — the API
      // rejects it. anyOf expresses "one of these two, or null" correctly.
      contactType: {
        anyOf: [{ type: 'string', enum: ['builder', 'listing_agent'] }, { type: 'null' }],
      },
      contactName: { type: ['string', 'null'] },
      contactEmail: { type: ['string', 'null'] },
      contactPhone: { type: ['string', 'null'] },
      contactSource: {
        type: ['string', 'null'],
        description: 'The URL or source where you actually found the contact details.',
      },
      price: { type: ['number', 'null'] },
      photoCount: { type: ['number', 'null'] },
      daysOnMarket: { type: ['number', 'null'] },
      notes: {
        type: 'string',
        description: 'What you found or, if insufficient_data, plainly why not.',
      },
    },
    required: [
      'status',
      'contactType',
      'contactName',
      'contactEmail',
      'contactPhone',
      'contactSource',
      'price',
      'photoCount',
      'daysOnMarket',
      'notes',
    ],
    additionalProperties: false,
  } as const;

  const owner = args.ownerOfRecord;
  const isCompany = looksLikeCompany(owner ?? null);

  const prompt =
    `A new single-family home was just completed at:\n` +
    `Address: ${args.address}\nZIP: ${args.zipCode}\n` +
    (owner
      ? `Owner of record on the building permit: ${owner}` +
        (args.ownerCity ? ` (${args.ownerCity}, ${args.ownerState ?? ''})` : '') +
        `\n`
      : '') +
    `\nFind ONE contact worth reaching out to about aerial photography, in this priority order:\n\n` +
    (owner
      ? `1. THE BUILDER — the owner of record above` +
        (isCompany
          ? ` appears to be a company. Search for that company's website and published business ` +
            `contact details (email and/or phone). This is the highest-value target: a builder ` +
            `completes many homes a year, so they are a repeat client rather than a one-off.\n`
          : ` appears to be an individual, which may mean an owner-builder or a private ` +
            `residence. Only return their details if they are published as a BUSINESS contact ` +
            `(e.g. they run a construction company). Do NOT return a private individual's ` +
            `personal contact details scraped from people-search or data-broker sites.\n`)
      : '') +
    `${owner ? '2' : '1'}. THE LISTING AGENT — only if this property actually appears on the ` +
    `market. If it is listed, return the agent's published professional contact details and the ` +
    `listing's price, photo count, and days on market.\n\n` +
    `RULES:\n` +
    `- Return contactSource: the actual URL where you found the contact. If you cannot name a ` +
    `source, you do not have the contact.\n` +
    `- It is COMMON and EXPECTED for a brand-new build to have no listing and no findable ` +
    `contact. That is not a search failure — return status "insufficient_data" and say so ` +
    `plainly in notes.\n` +
    `- NEVER invent or guess an email address, phone number, or company. A fabricated contact ` +
    `sends a real cold email to a real person under a real business's name. An honest blank is ` +
    `always better.\n` +
    `- Only use published business contact information. Do not use people-search sites, data ` +
    `brokers, or any source offering private individuals' personal details.`;

  const searchTool = {
    type: 'web_search_20260318',
    name: 'web_search',
    max_uses: 4,
    response_inclusion: 'excluded',
  } as unknown as Anthropic.ToolUnion;

  const params = {
    model: MODEL,
    max_tokens: 6000,
    output_config: {
      effort: 'low' as const,
      format: { type: 'json_schema' as const, schema },
    },
    tools: [searchTool],
  };

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  let response = await anthropic.messages.create({ ...params, messages });

  let guard = 0;
  while (response.stop_reason === 'pause_turn' && guard++ < 5) {
    messages.push({ role: 'assistant', content: response.content });
    response = await anthropic.messages.create({ ...params, messages });
  }

  const blank: EnrichmentResult = {
    status: 'insufficient_data',
    contactType: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    contactSource: null,
    price: null,
    photoCount: null,
    daysOnMarket: null,
    notes: 'Model declined the enrichment request.',
  };

  if (response.stop_reason === 'refusal') return blank;

  const result = extractJson<EnrichmentResult>(textOf(response.content));

  // Enforce the source rule in code, not just in the prompt: a contact with
  // no named source is treated as not found.
  if (result.status === 'enriched' && !result.contactSource) {
    return {
      ...blank,
      notes:
        `Contact discarded — model returned details with no source URL. ` +
        `Original note: ${result.notes}`,
    };
  }

  // An enrichment that declared insufficient_data must not hand back facts
  // through the side door. It once returned a $1.65M "price" for a property
  // it admitted it could not find a listing for, and the caller stored it
  // over the real permit cost. If the lookup found nothing, it returns
  // nothing — §11.9 applies to every field, not just the contact.
  if (result.status === 'insufficient_data') {
    return {
      ...blank,
      notes: result.notes,
    };
  }

  return result;
}
