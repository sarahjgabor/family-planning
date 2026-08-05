import { db } from '../db.js';

const DEFAULT_LOCAL_COLOR = '#6366f1';
const WEEK_MS = 7 * 86_400_000;
const MAX_OCCURRENCES = 520; // safety cap (~10 years of weekly events)

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
    // Present for imported (feed) events, so the client can assign a child to
    // a specific one. Null for locally-added events.
    feedId: number | null;
    uid: string | null;
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

interface OverrideRow {
  master_id: number;
  occ_date: string;
  cancelled: number;
  title: string | null;
  child_id: number | null;
  start_at: string | null;
  end_at: string | null;
  all_day: number | null;
  location: string | null;
  notes: string | null;
}

type ChildMap = Map<number, { name: string; color: string }>;

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

function overlaps(start: string, end: string | null, windowStart: string, windowEnd: string): boolean {
  const effectiveEnd = end ?? start;
  return start < windowEnd && effectiveEnd >= windowStart;
}

/**
 * Expand one local event into the occurrences that fall inside [start, end].
 * Non-recurring events yield at most one; weekly events yield each occurrence
 * from their start through recurrence_until, with per-date overrides applied
 * (a cancelled date is skipped; a modified date uses the override's values).
 */
function expandLocal(
  row: LocalRow,
  overrides: Map<string, OverrideRow>,
  childMap: ChildMap,
  windowStart: string,
  windowEnd: string,
): MergedEvent[] {
  const allDay = Boolean(row.all_day);
  const recurring = row.recurrence === 'weekly';

  const makeEvent = (
    idSuffix: string,
    start: string,
    end: string | null,
    isAllDay: boolean,
    fields: { title: string; childId: number | null; location: string | null; notes: string | null },
    color: string,
    childName: string | null,
  ): MergedEvent => ({
    id: idSuffix,
    title: fields.title,
    start,
    end,
    allDay: isAllDay,
    color,
    editable: true,
    recurring,
    extendedProps: {
      source: 'local',
      childId: fields.childId,
      childName,
      location: fields.location,
      notes: fields.notes,
      feedLabel: null,
      recurrence: recurring ? 'weekly' : null,
      recurrenceUntil: row.recurrence_until,
      feedId: null,
      uid: null,
    },
  });

  // One-off event: include it if it overlaps the window.
  if (!recurring || !row.recurrence_until) {
    if (overlaps(row.start_at, row.end_at, windowStart, windowEnd)) {
      return [
        makeEvent(
          `local-${row.id}`,
          row.start_at,
          row.end_at,
          allDay,
          { title: row.title, childId: row.child_id, location: row.location, notes: row.notes },
          row.child_color ?? DEFAULT_LOCAL_COLOR,
          row.child_name,
        ),
      ];
    }
    return [];
  }

  // Weekly series: step from the start one week at a time through the end date.
  const durationMs =
    !allDay && row.end_at ? new Date(row.end_at).getTime() - new Date(row.start_at).getTime() : 0;
  const untilExclusive = `${row.recurrence_until}T23:59:59.999Z`;
  const results: MergedEvent[] = [];

  for (let week = 0; week < MAX_OCCURRENCES; week++) {
    const slotStart = addWeeks(row.start_at, week, allDay);
    if (slotStart > untilExclusive) break;

    const slotDate = slotStart.slice(0, 10); // YYYY-MM-DD
    const dateKey = slotDate.replace(/-/g, '');
    const id = `local-${row.id}-${dateKey}`;
    const override = overrides.get(slotDate);

    if (override) {
      if (override.cancelled) continue; // this occurrence was deleted

      // Modified occurrence: use the override's values.
      const ovAllDay = override.all_day === null ? allDay : Boolean(override.all_day);
      const ovStart = override.start_at ?? slotStart;
      const ovEnd = override.end_at ?? null;
      const childId = override.child_id;
      const child = childId != null ? childMap.get(childId) : undefined;
      if (overlaps(ovStart, ovEnd, windowStart, windowEnd)) {
        results.push(
          makeEvent(
            id,
            ovStart,
            ovEnd,
            ovAllDay,
            {
              title: override.title ?? row.title,
              childId,
              location: override.location,
              notes: override.notes,
            },
            child?.color ?? DEFAULT_LOCAL_COLOR,
            child?.name ?? null,
          ),
        );
      }
      continue;
    }

    // Normal occurrence generated from the master.
    let slotEnd: string | null = null;
    if (allDay) {
      slotEnd = row.end_at ? addWeeks(row.end_at, week, true) : null;
    } else if (durationMs) {
      slotEnd = new Date(new Date(slotStart).getTime() + durationMs).toISOString();
    }
    if (overlaps(slotStart, slotEnd, windowStart, windowEnd)) {
      results.push(
        makeEvent(
          id,
          slotStart,
          slotEnd,
          allDay,
          { title: row.title, childId: row.child_id, location: row.location, notes: row.notes },
          row.child_color ?? DEFAULT_LOCAL_COLOR,
          row.child_name,
        ),
      );
    }
  }
  return results;
}

/**
 * Returns every event (locally-added, including expanded weekly series with
 * per-occurrence overrides, plus imported feed events) that overlaps
 * [windowStart, windowEnd]. Shared by the calendar API and the email digest.
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

  // Load overrides for the recurring masters in play, grouped by master -> date.
  const recurringIds = localRows.filter((r) => r.recurrence === 'weekly').map((r) => r.id);
  const overridesByMaster = new Map<number, Map<string, OverrideRow>>();
  if (recurringIds.length > 0) {
    const placeholders = recurringIds.map(() => '?').join(',');
    const overrideRows = db
      .prepare(`SELECT * FROM event_overrides WHERE master_id IN (${placeholders})`)
      .all(...recurringIds) as OverrideRow[];
    for (const ov of overrideRows) {
      let map = overridesByMaster.get(ov.master_id);
      if (!map) {
        map = new Map();
        overridesByMaster.set(ov.master_id, map);
      }
      map.set(ov.occ_date, ov);
    }
  }

  // Child colors/names for resolving override child assignments.
  const childMap: ChildMap = new Map();
  for (const c of db.prepare('SELECT id, name, color FROM children').all() as {
    id: number;
    name: string;
    color: string;
  }[]) {
    childMap.set(c.id, { name: c.name, color: c.color });
  }

  const events: MergedEvent[] = [];
  const emptyOverrides = new Map<string, OverrideRow>();
  for (const row of localRows) {
    const overrides = overridesByMaster.get(row.id) ?? emptyOverrides;
    events.push(...expandLocal(row, overrides, childMap, windowStart, windowEnd));
  }

  const feedRows = db
    .prepare(
      `SELECT fe.id, fe.uid, fe.title, fe.start_at, fe.end_at, fe.all_day, fe.location, fe.description,
              f.id AS feed_id, f.label AS feed_label, f.color AS feed_color, f.child_id AS feed_child_id
       FROM feed_events fe
       JOIN feeds f ON f.id = fe.feed_id
       WHERE fe.start_at < @end AND COALESCE(fe.end_at, fe.start_at) >= @start`,
    )
    .all({ start: windowStart, end: windowEnd }) as Array<{
    id: number;
    uid: string;
    title: string;
    start_at: string;
    end_at: string | null;
    all_day: number;
    location: string | null;
    description: string | null;
    feed_id: number;
    feed_label: string;
    feed_color: string;
    feed_child_id: number | null;
  }>;

  // Per-event child assignments, keyed "<feedId>:<uid>". A present key overrides
  // the feed's default child (its value may be null for "explicitly no one").
  const assignments = new Map<string, number | null>();
  for (const a of db
    .prepare('SELECT feed_id, uid, child_id FROM feed_event_assignments')
    .all() as { feed_id: number; uid: string; child_id: number | null }[]) {
    assignments.set(`${a.feed_id}:${a.uid}`, a.child_id);
  }

  for (const r of feedRows) {
    const key = `${r.feed_id}:${r.uid}`;
    // The assigned child wins over the feed's default child.
    const childId = assignments.has(key) ? assignments.get(key)! : r.feed_child_id;
    const child = childId != null ? childMap.get(childId) : undefined;
    events.push({
      id: `feed-${r.id}`,
      title: r.title,
      start: r.start_at,
      end: r.end_at,
      allDay: Boolean(r.all_day),
      color: child?.color ?? r.feed_color,
      editable: false,
      recurring: false,
      extendedProps: {
        source: 'feed',
        childId: childId ?? null,
        childName: child?.name ?? null,
        location: r.location,
        notes: r.description,
        feedLabel: r.feed_label,
        recurrence: null,
        recurrenceUntil: null,
        feedId: r.feed_id,
        uid: r.uid,
      },
    });
  }

  return events;
}
