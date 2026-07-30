/**
 * Mecklenburg County Building Permits — public, no-auth ArcGIS FeatureServer.
 * Deterministic data fetch (spec §10.1: not a judgment call, no AI here).
 *
 * This is the closest public proxy for "certificate of occupancy just
 * issued": county permit records mark a completion date (compldate) when a
 * new-construction permit is finalized. It is not literally a CO record —
 * labelled as "permit completed" everywhere it surfaces, never claimed as CO.
 */

const FEATURE_SERVER =
  'https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0/query';

/**
 * Best-effort ZIP -> municipality for display/context only — never fed into
 * signal reasoning or outreach copy as a claimed fact, just a label. Falls
 * back to "Charlotte" (correct for most of the county) rather than
 * inventing a more specific guess.
 */
const ZIP_CITY: Record<string, string> = {
  '28078': 'Huntersville',
  '28079': 'Huntersville',
  '28031': 'Cornelius',
  '28036': 'Davidson',
  '28105': 'Matthews',
  '28104': 'Matthews',
  '28134': 'Pineville',
  '28227': 'Mint Hill',
  '28270': 'Charlotte',
};

export function cityForZip(zip: string): string {
  return ZIP_CITY[zip.slice(0, 5)] ?? 'Charlotte';
}

export interface PermitCompletion {
  /** Stable dedupe key — this permit's parcel ID. */
  parcelId: string;
  permitNumber: string;
  address: string;
  zipCode: string;
  completedOn: string; // YYYY-MM-DD
  buildingCost: number | null;
  totalSqft: number | null;
  lat: number;
  lon: number;
  /**
   * Owner of record on the permit. For new construction this is usually the
   * builder — present on 100% of records, unlike a listing agent, which does
   * not exist yet for an unlisted new build. Builders are also repeat
   * customers, so this is the better outreach target.
   */
  ownerOfRecord: string | null;
  ownerCity: string | null;
  ownerState: string | null;
}

/**
 * Heuristic: does the owner-of-record look like a company rather than an
 * individual? Used only to steer the enrichment search, never asserted as
 * fact in outreach copy.
 */
export function looksLikeCompany(name: string | null): boolean {
  if (!name) return false;
  return /\b(LLC|L\.L\.C|INC|CORP|CO|COMPANY|HOMES|BUILDERS?|CONSTRUCTION|DEVELOPMENT|GROUP|PROPERTIES|CUSTOM)\b/i.test(
    name,
  );
}

/** How far back to look when counting an owner's filing history. */
const OWNER_HISTORY_DAYS = 400;

/**
 * How many new-construction permits each owner of record has filed in roughly
 * the last year, keyed by lowercased owner name.
 *
 * This is the evidence the name pattern can't provide. `looksLikeCompany` can
 * only tell you whether someone wrote "LLC" on a form; it cannot distinguish a
 * one-man builder filing under his own name from a homeowner who built their
 * own house. Filing volume can: building houses for a living means filing
 * repeatedly, while building your own home is a once-in-a-decade event.
 *
 * Deterministic and free (the same public county feed), so it belongs in
 * software rather than being inferred by a model.
 */
export async function fetchOwnerPermitCounts(): Promise<Record<string, number>> {
  const params = new URLSearchParams({
    where:
      `typeofbldg='New Bldg' AND usdcdesc LIKE '101%' AND ` +
      `compldate > CURRENT_TIMESTAMP - INTERVAL '${OWNER_HISTORY_DAYS}' DAY`,
    outFields: 'ownname',
    returnGeometry: 'false',
    resultRecordCount: '4000',
    f: 'json',
  });

  const res = await fetch(`${FEATURE_SERVER}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Mecklenburg owner-history query failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`Mecklenburg owner-history query error: ${JSON.stringify(data.error)}`);
  }

  const counts: Record<string, number> = {};
  for (const f of (data.features ?? []) as { attributes: { ownname: string | null } }[]) {
    const name = f.attributes.ownname?.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!name) continue;
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/**
 * Does this owner look like they build for a living?
 *
 * A company-shaped name is sufficient on its own. For an individual name,
 * repeated filings are the tell — but a single filing is NOT proof of the
 * opposite, only weak evidence, so this returns the reasoning rather than a
 * bare boolean.
 */
export function classifyOwner(
  name: string | null,
  permitCount: number | null,
): { isBusiness: boolean; basis: string } {
  if (!name) {
    return { isBusiness: false, basis: 'No owner of record on the permit.' };
  }
  if (looksLikeCompany(name)) {
    const extra =
      permitCount && permitCount > 1
        ? ` Filed ${permitCount} new-construction permits in the last ${OWNER_HISTORY_DAYS} days.`
        : '';
    return {
      isBusiness: true,
      basis: `Company-shaped name.${extra}`,
    };
  }
  if (permitCount != null && permitCount > 1) {
    return {
      isBusiness: true,
      basis:
        `Individual name, but filed ${permitCount} new-construction permits in the last ` +
        `${OWNER_HISTORY_DAYS} days. Repeat filings indicate someone building to sell, ` +
        `not a homeowner.`,
    };
  }
  if (permitCount === 1) {
    return {
      isBusiness: false,
      basis:
        `Individual name with a single new-construction permit in the last ` +
        `${OWNER_HISTORY_DAYS} days, consistent with building their own home rather than ` +
        `building to sell.`,
    };
  }
  return {
    isBusiness: false,
    basis: 'Individual name; filing history not yet counted.',
  };
}

/**
 * New single-family completions in the last `lookbackDays`, above
 * `minCostUsd`. Ordered newest-first. No API key required.
 */
export async function fetchRecentCompletions(opts: {
  lookbackDays: number;
  minCostUsd: number;
  limit: number;
}): Promise<PermitCompletion[]> {
  const where =
    `typeofbldg='New Bldg' AND usdcdesc LIKE '101%' AND ` +
    `compldate > CURRENT_TIMESTAMP - INTERVAL '${opts.lookbackDays}' DAY AND ` +
    `bldgcost >= ${opts.minCostUsd}`;

  const params = new URLSearchParams({
    where,
    outFields:
      'projadd,zipcode,compldate,bldgcost,totalsqft,parcelnum,permitnum,ownname,owncity,ownstate',
    outSR: '4326',
    returnGeometry: 'true',
    orderByFields: 'compldate DESC',
    resultRecordCount: String(opts.limit),
    f: 'json',
  });

  const res = await fetch(`${FEATURE_SERVER}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Mecklenburg permits query failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`Mecklenburg permits query error: ${JSON.stringify(data.error)}`);
  }

  type Feature = {
    attributes: {
      projadd: string;
      zipcode: string;
      compldate: number;
      bldgcost: number | null;
      totalsqft: number | null;
      parcelnum: string;
      permitnum: string;
      ownname: string | null;
      owncity: string | null;
      ownstate: string | null;
    };
    geometry?: { x: number; y: number };
  };

  return ((data.features ?? []) as Feature[])
    .filter((f) => f.geometry)
    .map((f) => ({
      parcelId: f.attributes.parcelnum,
      permitNumber: f.attributes.permitnum,
      address: f.attributes.projadd.trim().replace(/\s+/g, ' '),
      zipCode: f.attributes.zipcode,
      completedOn: new Date(f.attributes.compldate).toISOString().slice(0, 10),
      buildingCost: f.attributes.bldgcost,
      totalSqft: f.attributes.totalsqft,
      lat: f.geometry!.y,
      lon: f.geometry!.x,
      ownerOfRecord: f.attributes.ownname?.trim().replace(/\s+/g, ' ') || null,
      ownerCity: f.attributes.owncity?.trim() || null,
      ownerState: f.attributes.ownstate?.trim() || null,
    }));
}
