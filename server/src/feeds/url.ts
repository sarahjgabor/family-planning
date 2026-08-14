/**
 * Normalize a calendar URL a user pasted into a usable iCal feed URL.
 *
 * Handles the common variants people paste instead of the raw .ics feed:
 *  - webcal:// links                              → https://
 *  - a bare Google Calendar ID (…@…google.com)    → its public iCal feed
 *  - "Add to my calendar" links (…?cid=BASE64)    → its public iCal feed
 *  - "Public URL"/embed links (…/embed?src=ID)    → its public iCal feed
 *
 * The last three cover Google's "Integrate calendar" panel, including
 * "From URL" (@import.calendar.google.com) calendars, which only expose a
 * Calendar ID and Public URL — never a "Secret address".
 *
 * Anything we don't recognize is returned unchanged (trimmed).
 */
export function normalizeIcalUrl(raw: string): string {
  const trimmed = raw.trim();

  // A bare calendar id pasted on its own, e.g.
  // "abc123@group.calendar.google.com" or "…@import.calendar.google.com".
  if (!/:\/\//.test(trimmed) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return icalFeedUrl(trimmed);
  }

  const url = trimmed.replace(/^webcal:\/\//i, 'https://');
  try {
    const u = new URL(url);
    if (/(?:^|\.)google\.com$/i.test(u.hostname)) {
      // "Add to my calendar" link: cid is the base64-encoded calendar id.
      const cid = u.searchParams.get('cid');
      if (cid) {
        const id = decodeCid(cid);
        if (id && id.includes('@')) return icalFeedUrl(id);
      }
      // "Public URL"/embed code: src is the (url-encoded) calendar id.
      const src = u.searchParams.get('src');
      if (src && src.includes('@')) return icalFeedUrl(src);
    }
  } catch {
    // Not a parseable URL — let validation handle it.
  }
  return url;
}

/** Build the public iCal feed URL for a Google calendar id. */
function icalFeedUrl(calendarId: string): string {
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
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
