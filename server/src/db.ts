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

    -- Subscribed external calendars (e.g. Google Calendar secret iCal URLs).
    CREATE TABLE IF NOT EXISTS feeds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      label       TEXT NOT NULL,
      url         TEXT NOT NULL,
      color       TEXT NOT NULL DEFAULT '#10b981',
      child_id    INTEGER REFERENCES children(id) ON DELETE SET NULL,
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

    CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
    CREATE INDEX IF NOT EXISTS idx_feed_events_feed ON feed_events(feed_id);
    CREATE INDEX IF NOT EXISTS idx_feed_events_start ON feed_events(start_at);
    CREATE INDEX IF NOT EXISTS idx_overrides_master ON event_overrides(master_id);
  `);

  // Add columns introduced after the first release, for databases that were
  // created before these features existed. Safe to run every startup.
  ensureColumn('events', 'recurrence', 'TEXT');
  ensureColumn('events', 'recurrence_until', 'TEXT');
}

/** Add a column to a table only if it isn't already present. */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
