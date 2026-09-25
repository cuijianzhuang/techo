-- Idempotent: safe to run more than once.
CREATE TABLE IF NOT EXISTS entries (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,              -- YYYY-MM-DD
  title      TEXT NOT NULL,
  latin      TEXT NOT NULL DEFAULT '',
  stamp      TEXT NOT NULL DEFAULT '',
  aside      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  mood       TEXT NOT NULL DEFAULT 'mug', -- mug | sleep | none
  quote      TEXT NOT NULL DEFAULT '',
  quote_src  TEXT NOT NULL DEFAULT '',
  photo_key  TEXT NOT NULL DEFAULT '',   -- R2 key, e.g. p/<uuid>.jpg
  photo_cap  TEXT NOT NULL DEFAULT '',
  stickers   TEXT NOT NULL DEFAULT '',   -- comma list, e.g. rain,cat (see render.js)
  status     TEXT NOT NULL DEFAULT 'published', -- draft | published; the book shows published only
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date, created_at);
-- loose lines written during the day; the nightly summary turns them into a draft page
CREATE TABLE IF NOT EXISTS jots (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,            -- ms since epoch
  used_in    TEXT NOT NULL DEFAULT ''     -- entry id once summarised
);
CREATE INDEX IF NOT EXISTS idx_jots_created ON jots(created_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings (key, value) VALUES ('email','hello@example.com'),('github',''),('githubText','');
