import cron from 'node-cron';
import { config } from '../config.js';
import { db } from '../db.js';
import { getMergedEvents } from '../events/query.js';
import { initPush, sendToUser } from './push.js';

// Look a little further ahead than the longest reminder (60 min) so a reminder
// fires the minute its time arrives.
const LOOKAHEAD_MS = 70 * 60_000;
// Fire reminders whose time arrived within this window (covers a missed tick),
// while the sent_reminders table prevents duplicates.
const CATCHUP_MS = 2 * 60_000;

interface ReminderRow {
  user_id: number;
  series_key: string;
  minutes_before: number;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: config.timezone,
  });
}

/** Check for reminders due now and push them. Runs every minute. Exported for tests. */
export async function runReminderTick(): Promise<void> {
  const now = Date.now();
  const windowEnd = new Date(now + LOOKAHEAD_MS).toISOString();
  const events = getMergedEvents(new Date(now - CATCHUP_MS).toISOString(), windowEnd);
  if (events.length === 0) return;

  const reminders = db.prepare('SELECT user_id, series_key, minutes_before FROM reminders').all() as ReminderRow[];
  if (reminders.length === 0) return;

  // Group reminders by series for quick lookup.
  const bySeries = new Map<string, ReminderRow[]>();
  for (const r of reminders) {
    const list = bySeries.get(r.series_key) ?? [];
    list.push(r);
    bySeries.set(r.series_key, list);
  }

  const markSent = db.prepare(
    `INSERT OR IGNORE INTO sent_reminders (user_id, series_key, occurrence_start, minutes_before)
     VALUES (?, ?, ?, ?)`,
  );

  for (const event of events) {
    if (event.allDay) continue; // reminders only make sense for timed events
    const matches = bySeries.get(event.extendedProps.seriesKey);
    if (!matches) continue;

    const startMs = new Date(event.start).getTime();
    for (const r of matches) {
      const fireAt = startMs - r.minutes_before * 60_000;
      if (fireAt > now || fireAt <= now - CATCHUP_MS) continue; // not due (or too old)

      // Claim it: only send if this is the first time (unique constraint).
      const result = markSent.run(r.user_id, r.series_key, event.start, r.minutes_before);
      if (result.changes === 0) continue; // already sent

      const when = formatTime(event.start);
      const where = event.extendedProps.location ? ` · ${event.extendedProps.location}` : '';
      void sendToUser(r.user_id, {
        title: event.title,
        body: `in ${r.minutes_before} min — ${when}${where}`,
        url: config.appUrl ?? '/',
        tag: `${r.series_key}:${event.start}`,
      });
    }
  }
}

/** Start the per-minute reminder scheduler (no-op unless push is configured). */
export function startReminderScheduler(): void {
  if (!initPush()) {
    console.log('ℹ️  Push reminders are off (no VAPID keys configured).');
    return;
  }
  cron.schedule('* * * * *', () => {
    runReminderTick().catch((err) => console.error('Reminder tick failed:', err));
  });
  // Tidy old dedup rows daily.
  cron.schedule('0 3 * * *', () => {
    db.prepare("DELETE FROM sent_reminders WHERE occurrence_start < datetime('now', '-2 days')").run();
  });
  console.log('🔔 Push reminders scheduled (every minute).');
}
