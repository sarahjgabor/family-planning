import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

const ALLOWED = [10, 30, 60];

// The current user's reminder minutes for one event/series.
remindersRouter.get('/', (req, res) => {
  const seriesKey = String(req.query.seriesKey ?? '');
  if (!seriesKey) {
    res.status(400).json({ error: 'seriesKey is required' });
    return;
  }
  const rows = db
    .prepare('SELECT minutes_before FROM reminders WHERE user_id = ? AND series_key = ? ORDER BY minutes_before')
    .all(req.user!.id, seriesKey) as { minutes_before: number }[];
  res.json({ minutes: rows.map((r) => r.minutes_before) });
});

const putSchema = z.object({
  seriesKey: z.string().min(1),
  minutes: z.array(z.number().int()).max(3),
});

// Replace the current user's reminders for one event/series.
remindersRouter.put('/', (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid reminder' });
    return;
  }
  const { seriesKey } = parsed.data;
  const minutes = [...new Set(parsed.data.minutes)].filter((m) => ALLOWED.includes(m));

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM reminders WHERE user_id = ? AND series_key = ?').run(req.user!.id, seriesKey);
    const insert = db.prepare('INSERT INTO reminders (user_id, series_key, minutes_before) VALUES (?, ?, ?)');
    for (const m of minutes) insert.run(req.user!.id, seriesKey, m);
  });
  replace();
  res.json({ minutes });
});
