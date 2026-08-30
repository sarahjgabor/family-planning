import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { sendToUser } from '../push/push.js';

export const pushRouter = Router();

// Public: whether push is available and the VAPID public key to subscribe with.
pushRouter.get('/config', (_req, res) => {
  res.json({ enabled: Boolean(config.vapid), publicKey: config.vapid?.publicKey ?? null });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

// Store (or refresh) this device's push subscription for the current user.
pushRouter.post('/subscribe', requireAuth, (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }
  const { endpoint, keys } = parsed.data;
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(req.user!.id, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

pushRouter.post('/unsubscribe', requireAuth, (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : null;
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  res.json({ ok: true });
});

// Send a test notification to the current user's devices.
pushRouter.post('/test', requireAuth, async (req, res) => {
  const sent = await sendToUser(req.user!.id, {
    title: '🪿 The Goose Nest',
    body: 'Notifications are working! You’ll get event reminders here.',
    url: config.appUrl ?? '/',
  });
  res.json({ sent });
});
