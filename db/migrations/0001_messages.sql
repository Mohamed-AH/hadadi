-- «تواصل معنا» messages (worker/contact.js). Only what the visitor typed: no IP, no user agent.
CREATE TABLE IF NOT EXISTS messages (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,                 -- UTC ISO time
  name    TEXT NOT NULL DEFAULT '',      -- optional
  reply   TEXT NOT NULL DEFAULT '',      -- optional email or phone, if they want an answer
  body    TEXT NOT NULL,
  mailed  INTEGER NOT NULL DEFAULT 0,    -- 1 once forwarded to info@h-haddadi.com
  status  TEXT NOT NULL DEFAULT 'new'    -- new | read | answered | archived (admin portal)
);
CREATE INDEX IF NOT EXISTS messages_at ON messages (at);
