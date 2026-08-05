/**
 * Normalize a calendar URL a user pasted into a usable iCal feed URL.
 *
 * Handles two common mistakes/variants:
 *  - webcal:// links  → https://
 *  - Google "add to my calendar" links (…/calendar/u/0?cid=BASE64) → the
 *    public iCal feed for that calendar. The cid is the base64-encoded
 *    calendar id; we decode it and build the /public/basic.ics URL.
 *
 * Anything we don't recognize is returned unchanged (trimmed).
 */
export function normalizeIcalUrl(raw: string): string {
  const url = raw.trim().replace(/^webcal:\/\//i, 'https://');
  try {
    const u = new URL(url);
    const isGoogle = /(?:^|\.)google\.com$/i.test(u.hostname);
    const cid = u.searchParams.get('cid');
    if (isGoogle && cid) {
      const calendarId = decodeCid(cid);
      if (calendarId && calendarId.includes('@')) {
        return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
      }
    }
  } catch {
    // Not a parseable URL — let validation handle it.
  }
  return url;
}

/** Decode a (possibly URL-safe) base64 cid into the calendar id. */
function decodeCid(cid: string): string | null {
  try {
    const b64 = cid.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    // A calendar id looks like an email address; guard against garbage.
    return /^[\x20-\x7e]+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
