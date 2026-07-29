/**
 * Convert a naive Eastern-local date + 24h time into a fully-qualified
 * ISO 8601 string with an explicit UTC offset, e.g. "2026-07-30T18:45:00-04:00".
 *
 * GroundTruth operates exclusively in the Charlotte, NC metro (America/
 * New_York). Sending Zapier/Google Calendar a bare timestamp with no offset
 * left it to guess the zone — it guessed wrong by an hour. An explicit offset
 * removes the ambiguity, and correctly accounts for DST (EDT vs EST) rather
 * than hardcoding one or the other.
 */
export function toEasternIso(dateIso: string, hhmm: string): string {
  // Anchor as UTC purely to ask "what offset does America/New_York use on
  // this calendar date" — DST status depends on the date, not the precise
  // instant, so this guess is safe even before it's offset-correct.
  const guess = new Date(`${dateIso}T${hhmm}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  }).formatToParts(guess);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  const match = tzName.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  const hours = match ? parseInt(match[1], 10) : -5;
  const minutes = match?.[2] ? parseInt(match[2], 10) : 0;
  const sign = hours < 0 ? '-' : '+';
  const hh = String(Math.abs(hours)).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${dateIso}T${hhmm}:00${sign}${hh}:${mm}`;
}

/**
 * "18:42" -> "6:42 PM". The weather step works internally in 24-hour time,
 * but a drafted email is read by a real person — a cold email that says
 * "between 18:42 and 20:12" reads as machine output. Converted here,
 * deterministically, rather than asked of the model: the model was handed
 * the raw 24-hour values and echoed them verbatim, since nothing told it to
 * do otherwise. Formatting is a plain transformation with one right answer,
 * not a judgment call.
 */
export function to12Hour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}
