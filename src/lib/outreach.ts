import { classifyOwner } from '@/lib/mecklenburg';
import type { Lead } from '@/lib/types';

/**
 * Is there any realistic path to contacting this lead?
 *
 * Drafting outreach is only worth doing if it could actually be sent. Three
 * cases:
 *
 *   - A verified contact exists            -> send it.
 *   - The owner builds for a living        -> a manual lookup (the county
 *                                             builders' association, the
 *                                             company site) will find someone,
 *                                             so a draft is worth having ready.
 *   - The owner built their own home       -> we have deliberately decided not
 *     and no contact was found                to pursue a private person's
 *                                             personal contact details, so a
 *                                             draft would be written for
 *                                             someone we are never going to
 *                                             email.
 *
 * The third case used to still produce a draft, a pipeline row, and a Gmail
 * draft with an empty To: field. That is worse than doing nothing: it spends
 * a model call, then leaves an unsendable artifact in a real inbox.
 *
 * "Builds for a living" is decided by classifyOwner, which uses the owner's
 * permit filing history rather than the shape of their name alone — so a
 * one-man builder filing under his own name is not mistaken for a homeowner.
 */
export function outreachPath(lead: {
  agent_email?: string | null;
  owner_permit_count?: number | null;
  source_detail?: Lead['source_detail'];
}): { reachable: true; basis: string } | { reachable: false; reason: string } {
  const owner = (lead.source_detail as { ownerOfRecord?: string | null } | null)?.ownerOfRecord
    ?.trim() ?? null;
  const { isBusiness, basis } = classifyOwner(owner, lead.owner_permit_count ?? null);

  if (lead.agent_email) {
    return { reachable: true, basis: 'A verified contact is already on file.' };
  }

  if (isBusiness) return { reachable: true, basis };

  if (owner) {
    return {
      reachable: false,
      reason:
        `Permit owner "${owner}" looks like a private individual, and no business contact ` +
        `was found. ${basis} Skipping outreach: the agent does not pursue a private ` +
        `person's personal contact details, so a draft here could never be sent.`,
    };
  }

  return {
    reachable: false,
    reason: 'No permit owner on record and no contact found, so there is no one to reach.',
  };
}
