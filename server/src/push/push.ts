import webpush from 'web-push';
import { config } from '../config.js';
import { db } from '../db.js';

let configured = false;

/** Configure web-push with the VAPID keypair, once. A bad key disables push
 *  rather than crashing the server. */
export function initPush(): boolean {
  if (configured) return true;
  if (!config.vapid) return false;
  try {
    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
    configured = true;
    return true;
  } catch (err) {
    console.warn('⚠️  Push notifications disabled — invalid VAPID config:', err instanceof Error ? err.message : err);
    return false;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Send a notification to every device a user has enabled. Subscriptions that
 * are gone (410/404) are pruned automatically.
 */
export async function sendToUser(userId: number, payload: PushPayload): Promise<number> {
  if (!initPush()) return 0;
  const subs = db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .all(userId) as SubRow[];

  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Subscription no longer valid — remove it.
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        }
      }
    }),
  );
  return sent;
}
