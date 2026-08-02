import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const eventSchema = z.object({
  title: z.string().trim().min(1, 'Give the event a title').max(200),
  childId: z.number().int().nullable().optional(),
  startAt: z.string().min(1, 'A start date/time is required'),
  endAt: z.string().nullable().optional(),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

eventsRouter.post('/', (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const e = parsed.data;
  const result = db
    .prepare(
      `INSERT INTO events (title, child_id, start_at, end_at, all_day, location, notes, created_by)
       VALUES (@title, @childId, @startAt, @endAt, @allDay, @location, @notes, @createdBy)`,
    )
    .run({
      title: e.title,
      childId: e.childId ?? null,
      startAt: e.startAt,
      endAt: e.endAt ?? null,
      allDay: e.allDay ? 1 : 0,
      location: e.location ?? null,
      notes: e.notes ?? null,
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
  const result = db
    .prepare(
      `UPDATE events
       SET title = @title, child_id = @childId, start_at = @startAt, end_at = @endAt,
           all_day = @allDay, location = @location, notes = @notes, updated_at = datetime('now')
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
    });
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
