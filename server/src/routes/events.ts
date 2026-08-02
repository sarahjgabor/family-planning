import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const eventSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the event a title').max(200),
    childId: z.number().int().nullable().optional(),
    startAt: z.string().min(1, 'A start date/time is required'),
    endAt: z.string().nullable().optional(),
    allDay: z.boolean().default(false),
    location: z.string().trim().max(300).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    recurrence: z.enum(['weekly']).nullable().optional(),
    // YYYY-MM-DD the weekly series repeats through (inclusive).
    recurrenceUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid repeat-until date')
      .nullable()
      .optional(),
  })
  .refine((e) => e.recurrence !== 'weekly' || Boolean(e.recurrenceUntil), {
    message: 'Choose the date the weekly repeat should stop',
    path: ['recurrenceUntil'],
  });

// Fetch a single local event (the master row) for editing. When a recurring
// occurrence is clicked, the client loads the series from here so edits apply
// to the whole series rather than a shifted copy.
eventsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(
      `SELECT id, title, child_id AS childId, start_at AS startAt, end_at AS endAt,
              all_day AS allDay, location, notes, recurrence, recurrence_until AS recurrenceUntil
       FROM events WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        title: string;
        childId: number | null;
        startAt: string;
        endAt: string | null;
        allDay: number;
        location: string | null;
        notes: string | null;
        recurrence: string | null;
        recurrenceUntil: string | null;
      }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  res.json({ ...row, allDay: Boolean(row.allDay) });
});

eventsRouter.post('/', (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const e = parsed.data;
  const recurrence = e.recurrence ?? null;
  const result = db
    .prepare(
      `INSERT INTO events (title, child_id, start_at, end_at, all_day, location, notes,
                           recurrence, recurrence_until, created_by)
       VALUES (@title, @childId, @startAt, @endAt, @allDay, @location, @notes,
               @recurrence, @recurrenceUntil, @createdBy)`,
    )
    .run({
      title: e.title,
      childId: e.childId ?? null,
      startAt: e.startAt,
      endAt: e.endAt ?? null,
      allDay: e.allDay ? 1 : 0,
      location: e.location ?? null,
      notes: e.notes ?? null,
      recurrence,
      recurrenceUntil: recurrence ? e.recurrenceUntil ?? null : null,
      createdBy: req.user!.id,
    });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

eventsRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const e = parsed.data;
  const recurrence = e.recurrence ?? null;
  const result = db
    .prepare(
      `UPDATE events
       SET title = @title, child_id = @childId, start_at = @startAt, end_at = @endAt,
           all_day = @allDay, location = @location, notes = @notes,
           recurrence = @recurrence, recurrence_until = @recurrenceUntil,
           updated_at = datetime('now')
       WHERE id = @id`,
    )
    .run({
      id,
      title: e.title,
      childId: e.childId ?? null,
      startAt: e.startAt,
      endAt: e.endAt ?? null,
      allDay: e.allDay ? 1 : 0,
      location: e.location ?? null,
      notes: e.notes ?? null,
      recurrence,
      recurrenceUntil: recurrence ? e.recurrenceUntil ?? null : null,
    });
  if (result.changes === 0) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  res.json({ id });
});

// Lightweight reschedule used by drag-and-drop / resize. Only touches timing,
// so it never disturbs the rest of the event (title, notes, recurrence, …).
const moveSchema = z.object({
  startAt: z.string().min(1),
  endAt: z.string().nullable().optional(),
  allDay: z.boolean().default(false),
});

eventsRouter.patch('/:id/move', (req, res) => {
  const id = Number(req.params.id);
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid schedule' });
    return;
  }
  const { startAt, endAt, allDay } = parsed.data;
  const result = db
    .prepare(
      `UPDATE events SET start_at = @startAt, end_at = @endAt, all_day = @allDay,
              updated_at = datetime('now') WHERE id = @id`,
    )
    .run({ id, startAt, endAt: endAt ?? null, allDay: allDay ? 1 : 0 });
  if (result.changes === 0) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  res.json({ id });
});

// ---- Per-occurrence edits of a weekly series ----
//
// Scope 'single'    → change/cancel just one date (stored as an override).
// Scope 'following' → change/cancel this date and every one after it
//                     (the series is split; the master is truncated).
// Scope 'all' is handled by the plain PUT/DELETE /:id above (the master row).

/** Return the YYYY-MM-DD one calendar day before the given date. */
function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function loadWeeklyMaster(id: number):
  | { id: number; start_at: string; recurrence: string | null; recurrence_until: string | null }
  | undefined {
  return db
    .prepare('SELECT id, start_at, recurrence, recurrence_until FROM events WHERE id = ?')
    .get(id) as
    | { id: number; start_at: string; recurrence: string | null; recurrence_until: string | null }
    | undefined;
}

interface OverrideParams {
  masterId: number;
  occDate: string;
  cancelled: 0 | 1;
  title: string | null;
  childId: number | null;
  startAt: string | null;
  endAt: string | null;
  allDay: 0 | 1 | null;
  location: string | null;
  notes: string | null;
}

// Prepared lazily (not at module load) because this module is imported before
// migrate() has created the event_overrides table.
function upsertOverride(params: OverrideParams): void {
  db.prepare(
    `INSERT INTO event_overrides (master_id, occ_date, cancelled, title, child_id, start_at, end_at, all_day, location, notes)
     VALUES (@masterId, @occDate, @cancelled, @title, @childId, @startAt, @endAt, @allDay, @location, @notes)
     ON CONFLICT(master_id, occ_date) DO UPDATE SET
       cancelled = excluded.cancelled, title = excluded.title, child_id = excluded.child_id,
       start_at = excluded.start_at, end_at = excluded.end_at, all_day = excluded.all_day,
       location = excluded.location, notes = excluded.notes`,
  ).run(params);
}

const occurrenceEditSchema = eventSchema.innerType().extend({
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid occurrence date'),
  scope: z.enum(['single', 'following']),
});

eventsRouter.put('/:id/occurrence', (req, res) => {
  const id = Number(req.params.id);
  const parsed = occurrenceEditSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const e = parsed.data;
  const master = loadWeeklyMaster(id);
  if (!master || master.recurrence !== 'weekly') {
    res.status(404).json({ error: 'Repeating event not found' });
    return;
  }

  if (e.scope === 'single') {
    upsertOverride({
      masterId: id,
      occDate: e.occurrenceDate,
      cancelled: 0,
      title: e.title,
      childId: e.childId ?? null,
      startAt: e.startAt,
      endAt: e.endAt ?? null,
      allDay: e.allDay ? 1 : 0,
      location: e.location ?? null,
      notes: e.notes ?? null,
    });
    res.json({ id, scope: 'single' });
    return;
  }

  // scope === 'following': split the series at the occurrence date.
  const masterStartDate = master.start_at.slice(0, 10);
  const split = db.transaction(() => {
    if (e.occurrenceDate <= masterStartDate) {
      // Editing from the first occurrence onward is the same as editing all.
      db.prepare(
        `UPDATE events SET title=@title, child_id=@childId, start_at=@startAt, end_at=@endAt,
                all_day=@allDay, location=@location, notes=@notes, updated_at=datetime('now')
         WHERE id=@id`,
      ).run({
        id,
        title: e.title,
        childId: e.childId ?? null,
        startAt: e.startAt,
        endAt: e.endAt ?? null,
        allDay: e.allDay ? 1 : 0,
        location: e.location ?? null,
        notes: e.notes ?? null,
      });
      return id;
    }

    const originalUntil = master.recurrence_until;
    // Truncate the original series to end the day before the split.
    db.prepare('UPDATE events SET recurrence_until=?, updated_at=datetime(\'now\') WHERE id=?').run(
      dayBefore(e.occurrenceDate),
      id,
    );
    // Overrides on/after the split no longer belong to the original series.
    db.prepare('DELETE FROM event_overrides WHERE master_id=? AND occ_date>=?').run(id, e.occurrenceDate);
    // Create a new series carrying the edits, inheriting the original end date.
    const inserted = db
      .prepare(
        `INSERT INTO events (title, child_id, start_at, end_at, all_day, location, notes,
                             recurrence, recurrence_until, created_by)
         VALUES (@title, @childId, @startAt, @endAt, @allDay, @location, @notes,
                 'weekly', @until, @createdBy)`,
      )
      .run({
        title: e.title,
        childId: e.childId ?? null,
        startAt: e.startAt,
        endAt: e.endAt ?? null,
        allDay: e.allDay ? 1 : 0,
        location: e.location ?? null,
        notes: e.notes ?? null,
        until: originalUntil,
        createdBy: req.user!.id,
      });
    return Number(inserted.lastInsertRowid);
  });

  const resultId = split();
  res.json({ id: resultId, scope: 'following' });
});

eventsRouter.delete('/:id/occurrence', (req, res) => {
  const id = Number(req.params.id);
  const occurrenceDate = String(req.query.date ?? '');
  const scope = String(req.query.scope ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate) || (scope !== 'single' && scope !== 'following')) {
    res.status(400).json({ error: 'A valid date and scope are required' });
    return;
  }
  const master = loadWeeklyMaster(id);
  if (!master || master.recurrence !== 'weekly') {
    res.status(404).json({ error: 'Repeating event not found' });
    return;
  }

  if (scope === 'single') {
    // Cancel just this date.
    upsertOverride({
      masterId: id,
      occDate: occurrenceDate,
      cancelled: 1,
      title: null,
      childId: null,
      startAt: null,
      endAt: null,
      allDay: null,
      location: null,
      notes: null,
    });
    res.status(204).end();
    return;
  }

  // scope === 'following': stop the series at (and including) this date.
  const masterStartDate = master.start_at.slice(0, 10);
  db.transaction(() => {
    if (occurrenceDate <= masterStartDate) {
      // Cancelling from the first occurrence removes the whole series.
      db.prepare('DELETE FROM events WHERE id=?').run(id);
    } else {
      db.prepare('UPDATE events SET recurrence_until=?, updated_at=datetime(\'now\') WHERE id=?').run(
        dayBefore(occurrenceDate),
        id,
      );
      db.prepare('DELETE FROM event_overrides WHERE master_id=? AND occ_date>=?').run(id, occurrenceDate);
    }
  })();
  res.status(204).end();
});

eventsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  res.status(204).end();
});
