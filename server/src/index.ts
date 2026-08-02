import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './db.js';
import { authRouter } from './routes/auth.js';
import { childrenRouter } from './routes/children.js';
import { eventsRouter } from './routes/events.js';
import { feedsRouter } from './routes/feeds.js';
import { calendarRouter } from './routes/calendar.js';
import { digestRouter } from './routes/digest.js';
import { syncAllFeeds } from './feeds/sync.js';
import { startDigestScheduler } from './digest/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

migrate();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/children', childrenRouter);
app.use('/api/events', eventsRouter);
app.use('/api/feeds', feedsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/digest', digestRouter);

// Serve the built web app in production. The frontend is a single-page app,
// so any non-API route falls back to index.html.
const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`Family Planning server listening on http://localhost:${config.port}`);
  if (config.jwtSecret === 'dev-insecure-secret-change-me') {
    console.warn('⚠️  Using the default JWT secret. Set JWT_SECRET before deploying.');
  }
});

// Refresh subscribed calendars on startup and on an interval so imported
// events stay current without anyone pressing a button.
void syncAllFeeds();
const refreshMs = Math.max(5, config.feedRefreshMinutes) * 60_000;
setInterval(() => {
  void syncAllFeeds();
}, refreshMs);

// Schedule the Sunday-morning email digest (no-op unless SMTP is configured).
startDigestScheduler();
