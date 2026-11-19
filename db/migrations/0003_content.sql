-- Phase B3 (2026-11-19): audio uploaded in the portal, lessons added in the portal, Publish snapshots, listening counters.
-- The Telegram import stays in git; these rows are patches on top of it. Publish copies them into a snapshot (publishes),
-- the Worker serves the latest snapshot at /api/published, and the Cloudflare build merges it into the site.

-- audio for an existing (Telegram) lesson; tg = the lesson's post link, the key media.json uses
CREATE TABLE IF NOT EXISTS audio (
  lesson_id TEXT PRIMARY KEY,
  tg        TEXT NOT NULL,
  key       TEXT NOT NULL,
  size      INTEGER NOT NULL,
  duration  INTEGER NOT NULL DEFAULT 0,
  by        TEXT NOT NULL,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
-- lessons that are not in the Telegram channels, added to a series in the portal (id p-<hex>)
CREATE TABLE IF NOT EXISTS lessons_new (
  id        TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  title     TEXT NOT NULL,
  hd        TEXT,
  date      TEXT,
  key       TEXT NOT NULL,
  size      INTEGER NOT NULL,
  duration  INTEGER NOT NULL DEFAULT 0,
  by        TEXT NOT NULL,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
-- every Publish: who, when, exactly what was sent to the build, and what the deploy hook answered
CREATE TABLE IF NOT EXISTS publishes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL DEFAULT (datetime('now')),
  by       TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  result   TEXT
);
-- anonymous counters: no IP, no cookie, one row per day, lesson and event
CREATE TABLE IF NOT EXISTS stats_daily (
  day       TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  event     TEXT NOT NULL CHECK (event IN ('play','download')),
  n         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, lesson_id, event)
);
CREATE INDEX IF NOT EXISTS stats_lesson ON stats_daily (lesson_id);
