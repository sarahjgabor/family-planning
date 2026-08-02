import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

const DEFAULT_LOCAL_COLOR = '#6366f1';

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  color: string;
  editable: boolean;
  extendedProps: {
    source: 'local' | 'feed';
    childId: number | null;
    childName: string | null;
    location: string | null;
    notes: string | null;
    feedLabel: string | null;
  };
}

/**
 * Returns all events (locally-added + imported feeds) that overlap the given
 * [start, end] window, shaped for FullCalendar. The window comes from the
 * calendar UI as it navigates between months/weeks.
 */
calendarRouter.get('/', (req, res) => {
  const start = String(req.query.start ?? '');
  const end = String(req.query.end ?? '');
  if (!start || !end) {
    res.status(400).json({ error: 'start and end query parameters are required' });
    return;
  }

  const localRows = db
    .prepare(
      `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.location, e.notes,
              e.child_id, c.name AS child_name, c.color AS child_color
       FROM events e
       LEFT JOIN children c ON c.id = e.child_id
       WHERE e.start_at < @end AND COALESCE(e.end_at, e.start_at) >= @start`,
    )
    .all({ start, end }) as Array<{
    id: number;
    title: string;
    start_at: string;
    end_at: string | null;
    all_day: number;
    location: string | null;
    notes: string | null;
    child_id: number | null;
    child_name: string | null;
    child_color: string | null;
  }>;

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
    .all({ start, end }) as Array<{
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

  const events: CalendarEvent[] = [];

  for (const r of localRows) {
    events.push({
      id: `local-${r.id}`,
      title: r.title,
      start: r.start_at,
      end: r.end_at,
      allDay: Boolean(r.all_day),
      color: r.child_color ?? DEFAULT_LOCAL_COLOR,
      editable: true,
      extendedProps: {
        source: 'local',
        childId: r.child_id,
        childName: r.child_name,
        location: r.location,
        notes: r.notes,
        feedLabel: null,
      },
    });
  }

  for (const r of feedRows) {
    events.push({
      id: `feed-${r.id}`,
      title: r.title,
      start: r.start_at,
      end: r.end_at,
      allDay: Boolean(r.all_day),
      // Prefer the assigned child's color; fall back to the feed's own color.
      color: r.child_color ?? r.feed_color,
      editable: false,
      extendedProps: {
        source: 'feed',
        childId: r.child_id,
        childName: r.child_name,
        location: r.location,
        notes: r.description,
        feedLabel: r.feed_label,
      },
    });
  }

  res.json(events);
});
