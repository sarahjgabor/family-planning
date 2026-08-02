import { db } from '../db.js';

const DEFAULT_LOCAL_COLOR = '#6366f1';
const WEEK_MS = 7 * 86_400_000;

export interface MergedEvent {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  color: string;
  editable: boolean;
  recurring: boolean;
  extendedProps: {
    source: 'local' | 'feed';
    childId: number | null;
    childName: string | null;
    location: string | null;
    notes: string | null;
    feedLabel: string | null;
    recurrence: 'weekly' | null;
    recurrenceUntil: string | null;
  };
}

interface LocalRow {
  id: number;
  title: string;
  start_at: string;
  end_at: string | null;
  all_day: number;
  location: string | null;
  notes: string | null;
  recurrence: string | null;
  recurrence_until: string | null;
  child_id: number | null;
  child_name: string | null;
  child_color: string | null;
}

/** Add `weeks` weeks to an ISO datetime or a YYYY-MM-DD date, preserving format. */
function addWeeks(value: string, weeks: number, allDay: boolean): string {
  if (allDay) {
    // Work in UTC noon to avoid any daylight-saving edge cases shifting the day.
    const d = new Date(`${value.slice(0, 10)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + weeks * 7);
    return d.toISOString().slice(0, 10);
  }
  return new Date(new Date(value).getTime() + weeks * WEEK_MS).toISOString();
}

/**
 * Expand one local event into the occurrences that fall inside [start, end].
 * Non-recurring events yield at most one; weekly events yield each occurrence
 * from their start through recurrence_until (inclusive).
 */
function expandLocal(row: LocalRow, windowStart: string, windowEnd: string): MergedEvent[] {
  const allDay = Boolean(row.all_day);
  const color = row.child_color ?? DEFAULT_LOCAL_COLOR;
  const base: Omit<MergedEvent, 'id' | 'start' | 'end'> = {
    title: row.title,
    allDay,
    color,
    editable: true,
    recurring: Boolean(row.recurrence),
    extendedProps: {
      source: 'local',
      childId: row.child_id,
      childName: row.child_name,
      location: row.location,
      notes: row.notes,
      feedLabel: null,
      recurrence: row.recurrence === 'weekly' ? 'weekly' : null,
      recurrenceUntil: row.recurrence_until,
    },
  };

  if (row.recurrence !== 'weekly' || !row.recurrence_until) {
    // One-off event: include it if it overlaps the window.
    const effectiveEnd = row.end_at ?? row.start_at;
    if (row.start_at < windowEnd && effectiveEnd >= windowStart) {
      return [{ ...base, id: `local-${row.id}`, start: row.start_at, end: row.end_at }];
    }
    return [];
  }

  // Weekly series: step from the start date one week at a time.
  const durationMs =
    !allDay && row.end_at ? new Date(row.end_at).getTime() - new Date(row.start_at).getTime() : 0;
  const untilExclusive = `${row.recurrence_until}T23:59:59.999Z`;
  const occurrences: MergedEvent[] = [];

  for (let week = 0; week < 520; week++) {
    const occStart = addWeeks(row.start_at, week, allDay);
    if (occStart > untilExclusive) break;
    if (occStart >= windowEnd) break;

    let occEnd: string | null = null;
    if (allDay) {
      occEnd = row.end_at ? addWeeks(row.end_at, week, true) : null;
    } else if (durationMs) {
      occEnd = new Date(new Date(occStart).getTime() + durationMs).toISOString();
    }

    const effectiveEnd = occEnd ?? occStart;
    if (occStart < windowEnd && effectiveEnd >= windowStart) {
      const dateKey = occStart.slice(0, 10).replace(/-/g, '');
      occurrences.push({ ...base, id: `local-${row.id}-${dateKey}`, start: occStart, end: occEnd });
    }
  }
  return occurrences;
}

/**
 * Returns every event (locally-added, including expanded weekly series, plus
 * imported feed events) that overlaps [windowStart, windowEnd]. Shared by the
 * calendar API and the weekly email digest.
 */
export function getMergedEvents(windowStart: string, windowEnd: string): MergedEvent[] {
  // Local events: recurring series can start before the window, so we can't
  // filter them out by date in SQL. Pull recurring rows plus one-offs that
  // overlap the window, then expand in JS.
  const localRows = db
    .prepare(
      `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.location, e.notes,
              e.recurrence, e.recurrence_until,
              e.child_id, c.name AS child_name, c.color AS child_color
       FROM events e
       LEFT JOIN children c ON c.id = e.child_id
       WHERE e.recurrence = 'weekly'
          OR (e.start_at < @end AND COALESCE(e.end_at, e.start_at) >= @start)`,
    )
    .all({ start: windowStart, end: windowEnd }) as LocalRow[];

  const events: MergedEvent[] = [];
  for (const row of localRows) {
    events.push(...expandLocal(row, windowStart, windowEnd));
  }

  const feedRows = db
    .prepare(
      `SELECT fe.id, fe.title, fe.start_at, fe.end_at, fe.all_day, fe.location, fe.description,
              f.label AS feed_label, f.color AS feed_color,
              f.child_id, c.name AS child_name, c.color AS child_color
       FROM feed_events fe
       JOIN feeds f ON f.id = fe.feed_id
       LEFT JOIN children c ON c.id = f.child_id
       WHERE fe.start_at < @end AND COALESCE(fe.end_at, fe.start_at) >= @start`,
    )
    .all({ start: windowStart, end: windowEnd }) as Array<{
    id: number;
    title: string;
    start_at: string;
    end_at: string | null;
    all_day: number;
    location: string | null;
    description: string | null;
    feed_label: string;
    feed_color: string;
    child_id: number | null;
    child_name: string | null;
    child_color: string | null;
  }>;

  for (const r of feedRows) {
    events.push({
      id: `feed-${r.id}`,
      title: r.title,
      start: r.start_at,
      end: r.end_at,
      allDay: Boolean(r.all_day),
      color: r.child_color ?? r.feed_color,
      editable: false,
      recurring: false,
      extendedProps: {
        source: 'feed',
        childId: r.child_id,
        childName: r.child_name,
        location: r.location,
        notes: r.description,
        feedLabel: r.feed_label,
        recurrence: null,
        recurrenceUntil: null,
      },
    });
  }

  return events;
}
