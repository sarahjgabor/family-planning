import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getMergedEvents } from '../events/query.js';

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

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
  res.json(getMergedEvents(start, end));
});
