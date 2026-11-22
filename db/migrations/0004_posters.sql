-- Announcement posters (the bot, worker/bot.js + worker/poster_store.js): the whole list in one row, with a version number for
-- safe concurrent writes. worker/poster_store.js also creates this table by itself on first use, so running this by hand is optional.
CREATE TABLE IF NOT EXISTS posters (k INTEGER PRIMARY KEY CHECK (k = 1), list TEXT NOT NULL, ver INTEGER NOT NULL);
INSERT OR IGNORE INTO posters (k, list, ver) VALUES (1, '[]', 0);
