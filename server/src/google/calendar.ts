import type { ParsedEvent } from '../feeds/types.js';
import { getAccountById, getValidAccessToken, type GoogleAccount } from './oauth.js';

const API = 'https://www.googleapis.com/calendar/v3';

/** Pull Google's human-readable reason out of an error response body. */
async function googleError(res: Response, label: string): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
    const reason = body.error?.errors?.[0]?.reason;
    detail = body.error?.message ? ` — ${body.error.message}` : '';
    if (reason === 'accessNotConfigured') {
      detail = ' — the Google Calendar API isn’t enabled on your Google Cloud project. Enable it, wait a minute, and try again.';
    }
  } catch {
    /* body wasn't JSON */
  }
  return new Error(`${label} (${res.status})${detail}`);
}

export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  backgroundColor: string | null;
  primary: boolean;
}

interface GoogleApiEvent {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

/** List the calendars the connected account can read, for the add-calendar picker. */
export async function listGoogleCalendars(account: GoogleAccount): Promise<GoogleCalendarSummary[]> {
  const token = await getValidAccessToken(account);
  const res = await fetch(`${API}/users/me/calendarList?minAccessRole=reader&maxResults=250`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await googleError(res, 'Google calendar list failed');
  const data = (await res.json()) as {
    items?: Array<{ id: string; summary: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean }>;
  };
  return (data.items ?? []).map((i) => ({
    id: i.id,
    summary: i.summaryOverride || i.summary,
    backgroundColor: i.backgroundColor ?? null,
    primary: Boolean(i.primary),
  }));
}

function mapEvent(item: GoogleApiEvent): ParsedEvent | null {
  if (item.status === 'cancelled') return null;
  const startRaw = item.start?.dateTime ?? item.start?.date;
  if (!startRaw) return null;
  const endRaw = item.end?.dateTime ?? item.end?.date ?? null;
  const allDay = Boolean(item.start?.date);
  return {
    uid: item.id,
    // iCalUID is shared across every instance of a recurring series, so
    // assigning a child to one occurrence applies to the whole series.
    seriesUid: item.iCalUID || item.id,
    title: item.summary || '(no title)',
    startAt: allDay ? startRaw.slice(0, 10) : new Date(startRaw).toISOString(),
    endAt: endRaw ? (allDay ? endRaw.slice(0, 10) : new Date(endRaw).toISOString()) : null,
    allDay,
    location: item.location || null,
    description: item.description || null,
  };
}

/**
 * Read events from a Google calendar via the API. singleEvents=true expands
 * recurring events into individual occurrences, so no manual rrule handling.
 */
export async function fetchGoogleCalendarEvents(
  accountId: number | null,
  calendarId: string | null,
  windowStart: Date,
  windowEnd: Date,
): Promise<ParsedEvent[]> {
  if (!accountId || !calendarId) throw new Error('This Google calendar is missing its link');
  const account = getAccountById(accountId);
  if (!account) throw new Error('Google account is no longer connected — reconnect it in Manage.');

  const token = await getValidAccessToken(account);
  const events: ParsedEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      maxResults: '2500',
      showDeleted: 'false',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`${API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await googleError(res, 'Google events fetch failed');
    const data = (await res.json()) as { items?: GoogleApiEvent[]; nextPageToken?: string };
    for (const item of data.items ?? []) {
      const mapped = mapEvent(item);
      if (mapped) events.push(mapped);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}
