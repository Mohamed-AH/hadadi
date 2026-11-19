-- Admin portal (admin.h-haddadi.com): who may sign in, and a log of every change. Never exported to git (emails).
CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('super','admin','editor')),
  name       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  actor     TEXT NOT NULL,
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT,
  before    TEXT,
  after     TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log (at);
CREATE INDEX IF NOT EXISTS messages_status ON messages (status, id);
