import { looksLikeCompany } from '@/lib/mecklenburg';
import type { Lead } from '@/lib/types';

/**
 * Is there any realistic path to contacting this lead?
 *
 * Drafting outreach is only worth doing if it could actually be sent. Three
 * cases:
 *
 *   - A verified contact exists            -> send it.
 *   - The permit owner is a company        -> a manual lookup (the county
 *                                             builders' association, the
 *                                             company site) will find someone,
 *                                             so a draft is worth having ready.
 *   - The permit owner is an individual    -> we have deliberately decided not
 *     and no contact was found                to pursue a private person's
 *                                             personal contact details, so a
 *                                             draft would be written for
 *                                             someone we are never going to
 *                                             email.
 *
 * The third case used to still produce a draft, a pipeline row, and a Gmail
 * draft with an empty To: field. That is worse than doing nothing: it spends
 * a model call, then leaves an unsendable artifact in a real inbox.
 */
export function outreachPath(lead: {
  agent_email?: string | null;
  source_detail?: Lead['source_detail'];
}): { reachable: true } | { reachable: false; reason: string } {
  if (lead.agent_email) return { reachable: true };

  const owner = (lead.source_detail as { ownerOfRecord?: string | null } | null)?.ownerOfRecord
    ?.trim();

  if (owner && looksLikeCompany(owner)) return { reachable: true };

  if (owner) {
    return {
      reachable: false,
      reason:
        `Permit owner "${owner}" appears to be a private individual, and no business ` +
        `contact was found. Skipping outreach: the agent does not pursue a private ` +
        `person's personal contact details, so a draft here could never be sent.`,
    };
  }

  return {
    reachable: false,
    reason: 'No permit owner on record and no contact found, so there is no one to reach.',
  };
}
