import cron from 'node-cron';
import { config } from '../config.js';
import { sendWeeklyDigest } from './digest.js';

/**
 * Schedule the weekly email digest. Does nothing unless SMTP is configured,
 * so the app runs fine without email set up.
 */
export function startDigestScheduler(): void {
  if (!config.smtp) {
    console.log('ℹ️  Weekly email digest is off (no SMTP configured).');
    return;
  }
  if (!cron.validate(config.digestCron)) {
    console.warn(`⚠️  DIGEST_CRON "${config.digestCron}" is invalid; digest disabled.`);
    return;
  }

  cron.schedule(
    config.digestCron,
    () => {
      sendWeeklyDigest()
        .then((r) => {
          if (r.skipped) console.log(`Digest skipped: ${r.skipped}`);
          else console.log(`Weekly digest sent to ${r.sent} recipient(s).`);
        })
        .catch((err) => console.error('Weekly digest failed:', err));
    },
    { timezone: config.timezone },
  );

  console.log(`📧 Weekly digest scheduled ("${config.digestCron}", ${config.timezone}).`);
}
