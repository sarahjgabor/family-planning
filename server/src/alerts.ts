import { db } from './db.js';
import { config } from './config.js';
import { sendToUser } from './push/push.js';
import { getTransporter } from './digest/digest.js';

interface Admin {
  id: number;
  email: string;
}

/**
 * Let the owner(s) know a calendar stopped syncing. Delivered by push (to
 * their devices) and email (if SMTP is set up). Called once per failure
 * episode — see error_notified in syncFeed. Best-effort: if neither push nor
 * email is configured, the in-app warning banner remains the only signal.
 */
export async function notifyFeedFailure(label: string, message: string): Promise<void> {
  const admins = db.prepare('SELECT id, email FROM users WHERE is_admin = 1').all() as Admin[];
  if (admins.length === 0) return;

  const short = message.length > 160 ? `${message.slice(0, 160)}…` : message;

  // Push to each owner's devices.
  for (const a of admins) {
    void sendToUser(a.id, {
      title: '⚠️ A calendar stopped syncing',
      body: `${label}: ${short}`,
      url: config.appUrl ?? '/',
      tag: `feed-error:${label}`,
    });
  }

  // Email the owners, if email is configured.
  const tx = getTransporter();
  if (tx && config.smtp) {
    try {
      await tx.sendMail({
        from: config.smtp.from,
        bcc: admins.map((a) => a.email),
        subject: `⚠️ The Goose Nest — "${label}" stopped syncing`,
        text: `The calendar "${label}" failed to sync:\n\n${message}\n\n${
          config.appUrl ? `Open The Goose Nest: ${config.appUrl}\n` : ''
        }Open Manage → Subscribed calendars to fix it (you may need to reconnect Google).`,
      });
    } catch {
      /* email is best-effort */
    }
  }
}
