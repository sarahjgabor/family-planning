import ical from 'node-ical';
import { db } from '../db.js';

// How far back / forward we expand recurring events when caching them.
// A family activity calendar rarely needs more than this, and each sync
// re-expands against the current date so the window stays fresh.
const PAST_WINDOW_DAYS = 90;
const FUTURE_WINDOW_DAYS = 400;

interface ParsedEvent {
  uid: string;
  // The base iCal UID shared by every occurrence of a series (equal to uid for
  // non-recurring events). Per-event child assignments are keyed on this so
  // assigning one occurrence of a repeat applies to the whole series.
  seriesUid: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
}

function isAllDay(date: unknown): boolean {
  return Boolean(date && typeof date === 'object' && (date as { dateOnly?: boolean }).dateOnly);
}

/** Format a Date for storage: date-only for all-day, full ISO otherwise. */
function formatDate(date: Date, allDay: boolean): string {
  if (allDay) {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  return date.toISOString();
}

/**
 * Expand a single VEVENT (which may be recurring) into concrete occurrences
 * that fall within [windowStart, windowEnd].
 */
function expandEvent(event: ical.VEvent, windowStart: Date, windowEnd: Date): ParsedEvent[] {
  const results: ParsedEvent[] = [];
  const allDay = isAllDay(event.start);
  const baseStart = event.start as Date;
  const baseEnd = (event.end as Date) ?? null;
  const durationMs = baseEnd ? baseEnd.getTime() - baseStart.getTime() : 0;

  const title = event.summary?.toString() ?? '(untitled)';
  const location = event.location?.toString() || null;
  const description = event.description?.toString() || null;
  const seriesUid = event.uid ?? `${title}-${baseStart.toISOString()}`;

  // Non-recurring: a single occurrence.
  if (!event.rrule) {
    if (baseStart >= windowStart && baseStart <= windowEnd) {
      results.push({
        uid: seriesUid,
        seriesUid,
        title,
        startAt: formatDate(baseStart, allDay),
        endAt: baseEnd ? formatDate(baseEnd, allDay) : null,
        allDay,
        location,
        description,
      });
    }
    return results;
  }

  // Recurring: expand occurrences within the window.
  const exdates: Record<string, Date> = (event.exdate as Record<string, Date>) ?? {};
  const overrides: Record<string, ical.VEvent> = (event.recurrences as Record<string, ical.VEvent>) ?? {};

  const occurrences = event.rrule.between(windowStart, windowEnd, true);
  for (const occurrence of occurrences) {
    const dateKey = occurrence.toISOString().slice(0, 10);

    // Skip cancelled occurrences (EXDATE).
    if (exdates[dateKey]) continue;

    // Apply a modified occurrence (RECURRENCE-ID override) if present.
    const override = overrides[dateKey];
    if (override) {
      const oStart = override.start as Date;
      const oEnd = (override.end as Date) ?? null;
      const oAllDay = isAllDay(override.start);
      results.push({
        uid: `${seriesUid}-${dateKey}`,
        seriesUid,
        title: override.summary?.toString() ?? title,
        startAt: formatDate(oStart, oAllDay),
        endAt: oEnd ? formatDate(oEnd, oAllDay) : null,
        allDay: oAllDay,
        location: override.location?.toString() || location,
        description: override.description?.toString() || description,
      });
      continue;
    }

    const occStart = occurrence;
    const occEnd = durationMs ? new Date(occStart.getTime() + durationMs) : null;
    results.push({
      uid: `${seriesUid}-${dateKey}`,
      seriesUid,
      title,
      startAt: formatDate(occStart, allDay),
      endAt: occEnd ? formatDate(occEnd, allDay) : null,
      allDay,
      location,
      description,
    });
  }
  return results;
}

const replaceEvents = db.transaction((feedId: number, events: ParsedEvent[]) => {
  db.prepare('DELETE FROM feed_events WHERE feed_id = ?').run(feedId);
  const insert = db.prepare(`
    INSERT INTO feed_events (feed_id, uid, series_uid, title, start_at, end_at, all_day, location, description)
    VALUES (@feedId, @uid, @seriesUid, @title, @startAt, @endAt, @allDay, @location, @description)
  `);
  for (const e of events) {
    insert.run({
      feedId,
      uid: e.uid,
      seriesUid: e.seriesUid,
      title: e.title,
      startAt: e.startAt,
      endAt: e.endAt,
      allDay: e.allDay ? 1 : 0,
      location: e.location,
      description: e.description,
    });
  }
});

/**
 * Fetch a single feed's iCal URL, parse it, expand recurrences, and replace
 * the cached feed_events for that feed. Records success/error on the feed row.
 */
export async function syncFeed(feed: { id: number; url: string }): Promise<{ ok: boolean; count?: number; error?: string }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - PAST_WINDOW_DAYS * 86_400_000);
  const windowEnd = new Date(now.getTime() + FUTURE_WINDOW_DAYS * 86_400_000);

  try {
    // Google's "secret address in iCal format" is served over https; some
    // hosts use webcal:// — normalize that to https for fetching.
    const url = feed.url.replace(/^webcal:\/\//i, 'https://');

    // Fetch the .ics ourselves (rather than node-ical's fromURL) so we can send
    // a browser-like User-Agent. Some hosts (e.g. behind Cloudflare, like
    // Sawyer) reject non-browser clients with a 403 otherwise.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let text: string;
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          // Present as a real browser: some feed hosts (Sawyer, other
          // Cloudflare-fronted sites) 403 requests that don't look like one.
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/calendar,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!res.ok) {
        throw new Error(`Request failed with status code ${res.status}`);
      }
      text = await res.text();
    } finally {
      clearTimeout(timeout);
    }
    const data = ical.parseICS(text);

    const parsed: ParsedEvent[] = [];
    for (const key of Object.keys(data)) {
      const component = data[key];
      if (component.type === 'VEVENT') {
        parsed.push(...expandEvent(component as ical.VEvent, windowStart, windowEnd));
      }
    }

    replaceEvents(feed.id, parsed);
    db.prepare('UPDATE feeds SET last_synced = datetime(\'now\'), last_error = NULL WHERE id = ?').run(feed.id);
    return { ok: true, count: parsed.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare('UPDATE feeds SET last_error = ? WHERE id = ?').run(message, feed.id);
    return { ok: false, error: message };
  }
}

/** Sync every subscribed feed. Used by the scheduler and manual refresh. */
export async function syncAllFeeds(): Promise<void> {
  const feeds = db.prepare('SELECT id, url FROM feeds').all() as { id: number; url: string }[];
  for (const feed of feeds) {
    await syncFeed(feed);
  }
}
