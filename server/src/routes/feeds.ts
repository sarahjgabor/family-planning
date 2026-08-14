import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { syncFeed, syncAllFeeds } from '../feeds/sync.js';
import { normalizeIcalUrl } from '../feeds/url.js';

export const feedsRouter = Router();
feedsRouter.use(requireAuth);

const feedSchema = z.object({
  label: z.string().trim().min(1, 'Give this calendar a name').max(120),
  url: z
    .string()
    .trim()
    .refine(
      (u) => /^(https?|webcal):\/\//i.test(u),
      'Enter the calendar\'s iCal URL (starts with https:// or webcal://)',
    ),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #10b981')
    .default('#10b981'),
  childId: z.number().int().nullable().optional(),
});

feedsRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT f.id, f.label, f.url, f.color, f.child_id AS childId, f.last_synced AS lastSynced,
              f.last_error AS lastError,
              (SELECT COUNT(*) FROM feed_events fe WHERE fe.feed_id = f.id) AS eventCount
       FROM feeds f ORDER BY f.label`,
    )
    .all();
  res.json(rows);
});

feedsRouter.post('/', async (req, res) => {
  // Normalize first (turns a Calendar ID / cid / embed link into an iCal feed
  // URL) so it passes the http(s) validation below.
  if (req.body && typeof req.body.url === 'string') req.body.url = normalizeIcalUrl(req.body.url);
  const parsed = feedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const { label, color, childId } = parsed.data;
  const url = parsed.data.url;
  const result = db
    .prepare('INSERT INTO feeds (label, url, color, child_id, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(label, url, color, childId ?? null, req.user!.id);

  const id = Number(result.lastInsertRowid);
  // Sync immediately so events show up right away. Report the outcome so the
  // UI can warn if the URL was wrong.
  const sync = await syncFeed({ id, url });
  res.status(201).json({ id, sync });
});

feedsRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (req.body && typeof req.body.url === 'string') req.body.url = normalizeIcalUrl(req.body.url);
  const parsed = feedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const { label, color, childId } = parsed.data;
  const url = parsed.data.url;
  const result = db
    .prepare('UPDATE feeds SET label = ?, url = ?, color = ?, child_id = ? WHERE id = ?')
    .run(label, url, color, childId ?? null, id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Calendar not found' });
    return;
  }
  res.json({ id });
});

feedsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM feeds WHERE id = ?').run(id);
  res.status(204).end();
});

// Manually refresh a single feed.
feedsRouter.post('/:id/refresh', async (req, res) => {
  const id = Number(req.params.id);
  const feed = db.prepare('SELECT id, url FROM feeds WHERE id = ?').get(id) as
    | { id: number; url: string }
    | undefined;
  if (!feed) {
    res.status(404).json({ error: 'Calendar not found' });
    return;
  }
  const sync = await syncFeed(feed);
  res.json({ sync });
});

// Manually refresh every feed.
feedsRouter.post('/refresh-all', async (_req, res) => {
  await syncAllFeeds();
  res.json({ ok: true });
});

// Assign (or clear) the child for a single imported event. Keyed by the
// event's iCal UID so it survives feed re-syncs. childId null = "no one".
const assignSchema = z.object({
  uid: z.string().min(1),
  childId: z.number().int().nullable(),
});

feedsRouter.put('/:id/assign', (req, res) => {
  const feedId = Number(req.params.id);
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid assignment' });
    return;
  }
  const feed = db.prepare('SELECT id FROM feeds WHERE id = ?').get(feedId);
  if (!feed) {
    res.status(404).json({ error: 'Calendar not found' });
    return;
  }
  const { uid, childId } = parsed.data;
  db.prepare(
    `INSERT INTO feed_event_assignments (feed_id, uid, child_id) VALUES (?, ?, ?)
     ON CONFLICT(feed_id, uid) DO UPDATE SET child_id = excluded.child_id`,
  ).run(feedId, uid, childId);
  res.json({ ok: true });
});
