import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import {
  buildAuthUrl,
  signState,
  verifyState,
  exchangeCodeAndStore,
  getConnectedAccount,
  disconnectGoogle,
} from '../google/oauth.js';
import { listGoogleCalendars } from '../google/calendar.js';
import { syncFeed } from '../feeds/sync.js';

export const googleRouter = Router();

// Whether Google is set up, and whether an account is connected.
googleRouter.get('/status', requireAuth, (_req, res) => {
  const account = getConnectedAccount();
  res.json({
    configured: Boolean(config.google),
    connected: Boolean(account),
    email: account?.email ?? null,
  });
});

// Returns the Google consent URL to send the browser to. State encodes the
// app user, so we don't put the app token in the URL.
googleRouter.post('/connect', requireAuth, (req, res) => {
  if (!config.google) {
    res.status(400).json({ error: 'Google is not configured on the server.' });
    return;
  }
  res.json({ url: buildAuthUrl(signState(req.user!.id)) });
});

// Google redirects the browser here after consent. No app auth header is
// available on a top-level redirect, so we trust the signed state instead.
googleRouter.get('/callback', async (req, res) => {
  const appUrl = config.appUrl ?? '';
  const error = req.query.error ? String(req.query.error) : null;
  const code = req.query.code ? String(req.query.code) : null;
  const state = req.query.state ? String(req.query.state) : '';
  const userId = verifyState(state);

  if (error || !code || !userId) {
    res.redirect(`${appUrl}/?google=error`);
    return;
  }
  try {
    await exchangeCodeAndStore(code, userId);
    res.redirect(`${appUrl}/?google=connected`);
  } catch {
    res.redirect(`${appUrl}/?google=error`);
  }
});

// List the connected account's Google calendars, for the picker.
googleRouter.get('/calendars', requireAuth, async (_req, res) => {
  const account = getConnectedAccount();
  if (!account) {
    res.status(400).json({ error: 'No Google account connected' });
    return;
  }
  try {
    // Which Google calendars are already added, so the UI can mark them.
    const added = new Set(
      (db.prepare("SELECT google_calendar_id FROM feeds WHERE source_type = 'google'").all() as {
        google_calendar_id: string;
      }[]).map((r) => r.google_calendar_id),
    );
    const calendars = await listGoogleCalendars(account);
    res.json(calendars.map((c) => ({ ...c, added: added.has(c.id) })));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Could not list calendars' });
  }
});

// Add one Google calendar as a shared feed.
const addSchema = z.object({
  googleCalendarId: z.string().min(1),
  label: z.string().trim().min(1, 'Give this calendar a name').max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#10b981'),
  childId: z.number().int().nullable().optional(),
});

googleRouter.post('/calendars', requireAuth, async (req, res) => {
  const account = getConnectedAccount();
  if (!account) {
    res.status(400).json({ error: 'No Google account connected' });
    return;
  }
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const { googleCalendarId, label, color, childId } = parsed.data;
  const result = db
    .prepare(
      `INSERT INTO feeds (label, url, source_type, google_calendar_id, google_account_id, color, child_id, created_by)
       VALUES (?, '', 'google', ?, ?, ?, ?, ?)`,
    )
    .run(label, googleCalendarId, account.id, color, childId ?? null, req.user!.id);

  const id = Number(result.lastInsertRowid);
  const sync = await syncFeed({ id });
  res.status(201).json({ id, sync });
});

googleRouter.post('/disconnect', requireAuth, (_req, res) => {
  disconnectGoogle();
  res.json({ ok: true });
});
