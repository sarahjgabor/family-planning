import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { db } from '../db.js';
import { getMergedEvents, type MergedEvent } from '../events/query.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.smtp) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

/** Start-of-day in the configured timezone, expressed as a UTC Date. */
function startOfTodayInTz(now: Date): Date {
  // Get the Y/M/D as seen in the target timezone, then treat that midnight.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // e.g. "2026-08-02"
  return new Date(`${parts}T00:00:00Z`);
}

function fmtDay(value: string): string {
  return new Date(value.length <= 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: config.timezone,
  });
}

function fmtTime(event: MergedEvent): string {
  if (event.allDay) return 'All day';
  const start = new Date(event.start).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: config.timezone,
  });
  if (!event.end) return start;
  const end = new Date(event.end).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: config.timezone,
  });
  return `${start} – ${end}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Group events by calendar day (in the configured timezone), sorted. */
function groupByDay(events: MergedEvent[]): Map<string, MergedEvent[]> {
  const groups = new Map<string, MergedEvent[]>();
  for (const e of events) {
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(e.start.length <= 10 ? `${e.start}T12:00:00Z` : e.start));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  // Sort each day's events: all-day first, then by start time.
  for (const list of groups.values()) {
    list.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.start.localeCompare(b.start);
    });
  }
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

export interface DigestContent {
  subject: string;
  html: string;
  text: string;
  eventCount: number;
}

/** Build the digest for the 7 days starting at `weekStart`. */
export function buildDigest(weekStart: Date): DigestContent {
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
  const startIso = weekStart.toISOString();
  const endIso = weekEnd.toISOString();

  const events = getMergedEvents(startIso, endIso);
  const byDay = groupByDay(events);

  const rangeLabel = `${fmtDay(startIso)} – ${fmtDay(new Date(weekEnd.getTime() - 86_400_000).toISOString())}`;
  const subject = `🪿 The Goose Nest — this week (${rangeLabel})`;

  // ---- HTML ----
  const htmlDays: string[] = [];
  const textDays: string[] = [];

  if (byDay.size === 0) {
    htmlDays.push('<p style="color:#64748b">Nothing scheduled this week. Enjoy the quiet! 🌿</p>');
    textDays.push('Nothing scheduled this week.');
  }

  for (const [, dayEvents] of byDay) {
    const dayLabel = fmtDay(dayEvents[0].start);
    const rows = dayEvents
      .map((e) => {
        const who = e.extendedProps.childName ? escapeHtml(e.extendedProps.childName) : '';
        const parts: string[] = [];
        if (e.extendedProps.location) parts.push(`📍 ${escapeHtml(e.extendedProps.location)}`);
        if (e.extendedProps.notes) parts.push(escapeHtml(e.extendedProps.notes));
        if (e.extendedProps.feedLabel) parts.push(`<em style="color:#94a3b8">${escapeHtml(e.extendedProps.feedLabel)}</em>`);
        const detail = parts.length ? `<div style="color:#475569;font-size:13px;margin-top:2px">${parts.join('<br>')}</div>` : '';
        const badge = who
          ? `<span style="display:inline-block;background:${e.color};color:#fff;font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;margin-left:6px">${who}</span>`
          : '';
        return `
          <tr>
            <td style="padding:8px 12px;border-left:3px solid ${e.color};vertical-align:top;width:120px;color:#0f172a;font-size:13px;white-space:nowrap">${fmtTime(e)}</td>
            <td style="padding:8px 12px;vertical-align:top">
              <div style="font-weight:600;color:#0f172a">${escapeHtml(e.title)}${badge}</div>
              ${detail}
            </td>
          </tr>`;
      })
      .join('');

    htmlDays.push(`
      <h3 style="margin:24px 0 6px;font-size:15px;color:#4f46e5">${dayLabel}</h3>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">${rows}</table>`);

    const textRows = dayEvents.map((e) => {
      let line = `  ${fmtTime(e)}  ${e.title}`;
      if (e.extendedProps.childName) line += ` (${e.extendedProps.childName})`;
      if (e.extendedProps.location) line += `\n      📍 ${e.extendedProps.location}`;
      if (e.extendedProps.notes) line += `\n      ${e.extendedProps.notes}`;
      return line;
    });
    textDays.push(`${dayLabel}\n${textRows.join('\n')}`);
  }

  const link = config.appUrl
    ? `<p style="margin-top:28px"><a href="${config.appUrl}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open the calendar</a></p>`
    : '';

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f1f5f9;padding:24px">
    <div style="max-width:600px;margin:0 auto">
      <h1 style="font-size:20px;color:#0f172a;margin:0 0 4px">🪿 The Goose Nest — this week</h1>
      <p style="color:#64748b;margin:0">${rangeLabel}</p>
      ${htmlDays.join('')}
      ${link}
      <p style="color:#94a3b8;font-size:12px;margin-top:28px">You're receiving this because you have an account on The Goose Nest.</p>
    </div>
  </div>`;

  const text = `The Goose Nest — this week (${rangeLabel})\n\n${textDays.join('\n\n')}\n${
    config.appUrl ? `\nOpen the calendar: ${config.appUrl}\n` : ''
  }`;

  return { subject, html, text, eventCount: events.length };
}

/**
 * Send the weekly digest to every user. Called by the scheduler and by the
 * manual "send test digest" endpoint.
 */
export async function sendWeeklyDigest(): Promise<{ sent: number; skipped: string | null }> {
  const tx = getTransporter();
  if (!tx || !config.smtp) {
    return { sent: 0, skipped: 'Email is not configured (set SMTP_HOST and related variables).' };
  }

  const recipients = db.prepare('SELECT email FROM users').all() as { email: string }[];
  if (recipients.length === 0) return { sent: 0, skipped: 'No users to email yet.' };

  const digest = buildDigest(startOfTodayInTz(new Date()));

  await tx.sendMail({
    from: config.smtp.from,
    // Put recipients in BCC so family emails aren't exposed to each other.
    bcc: recipients.map((r) => r.email),
    subject: digest.subject,
    text: digest.text,
    html: digest.html,
  });

  return { sent: recipients.length, skipped: null };
}
