import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Ensure the directory for the database file exists before opening it.
const dir = path.dirname(config.databasePath);
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Create tables if they do not exist. This runs on every startup and is safe
 * to re-run — it only creates missing objects.
 */
export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- The children (or people) whose activities the family is tracking.
    CREATE TABLE IF NOT EXISTS children (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#3b82f6',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Events added directly inside the app (as opposed to imported feeds).
    CREATE TABLE IF NOT EXISTS events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      title            TEXT NOT NULL,
      child_id         INTEGER REFERENCES children(id) ON DELETE SET NULL,
      start_at         TEXT NOT NULL,
      end_at           TEXT,
      all_day          INTEGER NOT NULL DEFAULT 0,
      location         TEXT,
      notes            TEXT,
      recurrence       TEXT,             -- NULL for one-off, 'weekly' for a repeating series
      recurrence_until TEXT,             -- YYYY-MM-DD the weekly series repeats through (inclusive)
      created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- A linked Google account (OAuth). One person connects; the calendars they
    -- add from it are shared with everyone, like iCal feeds.
    CREATE TABLE IF NOT EXISTS google_accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
      email         TEXT,
      refresh_token TEXT NOT NULL,
      access_token  TEXT,
      token_expiry  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Subscribed external calendars. Either an iCal URL (source_type 'ical') or
    -- a Google Calendar read via the API (source_type 'google').
    CREATE TABLE IF NOT EXISTS feeds (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      label             TEXT NOT NULL,
      url               TEXT NOT NULL DEFAULT '',
      source_type       TEXT NOT NULL DEFAULT 'ical',
      google_calendar_id TEXT,
      google_account_id INTEGER REFERENCES google_accounts(id) ON DELETE CASCADE,
      color             TEXT NOT NULL DEFAULT '#10b981',
      child_id          INTEGER REFERENCES children(id) ON DELETE SET NULL,
      last_synced TEXT,
      last_error  TEXT,
      created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cached events parsed from feeds. Refreshed on each sync.
    CREATE TABLE IF NOT EXISTS feed_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id     INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      uid         TEXT NOT NULL,
      series_uid  TEXT,          -- base UID shared by every occurrence of a series
      title       TEXT NOT NULL,
      start_at    TEXT NOT NULL,
      end_at      TEXT,
      all_day     INTEGER NOT NULL DEFAULT 0,
      location    TEXT,
      description TEXT
    );

    -- Per-occurrence changes to a weekly series: a single date can be
    -- cancelled (cancelled=1) or replaced with different details (cancelled=0
    -- with override fields). Keyed by the occurrence's original slot date.
    CREATE TABLE IF NOT EXISTS event_overrides (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      master_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      occ_date   TEXT NOT NULL,                 -- original occurrence date, YYYY-MM-DD
      cancelled  INTEGER NOT NULL DEFAULT 0,
      title      TEXT,
      child_id   INTEGER REFERENCES children(id) ON DELETE SET NULL,
      start_at   TEXT,
      end_at     TEXT,
      all_day    INTEGER,
      location   TEXT,
      notes      TEXT,
      UNIQUE(master_id, occ_date)
    );

    -- A child assigned to a specific imported (feed) event. Keyed by the
    -- event's stable iCal UID so the assignment survives feed re-syncs (which
    -- replace the rows in feed_events). child_id NULL means "explicitly no one",
    -- overriding any child assigned to the whole feed.
    CREATE TABLE IF NOT EXISTS feed_event_assignments (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id  INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      uid      TEXT NOT NULL,
      child_id INTEGER REFERENCES children(id) ON DELETE CASCADE,
      UNIQUE(feed_id, uid)
    );

    CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
    CREATE INDEX IF NOT EXISTS idx_feed_events_feed ON feed_events(feed_id);
    CREATE INDEX IF NOT EXISTS idx_feed_events_start ON feed_events(start_at);
    CREATE INDEX IF NOT EXISTS idx_overrides_master ON event_overrides(master_id);
    CREATE INDEX IF NOT EXISTS idx_feed_assignments ON feed_event_assignments(feed_id);
  `);

  // Add columns introduced after the first release, for databases that were
  // created before these features existed. Safe to run every startup.
  ensureColumn('events', 'recurrence', 'TEXT');
  ensureColumn('events', 'recurrence_until', 'TEXT');
  ensureColumn('feed_events', 'series_uid', 'TEXT');
  ensureColumn('feeds', 'source_type', "TEXT NOT NULL DEFAULT 'ical'");
  ensureColumn('feeds', 'google_calendar_id', 'TEXT');
  ensureColumn('feeds', 'google_account_id', 'INTEGER');
}

/** Add a column to a table only if it isn't already present. */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
