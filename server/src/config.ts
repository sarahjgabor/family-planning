import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from the repository root (one level above the server package).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const smtpHost = process.env.SMTP_HOST?.trim() || null;

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databasePath: process.env.DATABASE_PATH ?? path.resolve(__dirname, '../../data/family.sqlite'),
  jwtSecret: required('JWT_SECRET', 'dev-insecure-secret-change-me'),
  inviteCode: process.env.INVITE_CODE?.trim() || null,
  feedRefreshMinutes: Number(process.env.FEED_REFRESH_MINUTES ?? 30),
  isProduction: process.env.NODE_ENV === 'production',

  // Public URL of the deployed app, used for the link in the digest email.
  appUrl: process.env.APP_URL?.replace(/\/$/, '') || null,

  // Timezone the weekly digest is scheduled and formatted in (IANA name,
  // e.g. "America/New_York"). Defaults to UTC.
  timezone: process.env.TIMEZONE?.trim() || 'UTC',

  // Weekly email digest. Only runs when SMTP is configured. The cron
  // expression defaults to 7:00 AM every Sunday in the configured timezone.
  digestCron: process.env.DIGEST_CRON?.trim() || '0 7 * * 0',

  smtp: smtpHost
    ? {
        host: smtpHost,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER?.trim() || undefined,
        pass: process.env.SMTP_PASS || undefined,
        from: process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'family-calendar@localhost',
      }
    : null,

  // Web push notifications for event reminders. Enabled when a VAPID keypair
  // is set (generate one with `npx web-push generate-vapid-keys`).
  vapid:
    process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim()
      ? {
          publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
          privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
          // web-push requires a contact; a URL or mailto: is fine.
          subject: process.env.VAPID_SUBJECT?.trim() || process.env.APP_URL?.trim() || 'mailto:noreply@thegoosenest.app',
        }
      : null,

  // Google Calendar connection (OAuth). Lets one person link their Google
  // account so the app can read calendars that can't be added by iCal URL
  // (e.g. a Sawyer feed imported into Google). Only enabled when both the
  // client id/secret and APP_URL are set.
  google:
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && process.env.APP_URL?.trim()
      ? {
          clientId: process.env.GOOGLE_CLIENT_ID.trim(),
          clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
          redirectUri: `${process.env.APP_URL.replace(/\/$/, '')}/api/google/callback`,
        }
      : null,
};
