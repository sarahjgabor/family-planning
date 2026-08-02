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

eventsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  res.status(204).end();
});
