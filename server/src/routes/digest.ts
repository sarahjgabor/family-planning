import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { buildDigest, sendWeeklyDigest } from '../digest/digest.js';

export const digestRouter = Router();
digestRouter.use(requireAuth);

// Tells the UI whether email is set up, so it can show the right message.
digestRouter.get('/status', (_req, res) => {
  res.json({ emailConfigured: Boolean(config.smtp), timezone: config.timezone, schedule: config.digestCron });
});

// Renders the current week's digest as HTML so it can be previewed in-app.
digestRouter.get('/preview', (_req, res) => {
  const now = new Date();
  const digest = buildDigest(now);
  res.json({ subject: digest.subject, html: digest.html, eventCount: digest.eventCount });
});

// Sends the digest right now (handy to confirm email works before Sunday).
digestRouter.post('/send-test', async (_req, res) => {
  try {
    const result = await sendWeeklyDigest();
    if (result.skipped) {
      res.status(400).json({ error: result.skipped });
      return;
    }
    res.json({ ok: true, sent: result.sent });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Could not send email' });
  }
});
